import { FullJsonExportError, fullJsonExportSchema } from "@ledger/domain";
import { FullJsonExportPersistenceError } from "@ledger/persistence";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { clearCategoryAudits } from "./support/category-audits";
import { clearTransferMatchAudits } from "./support/transfer-audits";

const NOW = "2026-07-17T12:00:00.000Z";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-json-export",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: "csrf-hmac-json-export-secret",
  DB: cloudflareEnv.DB,
  PLAID_SECRET: "plaid-client-json-export-secret",
} as unknown as AppEnv;
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  () => new Date(NOW),
);

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearCategoryAudits(cloudflareEnv.DB);
  await clearTransferMatchAudits(cloudflareEnv.DB);
  await cloudflareEnv.DB.batch(
    [
      "import_rows",
      "import_batches",
      "transfer_matches",
      "sync_events",
      "sync_run_requests",
      "sync_runs",
      "transactions",
      "merchant_rules",
      "categories WHERE system_key IS NULL",
      "accounts",
      "connections",
      "connection_requests",
    ].map((table) => cloudflareEnv.DB.prepare(`DELETE FROM ${table}`)),
  );

  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO connection_requests (
        idempotency_key, request_fingerprint, status, created_at, updated_at
      ) VALUES (?, ?, 'COMPLETED', ?, ?)`,
    ).bind("connection-idempotency-secret-0001", "9".repeat(64), NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO connections (
        id, institution_id, institution_name, plaid_item_id,
        access_token_ciphertext, access_token_iv, token_key_version, sync_cursor,
        status, created_at, updated_at, version
      ) VALUES (
        'connection-export', 'ins_export', 'Export Bank', ?,
        CAST(? AS BLOB), CAST(? AS BLOB), 7, ?, 'HEALTHY', ?, ?, 2
      )`,
    ).bind(
      "plaid-item-json-export-secret",
      "access-sandbox-json-export-secret",
      "iv-json-export-secret",
      "sync-cursor-json-export-secret",
      NOW,
      NOW,
    ),
  ]);
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-chequing', 'connection-export', ?, 'Daily Chequing', ?,
        'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1
      )`,
    ).bind("plaid-account-json-export-secret-1", "mask-json-export-secret-1", NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-credit', 'connection-export', ?, 'Credit Card', ?,
        'CREDIT', 'CREDIT_CARD', 'CAD', 1, ?, ?, 1
      )`,
    ).bind("plaid-account-json-export-secret-2", "mask-json-export-secret-2", NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-food', 'Food', 'EXPENSE', 1, 1, ?, ?, 1)`,
    ).bind(NOW, NOW),
  ]);
  await cloudflareEnv.DB.prepare(
    `INSERT INTO merchant_rules (
      id, normalized_merchant, display_merchant, category_id, active,
      created_at, updated_at, version
    ) VALUES ('rule-cafe', 'fixture cafe', 'Fixture Cafe', 'category-food', 1, ?, ?, 1)`,
  )
    .bind(NOW, NOW)
    .run();
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_id, plaid_transaction_id, status, posted_date,
        amount_minor, direction, currency, provider_amount_decimal, raw_description,
        merchant_name, payment_metadata_json, category_id, categorization_source,
        category_rule_id, normalized_merchant, plaid_pfc_primary, plaid_pfc_detailed,
        plaid_pfc_confidence, needs_review, created_at, updated_at, version
      ) VALUES (
        'transaction-export-1', 'PLAID', 'account-chequing', 'provider-transaction-1',
        'POSTED', '2026-07-17', 1234, 'OUTFLOW', 'CAD', ?, 'Fixture Cafe purchase',
        'Fixture Cafe', '{"payee":"Fixture Cafe","payer":null,"paymentMethod":"CARD","referenceNumber":"ref-1","private":"metadata-secret"}',
        'category-food', 'RULE', 'rule-cafe', 'fixture cafe', 'FOOD_AND_DRINK',
        'FOOD_AND_DRINK_COFFEE', 'HIGH', 0, ?, ?, 3
      )`,
    ).bind("provider-decimal-json-export-secret", NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_id, import_fingerprint, status, posted_date,
        amount_minor, direction, currency, raw_description, category_id,
        categorization_source, needs_review, created_at, updated_at, version
      ) VALUES (
        'transaction-export-2', 'CSV', 'account-credit', ?, 'POSTED', '2026-07-17',
        1234, 'INFLOW', 'CAD', 'Card payment', 'category-food', 'MANUAL', 0, ?, ?, 1
      )`,
    ).bind("c".repeat(64), NOW, NOW),
  ]);
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO category_audits (
        id, transaction_id, old_category_id, new_category_id, old_source, new_source,
        reason, created_at, old_category_rule_id, new_category_rule_id
      ) VALUES (
        'category-audit-export', 'transaction-export-1', NULL, 'category-food',
        'UNCLASSIFIED', 'RULE', 'RULE_CATEGORIZATION', ?, NULL, 'rule-cafe'
      )`,
    ).bind(NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO transfer_matches (
        id, left_transaction_id, right_transaction_id, status, confidence, evidence_json,
        decision_reason, created_at, updated_at, version
      ) VALUES (
        'transfer-match-export', 'transaction-export-1', 'transaction-export-2',
        'CONFIRMED', 'HIGH',
        '{"amountMinor":1234,"currency":"CAD","dayDifference":0,"signals":["DESCRIPTION"]}',
        'OWNER_CONFIRMED', ?, ?, 2
      )`,
    ).bind(NOW, NOW),
  ]);
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO transfer_match_audits (
        id, transfer_match_id, action, old_status, new_status, reason, match_version, created_at
      ) VALUES (
        'transfer-audit-export', 'transfer-match-export', 'CONFIRM', 'AUTO_CONFIRMED',
        'CONFIRMED', 'OWNER_CONFIRMED', 2, ?
      )`,
    ).bind(NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO import_batches (
        id, content_checksum, idempotency_key, status, preview_expires_at,
        created_at, committed_at, version, source_filename_hash
      ) VALUES (
        'import-batch-export', ?, ?, 'COMMITTED', ?, ?, ?, 2, ?
      )`,
    ).bind(
      "a".repeat(64),
      "import-idempotency-secret-0001",
      "preview-expiry-json-export-secret",
      NOW,
      NOW,
      "b".repeat(64),
    ),
  ]);
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO import_rows (
        id, batch_id, row_number, raw_json, canonical_fingerprint,
        validation_status, errors_json, transaction_id, created_at, resolution, resolved_at
      ) VALUES (
        'import-row-export', 'import-batch-export', 2,
        '{"accountLabel":"Credit Card","amount":"12.34","category":"Food","currency":"CAD","description":"Card payment","direction":"INFLOW","merchant":null,"postedDate":"2026-07-17"}',
        ?, 'IMPORTED', '[]', 'transaction-export-2', ?, 'IMPORTED_NEW', ?
      )`,
    ).bind("c".repeat(64), NOW, NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO sync_events (
        id, event_hash, connection_id, event_type, minimal_payload_json, status, received_at
      ) VALUES (
        'sync-event-export', ?, 'connection-export', 'TRANSACTIONS', ?, 'PENDING', ?
      )`,
    ).bind("d".repeat(64), '{"payload":"webhook-payload-json-export-secret"}', NOW),
    cloudflareEnv.DB.prepare(
      `INSERT INTO sync_runs (
        id, connection_id, trigger, status, idempotency_key, start_cursor, end_cursor,
        attempt_count, created_at, version, lease_token
      ) VALUES (
        'sync-run-export', 'connection-export', 'MANUAL', 'SUCCEEDED', ?, ?, ?, 1, ?, 1, ?
      )`,
    ).bind(
      "sync-idempotency-secret-0001",
      "sync-start-cursor-json-export-secret",
      "sync-end-cursor-json-export-secret",
      NOW,
      "lease-token-json-export-secret",
    ),
  ]);
});

describe("complete versioned JSON export", () => {
  it("downloads a strict, relationship-complete snapshot without secrets or ephemeral sync data", async () => {
    await cloudflareEnv.DB.prepare(
      "UPDATE transactions SET reimbursement_minor = 200 WHERE id = 'transaction-export-1'",
    ).run();
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/exports/data.json"),
      workerEnv,
    );
    const body = await response.text();
    const document = fullJsonExportSchema.parse(JSON.parse(body));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="personal-ledger-2026-07-17.json"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(document).toMatchObject({
      exportKind: "PERSONAL_LEDGER_FULL",
      exportedAt: NOW,
      schemaVersion: 4,
      timezone: "America/Toronto",
    });
    expect(document.data.connections).toEqual([
      expect.objectContaining({ id: "connection-export", institutionName: "Export Bank" }),
    ]);
    expect(document.data.accounts.map(({ id }) => id)).toEqual([
      "account-chequing",
      "account-credit",
    ]);
    expect(document.data.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountMinor: 1234,
          reimbursementMinor: 200,
          categoryRuleId: "rule-cafe",
          currency: "CAD",
          id: "transaction-export-1",
          providerTransactionId: "provider-transaction-1",
        }),
      ]),
    );
    expect(document.data.categoryAudits).toHaveLength(1);
    expect(document.data.transferMatches).toHaveLength(1);
    expect(document.data.transferMatchAudits).toHaveLength(1);
    expect(document.data.importBatches).toHaveLength(1);
    expect(document.data.importRows).toHaveLength(1);
    expect(document.recordCounts.transactions).toBe(document.data.transactions.length);

    for (const secret of [
      "access-sandbox-json-export-secret",
      "iv-json-export-secret",
      "plaid-item-json-export-secret",
      "plaid-account-json-export-secret",
      "mask-json-export-secret",
      "sync-cursor-json-export-secret",
      "webhook-payload-json-export-secret",
      "sync-start-cursor-json-export-secret",
      "sync-end-cursor-json-export-secret",
      "lease-token-json-export-secret",
      "connection-idempotency-secret-0001",
      "import-idempotency-secret-0001",
      "preview-expiry-json-export-secret",
      "provider-decimal-json-export-secret",
      "metadata-secret",
      workerEnv.CSRF_HMAC_KEY,
    ]) {
      expect(body).not.toContain(secret);
    }
    const normalizedBody = body.toLowerCase();
    for (const forbiddenKey of [
      "access_token",
      "accesstokenciphertext",
      "plaiditemid",
      "plaidaccountid",
      '"mask"',
      "synccursor",
      "idempotencykey",
      "previewexpiresat",
      "provideramountdecimal",
      "webhook",
      "csrf",
    ]) {
      expect(normalizedBody).not.toContain(forbiddenKey);
    }
  });

  it("rejects methods and every query parameter without producing an export", async () => {
    const method = await worker.fetch(
      new Request("https://ledger.example/api/v1/exports/data.json", { method: "HEAD" }),
      workerEnv,
    );
    expect(method.status).toBe(405);

    for (const query of ["schemaVersion=1", "limit=10", "unsafeWhere=1%3D1"]) {
      const response = await worker.fetch(
        new Request(`https://ledger.example/api/v1/exports/data.json?${query}`),
        workerEnv,
      );
      expect(response.status).toBe(422);
      expect(response.headers.get("Content-Type")).toContain("application/json");
    }
  });

  it("checks Access before touching the export database", async () => {
    let databaseTouched = false;
    const deniedWorker = createAppWorker(() => Promise.reject(new Error("missing assertion")));
    const deniedEnv = {
      ...workerEnv,
      DB: {
        prepare() {
          databaseTouched = true;
          throw new Error("database must not be read");
        },
      } as unknown as D1Database,
    };

    const response = await deniedWorker.fetch(
      new Request("https://ledger.example/api/v1/exports/data.json"),
      deniedEnv,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(databaseTouched).toBe(false);
  });

  it.each([
    [new FullJsonExportPersistenceError("ROW_LIMIT_EXCEEDED"), 413, "PAYLOAD_TOO_LARGE"],
    [new FullJsonExportError("OUTPUT_TOO_LARGE"), 413, "PAYLOAD_TOO_LARGE"],
    [new FullJsonExportPersistenceError("READ_FAILED"), 500, "INTERNAL_ERROR"],
  ] as const)(
    "maps an export failure without returning a partial file",
    async (failure, expectedStatus, expectedCode) => {
      const failedWorker = createAppWorker(
        () => Promise.resolve(IDENTITY),
        undefined,
        () => new Date(NOW),
        () => Promise.reject(failure),
      );

      const response = await failedWorker.fetch(
        new Request("https://ledger.example/api/v1/exports/data.json"),
        workerEnv,
      );

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({ error: { code: expectedCode } });
    },
  );
});
