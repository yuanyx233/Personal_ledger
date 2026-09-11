import { TRANSACTION_CSV_HEADERS, parseCsvPreview, restoreSpreadsheetText } from "@ledger/domain";
import { transactionListResponseSchema } from "@ledger/domain/api-contracts";
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
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  () => new Date(NOW),
);

function apiRequest(pathAndQuery: string): Request {
  return new Request(`https://ledger.example/api/v1${pathAndQuery}`);
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
        'connection-export', 'ins_export', 'Export Bank', 'plaid-item-export',
        X'0102', X'0304', 1, 'HEALTHY', ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-export', 'connection-export', 'plaid-account-export',
        '@Daily Chequing', '1234', 'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-export', ?, 'EXPENSE', 1, 1, ?, ?, 1)`,
    ).bind("\tFood", NOW, NOW),
  ]);
  await cloudflareEnv.DB.prepare(
    `INSERT INTO merchant_rules (
      id, normalized_merchant, display_merchant, category_id, active,
      created_at, updated_at, version
    ) VALUES (
      'rule-export', '-fixture cafe', ?, 'category-export', 1, ?, ?, 1
    )`,
  )
    .bind("'Cafe rule", NOW, NOW)
    .run();
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_id, plaid_transaction_id, status, authorized_date,
        posted_date, amount_minor, direction, currency, raw_description, merchant_name,
        category_id, categorization_source, category_rule_id, normalized_merchant,
        plaid_pfc_primary, plaid_pfc_detailed, plaid_pfc_confidence,
        needs_review, review_reason, created_at, updated_at, version
      ) VALUES (
        'transaction-export-match', 'PLAID', 'account-export', 'plaid-export-match',
        'POSTED', '2026-07-14', '2026-07-15', 1234, 'OUTFLOW', 'CAD', ?, '+Cafe',
        'category-export', 'RULE', 'rule-export', '-fixture cafe',
        'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE', 'HIGH', 0, NULL, ?, ?, 1
      )`,
    ).bind('=HYPERLINK("https://evil.invalid"), "quoted"\nnext line', NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_id, plaid_transaction_id, status, posted_date,
        amount_minor, direction, currency, raw_description, merchant_name,
        category_id, categorization_source, normalized_merchant,
        needs_review, review_reason, created_at, updated_at, version
      ) VALUES (
        'transaction-export-other', 'PLAID', 'account-export', 'plaid-export-other',
        'POSTED', '2026-07-16', 9999, 'OUTFLOW', 'CAD', 'Other purchase', 'Other',
        'category-export', 'PLAID', 'other', 0, NULL, ?, ?, 1
      )`,
    ).bind(NOW, NOW),
  ]);
});

describe("filtered transaction CSV export", () => {
  it("downloads the same filter population with stable provenance and reversible formula safety", async () => {
    const filters = new URLSearchParams({
      accountId: "account-export",
      categorizationSource: "RULE",
      categoryId: "category-export",
      currency: "CAD",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      needsReview: "false",
      normalizedMerchant: "-fixture cafe",
      reportMetric: "NET_SPENDING",
      sort: "AMOUNT_ASC",
      source: "PLAID",
      status: "POSTED",
    });
    const listResponse = await worker.fetch(
      apiRequest(`/transactions?${filters.toString()}&pageSize=100`),
      workerEnv,
    );
    const list = transactionListResponseSchema.parse(await listResponse.json());
    expect(list.data.transactions.map(({ id }) => id)).toEqual(["transaction-export-match"]);

    const response = await worker.fetch(
      apiRequest(`/exports/transactions.csv?${filters.toString()}`),
      workerEnv,
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="transactions-2026-07-15.csv"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(csv.startsWith(`${TRANSACTION_CSV_HEADERS.join(",")}\r\n`)).toBe(true);
    expect(csv).toContain("transaction-export-match,");
    expect(csv).not.toContain("transaction-export-other");
    expect(csv).not.toContain("plaid-export-match");
    expect(csv).not.toContain("plaid-item-export");
    expect(csv).toContain("RULE,rule-export,''Cafe rule,FOOD_AND_DRINK");

    const preview = await parseCsvPreview({
      chunks: [new TextEncoder().encode(csv)],
      mapping: {
        accountLabel: "account",
        amount: "amount",
        category: "category",
        currency: "currency",
        description: "description",
        direction: "direction",
        merchant: "merchant",
        postedDate: "posted_date",
      },
    });
    expect(preview.columns).toEqual(TRANSACTION_CSV_HEADERS);
    expect(preview.counts).toEqual({ duplicate: 0, invalid: 0, total: 1, valid: 1 });
    expect(restoreSpreadsheetText(preview.rows[0]!.raw.accountLabel)).toBe("@Daily Chequing");
    expect(restoreSpreadsheetText(preview.rows[0]!.raw.category!)).toBe("\tFood");
    expect(restoreSpreadsheetText(preview.rows[0]!.raw.description)).toBe(
      '=HYPERLINK("https://evil.invalid"), "quoted"\nnext line',
    );
    expect(restoreSpreadsheetText(preview.rows[0]!.raw.merchant!)).toBe("+Cafe");
  });

  it("rejects pagination, unknown/repeated filters, and excessive date ranges", async () => {
    const methodResponse = await worker.fetch(
      new Request("https://ledger.example/api/v1/exports/transactions.csv", { method: "HEAD" }),
      workerEnv,
    );
    expect(methodResponse.status).toBe(405);

    for (const query of [
      "pageSize=100",
      "cursor=eyJ2IjoxfQ",
      "unsafeWhere=1%3D1",
      "source=PLAID&source=CSV",
      "dateFrom=2024-01-01&dateTo=2026-07-15",
    ]) {
      const response = await worker.fetch(
        apiRequest(`/exports/transactions.csv?${query}`),
        workerEnv,
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("returns a JSON 413 instead of a truncated file when more than 10,000 rows match", async () => {
    await cloudflareEnv.DB.prepare(
      `WITH digits(value) AS (
         VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)
       ), sequence(value) AS (
         SELECT ones.value + tens.value * 10 + hundreds.value * 100 +
                thousands.value * 1000 + ten_thousands.value * 10000
         FROM digits AS ones
         CROSS JOIN digits AS tens
         CROSS JOIN digits AS hundreds
         CROSS JOIN digits AS thousands
         CROSS JOIN digits AS ten_thousands
       )
       INSERT INTO transactions (
         id, source, account_id, status, posted_date, amount_minor, direction, currency,
         raw_description, category_id, categorization_source, needs_review, review_reason,
         created_at, updated_at, version
       )
       SELECT 'bulk-export-' || value, 'MANUAL', 'account-export', 'POSTED',
              '2026-07-01', 1, 'OUTFLOW', 'CAD', 'Bulk export row', 'category-export',
              'MANUAL', 0, NULL, ?, ?, 1
       FROM sequence WHERE value <= 10000`,
    )
      .bind(NOW, NOW)
      .run();

    const response = await worker.fetch(
      apiRequest("/exports/transactions.csv?dateFrom=2026-07-01&dateTo=2026-07-31"),
      workerEnv,
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });
});
