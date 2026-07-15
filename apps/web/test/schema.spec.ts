import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const EXPECTED_COLUMNS = {
  accounts: [
    "id",
    "connection_id",
    "plaid_account_id",
    "display_name",
    "mask",
    "type",
    "subtype",
    "currency",
    "enabled",
    "created_at",
    "updated_at",
    "version",
  ],
  categories: [
    "id",
    "name",
    "kind",
    "system_key",
    "editable",
    "active",
    "created_at",
    "updated_at",
    "version",
  ],
  category_audits: [
    "id",
    "transaction_id",
    "old_category_id",
    "new_category_id",
    "old_source",
    "new_source",
    "reason",
    "created_at",
  ],
  connections: [
    "id",
    "institution_id",
    "institution_name",
    "plaid_item_id",
    "access_token_ciphertext",
    "access_token_iv",
    "token_key_version",
    "sync_cursor",
    "status",
    "last_success_at",
    "last_error_code",
    "consent_expires_at",
    "created_at",
    "updated_at",
    "version",
    "creation_idempotency_key",
  ],
  connection_requests: [
    "idempotency_key",
    "request_fingerprint",
    "status",
    "created_at",
    "updated_at",
  ],
  import_batches: [
    "id",
    "content_checksum",
    "idempotency_key",
    "status",
    "preview_expires_at",
    "created_at",
    "committed_at",
    "version",
  ],
  import_rows: [
    "id",
    "batch_id",
    "row_number",
    "raw_json",
    "canonical_fingerprint",
    "validation_status",
    "errors_json",
    "transaction_id",
    "created_at",
  ],
  merchant_rules: [
    "id",
    "normalized_merchant",
    "display_merchant",
    "category_id",
    "active",
    "created_at",
    "updated_at",
    "version",
  ],
  sync_events: [
    "id",
    "event_hash",
    "connection_id",
    "event_type",
    "minimal_payload_json",
    "status",
    "received_at",
    "processed_at",
    "error_code",
  ],
  sync_runs: [
    "id",
    "connection_id",
    "trigger",
    "status",
    "idempotency_key",
    "start_cursor",
    "end_cursor",
    "lease_expires_at",
    "attempt_count",
    "last_error_code",
    "created_at",
    "started_at",
    "finished_at",
    "version",
  ],
  transactions: [
    "id",
    "source",
    "account_id",
    "account_label",
    "plaid_transaction_id",
    "pending_transaction_id",
    "import_fingerprint",
    "status",
    "authorized_date",
    "posted_date",
    "amount_minor",
    "direction",
    "currency",
    "provider_amount_decimal",
    "raw_description",
    "merchant_name",
    "payment_metadata_json",
    "category_id",
    "categorization_source",
    "category_rule_id",
    "needs_review",
    "review_reason",
    "created_at",
    "updated_at",
    "version",
  ],
  transfer_matches: [
    "id",
    "left_transaction_id",
    "right_transaction_id",
    "status",
    "confidence",
    "evidence_json",
    "decision_reason",
    "created_at",
    "updated_at",
    "version",
  ],
} as const;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch(
    [
      "import_rows",
      "import_batches",
      "transfer_matches",
      "category_audits",
      "sync_events",
      "sync_runs",
      "transactions",
      "merchant_rules",
      "categories",
      "accounts",
      "connections",
      "connection_requests",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});

async function tableColumns(table: string): Promise<string[]> {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return result.results.map(({ name }) => name);
}

async function insertConnection(id = "connection-1", plaidItemId = "plaid-item-1") {
  return env.DB.prepare(
    `INSERT INTO connections (
      id, institution_id, institution_name, plaid_item_id,
      access_token_ciphertext, access_token_iv, token_key_version,
      status, created_at, updated_at, version
    ) VALUES (?, 'ins_42', 'Fixture Bank', ?, X'0102', X'0304', 1, 'HEALTHY', ?, ?, 1)`,
  )
    .bind(id, plaidItemId, "2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
    .run();
}

async function insertAccount(
  id = "account-1",
  plaidAccountId = "plaid-account-1",
  connectionId = "connection-1",
) {
  return env.DB.prepare(
    `INSERT INTO accounts (
      id, connection_id, plaid_account_id, display_name, mask,
      type, subtype, currency, enabled, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'Daily Chequing', '1234', 'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1)`,
  )
    .bind(id, connectionId, plaidAccountId, "2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
    .run();
}

async function insertCategory(id = "category-1") {
  return env.DB.prepare(
    `INSERT INTO categories (
      id, name, kind, editable, active, created_at, updated_at, version
    ) VALUES (?, ?, 'EXPENSE', 1, 1, ?, ?, 1)`,
  )
    .bind(id, `Category ${id}`, "2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
    .run();
}

async function insertTransaction(
  id: string,
  overrides: {
    accountId?: string;
    amountMinor?: number;
    direction?: string;
    pendingTransactionId?: string | null;
    plaidTransactionId?: string;
    version?: number;
  } = {},
) {
  return env.DB.prepare(
    `INSERT INTO transactions (
      id, source, account_id, plaid_transaction_id, pending_transaction_id,
      status, posted_date, amount_minor, direction, currency,
      raw_description, category_id, categorization_source, needs_review,
      created_at, updated_at, version
    ) VALUES (?, 'PLAID', ?, ?, ?, 'POSTED', '2026-01-15', ?, ?, 'CAD',
      'Fixture transaction', 'category-1', 'PLAID', 0, ?, ?, ?)`,
  )
    .bind(
      id,
      overrides.accountId ?? "account-1",
      overrides.plaidTransactionId ?? `plaid-${id}`,
      overrides.pendingTransactionId ?? null,
      overrides.amountMinor ?? 1234,
      overrides.direction ?? "OUTFLOW",
      "2026-01-15T12:00:00.000Z",
      "2026-01-15T12:00:00.000Z",
      overrides.version ?? 1,
    )
    .run();
}

async function seedLedgerGraph() {
  await insertConnection();
  await insertAccount();
  await insertCategory();
}

describe("initial D1 schema", () => {
  it("creates every required table with the reviewed column contract", async () => {
    const tables = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'
         AND name != 'd1_migrations'
       ORDER BY name`,
    ).all<{ name: string }>();

    expect(tables.results.map(({ name }) => name)).toEqual(Object.keys(EXPECTED_COLUMNS).sort());

    for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
      expect(await tableColumns(table)).toEqual(columns);
    }
  });

  it("enforces connection and eligible-account identity and status constraints", async () => {
    await insertConnection();
    await insertAccount();

    await expect(insertConnection("connection-2", "plaid-item-1")).rejects.toThrow();
    await expect(insertAccount("account-2", "plaid-account-1")).rejects.toThrow();
    await expect(insertAccount("account-3", "plaid-account-3", "missing")).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO accounts (
          id, connection_id, plaid_account_id, display_name, type, subtype, currency,
          enabled, created_at, updated_at, version
        ) VALUES ('account-loan', 'connection-1', 'plaid-loan', 'Loan', 'LOAN', 'LOAN',
          'CAD', 1, '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1)`,
      ).run(),
    ).rejects.toThrow();
  });

  it("reserves connection idempotency without storing the public token", async () => {
    await env.DB.prepare(
      `INSERT INTO connection_requests (
        idempotency_key, request_fingerprint, status, created_at, updated_at
      ) VALUES (?, ?, 'PENDING', ?, ?)`,
    )
      .bind(
        "connection-request-0001",
        "a".repeat(64),
        "2026-01-15T12:00:00.000Z",
        "2026-01-15T12:00:00.000Z",
      )
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO connection_requests (
          idempotency_key, request_fingerprint, status, created_at, updated_at
        ) VALUES (?, ?, 'PENDING', ?, ?)`,
      )
        .bind(
          "connection-request-0001",
          "b".repeat(64),
          "2026-01-15T12:00:00.000Z",
          "2026-01-15T12:00:00.000Z",
        )
        .run(),
    ).rejects.toThrow();

    const serialized = JSON.stringify(
      await env.DB.prepare("SELECT * FROM connection_requests").all(),
    );
    expect(serialized).not.toContain("public-sandbox-token");
  });

  it("enforces exact money, lifecycle, pending linkage, and optimistic versions", async () => {
    await seedLedgerGraph();
    await insertTransaction("pending-1");
    await insertTransaction("posted-1", { pendingTransactionId: "pending-1" });

    await expect(insertTransaction("negative", { amountMinor: -1 })).rejects.toThrow();
    await expect(insertTransaction("floating", { amountMinor: 12.5 })).rejects.toThrow();
    await expect(insertTransaction("direction", { direction: "DEBIT" })).rejects.toThrow();
    await expect(insertTransaction("version", { version: 0 })).rejects.toThrow();
    await expect(
      insertTransaction("orphan", { pendingTransactionId: "missing-transaction" }),
    ).rejects.toThrow();
    await expect(
      insertTransaction("duplicate-plaid", { plaidTransactionId: "plaid-pending-1" }),
    ).rejects.toThrow();
  });

  it("links merchant rules and append-only category audits to canonical records", async () => {
    await seedLedgerGraph();
    await insertCategory("category-2");
    await env.DB.prepare(
      `INSERT INTO merchant_rules (
        id, normalized_merchant, display_merchant, category_id, active,
        created_at, updated_at, version
      ) VALUES ('rule-1', 'fixture merchant', 'Fixture Merchant', 'category-1', 1, ?, ?, 1)`,
    )
      .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
      .run();
    await insertTransaction("transaction-audit");
    await env.DB.prepare(
      `INSERT INTO category_audits (
        id, transaction_id, old_category_id, new_category_id, old_source,
        new_source, reason, created_at
      ) VALUES ('audit-1', 'transaction-audit', 'category-1', 'category-2',
        'PLAID', 'MANUAL', 'Owner correction', ?)`,
    )
      .bind("2026-01-15T12:30:00.000Z")
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO merchant_rules (
          id, normalized_merchant, display_merchant, category_id, active,
          created_at, updated_at, version
        ) VALUES ('rule-2', 'fixture merchant', 'Other display', 'category-2', 1, ?, ?, 1)`,
      )
        .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();
  });

  it("constrains transfer matches, sync work, and import provenance", async () => {
    await seedLedgerGraph();
    await insertTransaction("transfer-left", { direction: "OUTFLOW" });
    await insertTransaction("transfer-right", { direction: "INFLOW" });

    await env.DB.prepare(
      `INSERT INTO transfer_matches (
        id, left_transaction_id, right_transaction_id, status, confidence,
        evidence_json, created_at, updated_at, version
      ) VALUES ('match-1', 'transfer-left', 'transfer-right', 'AUTO_CONFIRMED',
        'HIGH', '{}', ?, ?, 1)`,
    )
      .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
      .run();
    await env.DB.prepare(
      `INSERT INTO sync_events (
        id, event_hash, connection_id, event_type, minimal_payload_json,
        status, received_at
      ) VALUES ('event-1', 'hash-1', 'connection-1', 'SYNC_UPDATES_AVAILABLE',
        '{}', 'PENDING', ?)`,
    )
      .bind("2026-01-15T12:00:00.000Z")
      .run();
    await env.DB.prepare(
      `INSERT INTO sync_runs (
        id, connection_id, trigger, status, idempotency_key, attempt_count,
        created_at, version
      ) VALUES ('run-1', 'connection-1', 'WEBHOOK', 'QUEUED', 'sync-request-0001', 0, ?, 1)`,
    )
      .bind("2026-01-15T12:00:00.000Z")
      .run();
    await env.DB.prepare(
      `INSERT INTO import_batches (
        id, content_checksum, idempotency_key, status, preview_expires_at,
        created_at, version
      ) VALUES ('batch-1', 'checksum-1', 'import-request-0001', 'PREVIEWED', ?, ?, 1)`,
    )
      .bind("2026-01-16T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
      .run();
    await env.DB.prepare(
      `INSERT INTO import_rows (
        id, batch_id, row_number, raw_json, canonical_fingerprint,
        validation_status, errors_json, created_at
      ) VALUES ('row-1', 'batch-1', 2, '{}', 'fingerprint-1', 'VALID', '[]', ?)`,
    )
      .bind("2026-01-15T12:00:00.000Z")
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO transfer_matches (
          id, left_transaction_id, right_transaction_id, status, confidence,
          evidence_json, created_at, updated_at, version
        ) VALUES ('match-self', 'transfer-left', 'transfer-left', 'PENDING_REVIEW',
          'AMBIGUOUS', '{}', ?, ?, 1)`,
      )
        .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO sync_events (
          id, event_hash, connection_id, event_type, minimal_payload_json,
          status, received_at
        ) VALUES ('event-2', 'hash-1', 'connection-1', 'SYNC_UPDATES_AVAILABLE',
          '{}', 'PENDING', ?)`,
      )
        .bind("2026-01-15T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO import_rows (
          id, batch_id, row_number, raw_json, validation_status, errors_json, created_at
        ) VALUES ('row-2', 'batch-1', 2, '{}', 'INVALID', '[]', ?)`,
      )
        .bind("2026-01-15T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();
  });
});
