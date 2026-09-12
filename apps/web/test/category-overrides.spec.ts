import {
  transactionCategoryOverrideResponseSchema,
  transactionDetailResponseSchema,
} from "@ledger/domain/api-contracts";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";
import { clearCategoryAudits } from "./support/category-audits";

const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const NOW = "2026-07-15T13:00:00.000Z";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  () => new Date(NOW),
);
let csrfToken: string;

function patchCategory(id: string, categoryId: string, version: number) {
  return worker.fetch(
    new Request(`https://ledger.example/api/v1/transactions/${id}`, {
      body: JSON.stringify({ categoryId, version }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ledger.example",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrfToken,
      },
      method: "PATCH",
    }),
    workerEnv,
  );
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

beforeEach(async () => {
  await clearCategoryAudits(cloudflareEnv.DB);
  await cloudflareEnv.DB.batch(
    ["transactions", "merchant_rules", "categories WHERE system_key IS NULL"].map((table) =>
      cloudflareEnv.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await cloudflareEnv.DB.batch([
    ...[
      ["category-old", "Old category", 1],
      ["category-new", "New category", 1],
      ["category-inactive", "Inactive category", 0],
    ].map(([id, name, active]) =>
      cloudflareEnv.DB.prepare(
        `INSERT INTO categories (
          id, name, kind, editable, active, created_at, updated_at, version
        ) VALUES (?, ?, 'EXPENSE', 1, ?, ?, ?, 1)`,
      ).bind(id, name, active, NOW, NOW),
    ),
  ]);
  await cloudflareEnv.DB.prepare(
    `INSERT INTO merchant_rules (
      id, normalized_merchant, display_merchant, category_id, active,
      created_at, updated_at, version
    ) VALUES ('rule-market', 'neighbourhood market', 'Neighbourhood Market',
      'category-old', 1, ?, ?, 1)`,
  )
    .bind(NOW, NOW)
    .run();
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_label, import_fingerprint, status, posted_date,
        amount_minor, direction, currency, raw_description, merchant_name,
        category_id, category_rule_id, categorization_source, normalized_merchant,
        needs_review, review_reason, created_at, updated_at, version
      ) VALUES (
        'transaction-rule-override', 'CSV', 'Daily Chequing', 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0',
        'POSTED', '2026-07-15', 1234, 'OUTFLOW', 'CAD', 'Neighbourhood market',
        'Neighbourhood Market', 'category-old', 'rule-market', 'RULE',
        'neighbourhood market', 1, 'RULE_CONFLICT', ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_label, import_fingerprint, status, posted_date,
        amount_minor, direction, currency, raw_description, category_id,
        categorization_source, needs_review, created_at, updated_at, version
      ) VALUES (
        'transaction-csv-override', 'CSV', 'Imported account', 'csv-override',
        'POSTED', '2026-07-15', 5678, 'OUTFLOW', 'CAD', 'Imported row',
        'category-old', 'MANUAL', 0, ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_label, status, posted_date, amount_minor, direction,
        currency, raw_description, category_id, categorization_source,
        needs_review, created_at, updated_at, version
      ) VALUES (
        'transaction-manual-override', 'MANUAL', 'Cash wallet', 'POSTED',
        '2026-07-15', 900, 'OUTFLOW', 'CAD', 'Cash purchase', 'category-old',
        'MANUAL', 0, ?, ?, 1
      )`,
    ).bind(NOW, NOW),
  ]);
});

describe("transaction-level category override", () => {
  it("corrects one rule-classified transaction and appends complete old/new provenance", async () => {
    const response = await patchCategory("transaction-rule-override", "category-new", 1);
    const body = transactionCategoryOverrideResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.transaction).toMatchObject({
      categorizationSource: "MANUAL",
      categoryId: "category-new",
      categoryRuleId: null,
      needsReview: false,
      reviewReason: null,
      source: "CSV",
      version: 2,
    });
    await expect(
      cloudflareEnv.DB.prepare(
        `SELECT old_category_id, new_category_id, old_source, new_source,
                old_category_rule_id, new_category_rule_id, reason
         FROM category_audits WHERE transaction_id = 'transaction-rule-override'`,
      ).first(),
    ).resolves.toEqual({
      new_category_id: "category-new",
      new_category_rule_id: null,
      new_source: "MANUAL",
      old_category_id: "category-old",
      old_category_rule_id: "rule-market",
      old_source: "RULE",
      reason: "OWNER_TRANSACTION_OVERRIDE",
    });
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT category_id, active, version FROM merchant_rules WHERE id = 'rule-market'",
      ).first(),
    ).resolves.toEqual({ active: 1, category_id: "category-old", version: 1 });

    const detailResponse = await worker.fetch(
      new Request("https://ledger.example/api/v1/transactions/transaction-rule-override"),
      workerEnv,
    );
    const detail = transactionDetailResponseSchema.parse(await detailResponse.json());
    expect(detail.data.transaction.categoryAudits[0]).toMatchObject({
      newCategoryRuleId: null,
      oldCategoryRuleId: "rule-market",
      reason: "OWNER_TRANSACTION_OVERRIDE",
    });
  });

  it("supports CSV/manual sources and keeps a repeated override idempotent", async () => {
    const [csvResponse, manualResponse] = await Promise.all([
      patchCategory("transaction-csv-override", "category-new", 1),
      patchCategory("transaction-manual-override", "category-new", 1),
    ]);
    expect(csvResponse.status).toBe(200);
    expect(manualResponse.status).toBe(200);

    const repeated = await patchCategory("transaction-manual-override", "category-new", 2);
    const repeatedBody = transactionCategoryOverrideResponseSchema.parse(await repeated.json());
    expect(repeated.status).toBe(200);
    expect(repeatedBody.data.transaction.version).toBe(2);
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM category_audits").first<number>(
        "count",
      ),
    ).resolves.toBe(2);
  });

  it("allows explicit Transfer classification without a matching workflow", async () => {
    const response = await patchCategory(
      "transaction-rule-override",
      "category-system-transfer",
      1,
    );
    expect(response.status).toBe(200);
    const body = transactionCategoryOverrideResponseSchema.parse(await response.json());
    expect(body.data.transaction).toMatchObject({
      categoryId: "category-system-transfer",
      categorizationSource: "MANUAL",
      needsReview: false,
    });
  });

  it("rejects stale, inactive, system, missing, and removed targets without audit", async () => {
    await cloudflareEnv.DB.prepare(
      `UPDATE transactions SET status = 'REMOVED'
       WHERE id = 'transaction-csv-override'`,
    ).run();
    const responses = await Promise.all([
      patchCategory("transaction-rule-override", "category-new", 2),
      patchCategory("transaction-rule-override", "category-inactive", 1),
      patchCategory("transaction-rule-override", "category-system-unclassified", 1),
      patchCategory("transaction-rule-override", "category-missing", 1),
      patchCategory("transaction-csv-override", "category-new", 1),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([409, 422, 422, 422, 404]);
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM category_audits").first<number>(
        "count",
      ),
    ).resolves.toBe(0);
  });

  it("enforces append-only category audits", async () => {
    await patchCategory("transaction-rule-override", "category-new", 1);

    await expect(
      cloudflareEnv.DB.prepare("UPDATE category_audits SET reason = 'tampered'").run(),
    ).rejects.toThrow(/append-only/);
    await expect(cloudflareEnv.DB.prepare("DELETE FROM category_audits").run()).rejects.toThrow(
      /append-only/,
    );
  });
});
