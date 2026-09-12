import { merchantRuleCorrectionResponseSchema } from "@ledger/domain/api-contracts";
import { ManualTransactionRepository } from "@ledger/persistence";
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

function putMerchantRule(id: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`https://ledger.example/api/v1/transactions/${id}/merchant-rule`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ledger.example",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrfToken,
      },
      method: "PUT",
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

  const transaction = (
    id: string,
    fingerprintSeed: string,
    merchantName: string | null,
    normalizedMerchant: string | null,
  ) =>
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_label, import_fingerprint, status, posted_date,
        amount_minor, direction, currency, raw_description, merchant_name,
        category_id, categorization_source, normalized_merchant, needs_review,
        review_reason, created_at, updated_at, version
      ) VALUES (
        ?, 'CSV', 'Daily Chequing', ?, 'POSTED', '2026-07-15', 1234, 'OUTFLOW',
        'CAD', ?, ?, 'category-old', 'MANUAL', ?, 1, 'RULE_CONFLICT', ?, ?, 1
      )`,
    ).bind(
      id,
      fingerprintSeed,
      merchantName ?? "No merchant",
      merchantName,
      normalizedMerchant,
      NOW,
      NOW,
    );

  await cloudflareEnv.DB.batch([
    transaction(
      "transaction-rule-current",
      "1111111111111111111111111111111111111111111111111111111111111111",
      "Neighbourhood Market Store 42",
      "neighbourhood market",
    ),
    transaction(
      "transaction-rule-history",
      "2222222222222222222222222222222222222222222222222222222222222222",
      "NEIGHBOURHOOD MARKET",
      "neighbourhood market",
    ),
    transaction(
      "transaction-rule-similar",
      "3333333333333333333333333333333333333333333333333333333333333333",
      "Neighbourhood Markets",
      "neighbourhood markets",
    ),
    transaction(
      "transaction-rule-no-merchant",
      "4444444444444444444444444444444444444444444444444444444444444444",
      null,
      null,
    ),
  ]);
});

describe("future exact merchant-rule correction", () => {
  it("creates one rule, corrects only the current transaction, and classifies future exact matches", async () => {
    const response = await putMerchantRule("transaction-rule-current", {
      categoryId: "category-new",
      version: 1,
    });
    const body = merchantRuleCorrectionResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.merchantRule).toMatchObject({
      active: true,
      categoryId: "category-new",
      displayMerchant: "Neighbourhood Market Store 42",
      normalizedMerchant: "neighbourhood market",
      version: 1,
    });
    expect(body.data.transaction).toMatchObject({
      categorizationSource: "RULE",
      categoryId: "category-new",
      categoryRuleId: body.data.merchantRule.id,
      needsReview: false,
      version: 2,
    });
    expect(body.meta.historicalTransactionsChanged).toBe(0);

    const historical = await cloudflareEnv.DB.prepare(
      `SELECT id, category_id, categorization_source, category_rule_id, version
       FROM transactions
       WHERE id IN ('transaction-rule-history', 'transaction-rule-similar')
       ORDER BY id`,
    ).all();
    expect(historical.results).toEqual([
      {
        categorization_source: "MANUAL",
        category_id: "category-old",
        category_rule_id: null,
        id: "transaction-rule-history",
        version: 1,
      },
      {
        categorization_source: "MANUAL",
        category_id: "category-old",
        category_rule_id: null,
        id: "transaction-rule-similar",
        version: 1,
      },
    ]);
    await expect(
      cloudflareEnv.DB.prepare(
        `SELECT old_category_id, new_category_id, old_source, new_source,
                old_category_rule_id, new_category_rule_id, reason
         FROM category_audits WHERE transaction_id = 'transaction-rule-current'`,
      ).first(),
    ).resolves.toMatchObject({
      new_category_id: "category-new",
      new_category_rule_id: body.data.merchantRule.id,
      new_source: "RULE",
      old_category_id: "category-old",
      old_category_rule_id: null,
      old_source: "MANUAL",
      reason: "RULE_CATEGORIZATION",
    });

    await expect(
      new ManualTransactionRepository(cloudflareEnv.DB, {
        createId: () => "future-exact",
      }).create({
        accountLabel: "Wallet",
        amountMinor: 1234,
        currency: "CAD",
        description: "  NEIGHBOURHOOD   MARKET Store 99 ",
        direction: "OUTFLOW",
        postedDate: "2026-07-16",
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: "CREATED" });
    await expect(
      new ManualTransactionRepository(cloudflareEnv.DB, {
        createId: () => "future-similar",
      }).create({
        accountLabel: "Wallet",
        amountMinor: 1234,
        currency: "CAD",
        description: "Neighbourhood Markets",
        direction: "OUTFLOW",
        postedDate: "2026-07-16",
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "CATEGORY_CONFIRMATION_REQUIRED" });
    const future = await cloudflareEnv.DB.prepare(
      `SELECT id, categorization_source, category_id, category_rule_id
       FROM transactions WHERE id LIKE 'future-%'
       ORDER BY id`,
    ).all();
    expect(future.results).toEqual([
      {
        categorization_source: "RULE",
        category_id: "category-new",
        category_rule_id: body.data.merchantRule.id,
        id: "future-exact",
      },
    ]);
  });

  it("reactivates and versions an existing exact rule while correcting only the target", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO merchant_rules (
        id, normalized_merchant, display_merchant, category_id, active,
        created_at, updated_at, version
      ) VALUES (
        'merchant-rule-existing', 'neighbourhood market', 'Old display',
        'category-old', 0, ?, ?, 4
      )`,
    )
      .bind(NOW, NOW)
      .run();

    const response = await putMerchantRule("transaction-rule-current", {
      categoryId: "category-new",
      version: 1,
    });
    const body = merchantRuleCorrectionResponseSchema.parse(await response.json());
    expect(body.data.merchantRule).toMatchObject({
      active: true,
      categoryId: "category-new",
      id: "merchant-rule-existing",
      version: 5,
    });
    await expect(
      cloudflareEnv.DB.prepare(
        `SELECT category_id, categorization_source, version
         FROM transactions WHERE id = 'transaction-rule-history'`,
      ).first(),
    ).resolves.toEqual({
      categorization_source: "MANUAL",
      category_id: "category-old",
      version: 1,
    });
  });

  it("rejects stale, merchantless, invalid-category, and forged-scope writes", async () => {
    const responses = await Promise.all([
      putMerchantRule("transaction-rule-current", { categoryId: "category-new", version: 2 }),
      putMerchantRule("transaction-rule-no-merchant", {
        categoryId: "category-new",
        version: 1,
      }),
      putMerchantRule("transaction-rule-current", {
        categoryId: "category-inactive",
        version: 1,
      }),
      putMerchantRule("transaction-rule-current", {
        categoryId: "category-system-unclassified",
        version: 1,
      }),
      putMerchantRule("transaction-rule-current", {
        applyToHistory: true,
        categoryId: "category-new",
        version: 1,
      }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([409, 422, 422, 422, 422]);
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM merchant_rules").first<number>(
        "count",
      ),
    ).resolves.toBe(0);
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM category_audits").first<number>(
        "count",
      ),
    ).resolves.toBe(0);
  });
});
