import {
  accountOptionsResponseSchema,
  transactionDetailResponseSchema,
  transactionListResponseSchema,
} from "@ledger/domain/api-contracts";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { clearCategoryAudits } from "./support/category-audits";

const NOW = "2026-07-15T12:00:00.000Z";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;
const worker = createAppWorker(() => Promise.resolve(IDENTITY));

function readRequest(pathAndQuery: string): Request {
  return new Request(`https://ledger.example/api/v1${pathAndQuery}`);
}

function insertPlaidTransaction(input: {
  amountMinor: number;
  date: string;
  id: string;
  needsReview?: boolean;
  pendingTransactionId?: string;
  plaidTransactionId: string;
  status?: "PENDING" | "POSTED";
}) {
  return cloudflareEnv.DB.prepare(
    `INSERT INTO transactions (
      id, source, account_id, plaid_transaction_id, pending_transaction_id,
      status, authorized_date, posted_date, amount_minor, direction, currency,
      raw_description, merchant_name, payment_metadata_json, category_id,
      categorization_source, needs_review, review_reason, created_at, updated_at, version
    ) VALUES (
      ?, 'PLAID', 'account-1', ?, ?, ?, ?, ?, ?, 'OUTFLOW', 'CAD',
      'AMZN Mktp CA', 'Amazon',
      '{"payee":null,"payer":"","paymentMethod":null,"reason":"must not leak","referenceNumber":null}',
      'category-expense', 'PLAID', ?, ?, ?, ?, 1
    )`,
  ).bind(
    input.id,
    input.plaidTransactionId,
    input.pendingTransactionId ?? null,
    input.status ?? "POSTED",
    input.date,
    input.date,
    input.amountMinor,
    input.needsReview ? 1 : 0,
    input.needsReview ? "UNCLASSIFIED_MERCHANT" : null,
    NOW,
    NOW,
  );
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearCategoryAudits(cloudflareEnv.DB);
  await cloudflareEnv.DB.batch(
    [
      "transfer_match_audits",
      "transfer_matches",
      "transactions",
      "merchant_rules",
      "categories WHERE system_key IS NULL",
      "accounts",
      "connections",
    ].map((table) => cloudflareEnv.DB.prepare(`DELETE FROM ${table}`)),
  );
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO connections (
        id, institution_id, institution_name, plaid_item_id,
        access_token_ciphertext, access_token_iv, token_key_version,
        status, created_at, updated_at, version
      ) VALUES (
        'connection-1', 'ins_42', 'Fixture Bank', 'plaid-item-1',
        X'0102', X'0304', 1, 'HEALTHY', ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-1', 'connection-1', 'plaid-account-1', 'Daily Chequing', '1234',
        'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-expense', 'Shopping', 'EXPENSE', 1, 1, ?, ?, 1)`,
    ).bind(NOW, NOW),
  ]);
  await cloudflareEnv.DB.batch([
    insertPlaidTransaction({
      amountMinor: 100,
      date: "2026-07-15",
      id: "transaction-read-1",
      needsReview: true,
      plaidTransactionId: "plaid-read-1",
    }),
    insertPlaidTransaction({
      amountMinor: 200,
      date: "2026-07-16",
      id: "transaction-read-2",
      plaidTransactionId: "plaid-read-2",
    }),
    insertPlaidTransaction({
      amountMinor: 300,
      date: "2026-07-17",
      id: "transaction-read-3",
      plaidTransactionId: "plaid-read-3",
    }),
  ]);
});

describe("protected transaction read API", () => {
  it("lists saved account labels without a bank connection and filters by them", async () => {
    await cloudflareEnv.DB.prepare(
      "UPDATE transactions SET account_label = 'Cash wallet' WHERE id = 'transaction-read-1'",
    ).run();
    const response = await worker.fetch(readRequest("/accounts"), workerEnv);
    expect(response.status).toBe(200);
    const options = accountOptionsResponseSchema.parse(await response.json());
    expect(options.data.accounts).toContainEqual({ id: "Cash wallet", displayName: "Cash wallet" });
    expect(options.data.accounts.some(({ id }) => id === "account-1")).toBe(true);
    const filtered = await worker.fetch(
      readRequest("/transactions?accountId=Cash%20wallet"),
      workerEnv,
    );
    expect(
      transactionListResponseSchema
        .parse(await filtered.json())
        .data.transactions.map(({ id }) => id),
    ).toEqual(["transaction-read-1"]);
  });
  it("filters from URL parameters and traverses stable opaque cursor pages without duplicates", async () => {
    const firstUrl =
      "/transactions?dateFrom=2026-07-01&dateTo=2026-07-31&pageSize=2&sort=POSTED_DATE_DESC&source=PLAID&status=POSTED";
    const firstResponse = await worker.fetch(readRequest(firstUrl), workerEnv);
    const first = transactionListResponseSchema.parse(await firstResponse.json());

    expect(firstResponse.status).toBe(200);
    expect(first.data.transactions.map(({ id }) => id)).toEqual([
      "transaction-read-3",
      "transaction-read-2",
    ]);
    expect(first.meta).toMatchObject({
      hasMore: true,
      query: {
        dateFrom: "2026-07-01",
        dateTo: "2026-07-31",
        pageSize: 2,
        sort: "POSTED_DATE_DESC",
        source: "PLAID",
        status: "POSTED",
      },
    });

    const secondUrl = new URL(`https://ledger.example/api/v1${firstUrl}`);
    secondUrl.searchParams.set("cursor", first.meta.nextCursor!);
    const secondResponse = await worker.fetch(new Request(secondUrl), workerEnv);
    const second = transactionListResponseSchema.parse(await secondResponse.json());

    expect(second.data.transactions.map(({ id }) => id)).toEqual(["transaction-read-1"]);
    expect(second.meta).toMatchObject({ hasMore: false, nextCursor: null });
    expect(
      new Set([...first.data.transactions, ...second.data.transactions].map(({ id }) => id)).size,
    ).toBe(3);

    const filteredResponse = await worker.fetch(
      readRequest(
        "/transactions?accountId=account-1&categoryId=category-expense&categorizationSource=PLAID&currency=CAD&dateFrom=2026-07-01&dateTo=2026-07-31&needsReview=true&pageSize=10&sort=AMOUNT_ASC&source=PLAID&status=POSTED",
      ),
      workerEnv,
    );
    const filtered = transactionListResponseSchema.parse(await filteredResponse.json());
    expect(filtered.data.transactions.map(({ id }) => id)).toEqual(["transaction-read-1"]);
  });

  it("enumerates owner-rule and Plaid-automatic merchants through separate source filters", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO merchant_rules (
        id, normalized_merchant, display_merchant, category_id, active,
        created_at, updated_at, version
      ) VALUES (
        'merchant-rule-read-1', 'rule grocer', 'Rule Grocer',
        'category-expense', 1, ?, ?, 1
      )`,
    )
      .bind(NOW, NOW)
      .run();
    await cloudflareEnv.DB.batch([
      cloudflareEnv.DB.prepare(
        `UPDATE transactions
         SET merchant_name = 'Rule Grocer', normalized_merchant = 'rule grocer',
             categorization_source = 'RULE', category_rule_id = 'merchant-rule-read-1',
             needs_review = 0, review_reason = NULL
         WHERE id = 'transaction-read-3'`,
      ),
      cloudflareEnv.DB.prepare(
        `UPDATE transactions
         SET merchant_name = 'Plaid Cafe', normalized_merchant = 'plaid cafe',
             categorization_source = 'PLAID', category_rule_id = NULL,
             needs_review = 0, review_reason = NULL
         WHERE id = 'transaction-read-2'`,
      ),
      cloudflareEnv.DB.prepare(
        `UPDATE transactions
         SET merchant_name = 'Owner Corrected', normalized_merchant = 'owner corrected',
             categorization_source = 'MANUAL', category_rule_id = NULL,
             needs_review = 0, review_reason = NULL
         WHERE id = 'transaction-read-1'`,
      ),
    ]);

    const ruleResponse = await worker.fetch(
      readRequest("/transactions?categorizationSource=RULE&pageSize=10"),
      workerEnv,
    );
    const ruleTransactions = transactionListResponseSchema.parse(await ruleResponse.json());
    expect(ruleResponse.status).toBe(200);
    expect(
      ruleTransactions.data.transactions.map(
        ({ categoryRuleId, id, merchantName, normalizedMerchant }) => ({
          categoryRuleId,
          id,
          merchantName,
          normalizedMerchant,
        }),
      ),
    ).toEqual([
      {
        categoryRuleId: "merchant-rule-read-1",
        id: "transaction-read-3",
        merchantName: "Rule Grocer",
        normalizedMerchant: "rule grocer",
      },
    ]);
    expect(ruleTransactions.meta.query).toMatchObject({
      categorizationSource: "RULE",
      pageSize: 10,
    });

    const plaidResponse = await worker.fetch(
      readRequest("/transactions?categorizationSource=PLAID&pageSize=10"),
      workerEnv,
    );
    const plaidTransactions = transactionListResponseSchema.parse(await plaidResponse.json());
    expect(plaidResponse.status).toBe(200);
    expect(
      plaidTransactions.data.transactions.map(
        ({ categoryRuleId, id, merchantName, normalizedMerchant }) => ({
          categoryRuleId,
          id,
          merchantName,
          normalizedMerchant,
        }),
      ),
    ).toEqual([
      {
        categoryRuleId: null,
        id: "transaction-read-2",
        merchantName: "Plaid Cafe",
        normalizedMerchant: "plaid cafe",
      },
    ]);
    expect(plaidTransactions.meta.query).toMatchObject({
      categorizationSource: "PLAID",
      pageSize: 10,
    });

    const invalidResponse = await worker.fetch(
      readRequest("/transactions?categorizationSource=OWNER_RULE"),
      workerEnv,
    );
    expect(invalidResponse.status).toBe(422);
  });

  it("returns raw fields, lifecycle, transfer decision, and category audit in detail", async () => {
    await cloudflareEnv.DB.batch([
      insertPlaidTransaction({
        amountMinor: 14327,
        date: "2026-07-18",
        id: "transaction-detail-pending",
        plaidTransactionId: "plaid-detail-pending",
        status: "PENDING",
      }),
      insertPlaidTransaction({
        amountMinor: 14327,
        date: "2026-07-19",
        id: "transaction-detail-posted",
        pendingTransactionId: "transaction-detail-pending",
        plaidTransactionId: "plaid-detail-posted",
      }),
    ]);
    await cloudflareEnv.DB.batch([
      cloudflareEnv.DB.prepare(
        `INSERT INTO category_audits (
          id, transaction_id, old_category_id, new_category_id,
          old_source, new_source, reason, created_at
        ) VALUES (
          'category-audit-1', 'transaction-detail-posted', NULL, 'category-expense',
          'UNCLASSIFIED', 'MANUAL', 'OWNER_TRANSACTION_OVERRIDE', ?
        )`,
      ).bind("2026-07-19T13:00:00.000Z"),
      cloudflareEnv.DB.prepare(
        `INSERT INTO transfer_matches (
          id, left_transaction_id, right_transaction_id, status, confidence,
          evidence_json, decision_reason, created_at, updated_at, version
        ) VALUES (
          'transfer-match-detail-1', 'transaction-detail-pending',
          'transaction-detail-posted', 'PENDING_REVIEW', 'AMBIGUOUS',
          '{}', NULL, ?, ?, 2
        )`,
      ).bind("2026-07-19T13:00:00.000Z", "2026-07-19T13:00:00.000Z"),
    ]);

    const response = await worker.fetch(
      readRequest("/transactions/transaction-detail-posted"),
      workerEnv,
    );
    const body = transactionDetailResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.transaction).toMatchObject({
      categoryAudits: [{ id: "category-audit-1", oldSource: "UNCLASSIFIED" }],
      description: "AMZN Mktp CA",
      lifecycle: {
        pendingTransactionId: "transaction-detail-pending",
        replacedByTransactionId: null,
      },
      merchantName: "Amazon",
      normalizedMerchant: null,
      paymentMetadata: { payer: "" },
    });
    expect(JSON.stringify(body)).not.toContain("must not leak");
  });

  it("rejects unknown, repeated, malformed, and sort-mismatched query state", async () => {
    for (const query of [
      "unsafeWhere=1%3D1",
      "status=POSTED&status=REMOVED",
      "needsReview=1",
      "cursor=eyJ2IjoyfQ",
    ]) {
      const response = await worker.fetch(readRequest(`/transactions?${query}`), workerEnv);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }

    const firstResponse = await worker.fetch(
      readRequest("/transactions?pageSize=1&sort=POSTED_DATE_DESC"),
      workerEnv,
    );
    const cursor = transactionListResponseSchema.parse(await firstResponse.json()).meta.nextCursor;
    const mismatch = await worker.fetch(
      readRequest(`/transactions?pageSize=1&sort=AMOUNT_DESC&cursor=${cursor}`),
      workerEnv,
    );
    expect(mismatch.status).toBe(422);
  });

  it("returns 404 for a missing detail and 422 for an invalid resource id", async () => {
    const [missing, invalid] = await Promise.all([
      worker.fetch(readRequest("/transactions/transaction-missing"), workerEnv),
      worker.fetch(readRequest("/transactions/not-a-transaction-id"), workerEnv),
    ]);

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(422);
  });
});
