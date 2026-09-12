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

function insertImportedTransaction(input: {
  amountMinor: number;
  date: string;
  id: string;
  needsReview?: boolean;
  pendingTransactionId?: string;
  importFingerprint: string;
  status?: "PENDING" | "POSTED";
}) {
  return cloudflareEnv.DB.prepare(
    `INSERT INTO transactions (
      id, source, account_label, import_fingerprint, pending_transaction_id,
      status, posted_date, amount_minor, direction, currency,
      raw_description, merchant_name, payment_metadata_json, category_id,
      categorization_source, needs_review, review_reason, created_at, updated_at, version
    ) VALUES (
      ?, 'CSV', 'Daily Chequing', ?, ?, ?, ?, ?, 'OUTFLOW', 'CAD',
      'AMZN Mktp CA', 'Amazon',
      '{"payee":null,"payer":"","paymentMethod":null,"reason":"must not leak","referenceNumber":null}',
      'category-expense', 'RULE', ?, ?, ?, ?, 1
    )`,
  ).bind(
    input.id,
    input.importFingerprint,
    input.pendingTransactionId ?? null,
    input.status ?? "POSTED",
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
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-expense', 'Shopping', 'EXPENSE', 1, 1, ?, ?, 1)`,
    ).bind(NOW, NOW),
  ]);
  await cloudflareEnv.DB.batch([
    insertImportedTransaction({
      amountMinor: 100,
      date: "2026-07-15",
      id: "transaction-read-1",
      needsReview: true,
      importFingerprint: "1".repeat(64),
    }),
    insertImportedTransaction({
      amountMinor: 200,
      date: "2026-07-16",
      id: "transaction-read-2",
      importFingerprint: "2".repeat(64),
    }),
    insertImportedTransaction({
      amountMinor: 300,
      date: "2026-07-17",
      id: "transaction-read-3",
      importFingerprint: "3".repeat(64),
    }),
  ]);
});

describe("protected transaction read API", () => {
  it("keeps historical Plaid transactions readable without restoring bank sync", async () => {
    await cloudflareEnv.DB.batch([
      cloudflareEnv.DB.prepare(
        `INSERT INTO connections (
          id, institution_id, institution_name, plaid_item_id,
          access_token_ciphertext, access_token_iv, token_key_version,
          status, created_at, updated_at, version
        ) VALUES (
          'connection-legacy', 'ins_legacy', 'Legacy Bank', 'plaid-item-legacy',
          X'01', X'02', 1, 'DISCONNECTED', ?, ?, 1
        )`,
      ).bind(NOW, NOW),
      cloudflareEnv.DB.prepare(
        `INSERT INTO accounts (
          id, connection_id, plaid_account_id, display_name,
          type, subtype, currency, enabled, created_at, updated_at, version
        ) VALUES (
          'account-legacy', 'connection-legacy', 'plaid-account-legacy', 'Legacy Bank',
          'DEPOSITORY', 'CHECKING', 'CAD', 0, ?, ?, 1
        )`,
      ).bind(NOW, NOW),
      cloudflareEnv.DB.prepare(
        `INSERT INTO transactions (
        id, source, account_id, account_label, plaid_transaction_id, status, posted_date,
        amount_minor, direction, currency, raw_description, category_id,
        categorization_source, needs_review, created_at, updated_at, version
      ) VALUES (
        'transaction-legacy-plaid', 'PLAID', 'account-legacy', NULL, 'legacy-plaid-1', 'POSTED',
        '2026-07-14', 4500, 'OUTFLOW', 'CAD', 'Legacy merchant',
        'category-expense', 'PLAID', 0, ?, ?, 1
      )`,
      ).bind(NOW, NOW),
    ]);

    const response = await worker.fetch(readRequest("/transactions?source=PLAID"), workerEnv);
    expect(response.status).toBe(200);
    const body = transactionListResponseSchema.parse(await response.json());
    expect(body.data.transactions).toEqual([
      expect.objectContaining({
        accountLabel: "Legacy Bank",
        categorizationSource: "PLAID",
        id: "transaction-legacy-plaid",
        source: "PLAID",
      }),
    ]);
    const accounts = accountOptionsResponseSchema.parse(
      await (await worker.fetch(readRequest("/accounts"), workerEnv)).json(),
    );
    expect(accounts.data.accounts).toContainEqual({
      id: "Legacy Bank",
      displayName: "Legacy Bank",
    });
    const filtered = transactionListResponseSchema.parse(
      await (
        await worker.fetch(readRequest("/transactions?accountId=Legacy%20Bank"), workerEnv)
      ).json(),
    );
    expect(filtered.data.transactions.map(({ id }) => id)).toContain("transaction-legacy-plaid");
  });

  it("lists saved account labels without a bank connection and filters by them", async () => {
    await cloudflareEnv.DB.prepare(
      "UPDATE transactions SET account_label = 'Cash wallet' WHERE id = 'transaction-read-1'",
    ).run();
    const response = await worker.fetch(readRequest("/accounts"), workerEnv);
    expect(response.status).toBe(200);
    const options = accountOptionsResponseSchema.parse(await response.json());
    expect(options.data.accounts).toContainEqual({ id: "Cash wallet", displayName: "Cash wallet" });
    expect(options.data.accounts.some(({ id }) => id === "Daily Chequing")).toBe(true);
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
      "/transactions?dateFrom=2026-07-01&dateTo=2026-07-31&pageSize=2&sort=POSTED_DATE_DESC&source=CSV&status=POSTED";
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
        source: "CSV",
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
        "/transactions?accountId=Daily%20Chequing&categoryId=category-expense&categorizationSource=RULE&currency=CAD&dateFrom=2026-07-01&dateTo=2026-07-31&needsReview=true&pageSize=10&sort=AMOUNT_ASC&source=CSV&status=POSTED",
      ),
      workerEnv,
    );
    const filtered = transactionListResponseSchema.parse(await filteredResponse.json());
    expect(filtered.data.transactions.map(({ id }) => id)).toEqual(["transaction-read-1"]);
  });

  it("enumerates owner-rule and manual merchants through separate source filters", async () => {
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
         SET merchant_name = 'Auto Cafe', normalized_merchant = 'auto cafe',
             categorization_source = 'MANUAL', category_rule_id = NULL,
             needs_review = 0, review_reason = NULL
         WHERE id = 'transaction-read-2'`,
      ),
      cloudflareEnv.DB.prepare(
        `UPDATE transactions
         SET merchant_name = 'Owner Corrected', normalized_merchant = 'owner corrected',
             categorization_source = 'UNCLASSIFIED', category_rule_id = NULL,
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

    const autoResponse = await worker.fetch(
      readRequest("/transactions?categorizationSource=MANUAL&pageSize=10"),
      workerEnv,
    );
    const autoTransactions = transactionListResponseSchema.parse(await autoResponse.json());
    expect(autoResponse.status).toBe(200);
    expect(
      autoTransactions.data.transactions.map(
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
        merchantName: "Auto Cafe",
        normalizedMerchant: "auto cafe",
      },
    ]);
    expect(autoTransactions.meta.query).toMatchObject({
      categorizationSource: "MANUAL",
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
      insertImportedTransaction({
        amountMinor: 14327,
        date: "2026-07-18",
        id: "transaction-detail-pending",
        importFingerprint: "4".repeat(64),
        status: "PENDING",
      }),
      insertImportedTransaction({
        amountMinor: 14327,
        date: "2026-07-19",
        id: "transaction-detail-posted",
        pendingTransactionId: "transaction-detail-pending",
        importFingerprint: "5".repeat(64),
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
