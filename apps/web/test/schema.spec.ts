import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { clearTransferMatchAudits } from "./support/transfer-audits";
import { clearCategoryAudits } from "./support/category-audits";

const EXPECTED_COLUMNS = {
  category_budgets: ["category_id", "currency", "effective_month", "amount_minor", "updated_at"],
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
    "normalized_name",
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
    "old_category_rule_id",
    "new_category_rule_id",
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
    "source_filename_hash",
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
    "resolution",
    "match_evidence_json",
    "resolved_at",
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
  subscription_occurrences: [
    "id",
    "subscription_id",
    "scheduled_date",
    "transaction_id",
    "status",
    "owner_decision_at",
    "created_at",
    "updated_at",
    "version",
  ],
  subscriptions: [
    "id",
    "name",
    "merchant_name",
    "normalized_merchant",
    "account_label",
    "amount_minor",
    "currency",
    "category_id",
    "cadence",
    "anchor_day",
    "next_charge_date",
    "status",
    "last_error_code",
    "created_at",
    "updated_at",
    "version",
    "cancellation_effective_date",
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
    "lease_token",
    "next_attempt_at",
  ],
  sync_run_requests: ["connection_id", "idempotency_key", "run_id", "created_at"],
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
    "normalized_merchant",
    "plaid_pfc_primary",
    "plaid_pfc_detailed",
    "plaid_pfc_confidence",
    "reimbursement_minor",
    "installment_group_id",
    "installment_number",
    "installment_count",
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
  transfer_match_audits: [
    "id",
    "transfer_match_id",
    "action",
    "old_status",
    "new_status",
    "reason",
    "match_version",
    "created_at",
  ],
} as const;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearCategoryAudits(env.DB);
  await clearTransferMatchAudits(env.DB);
  await env.DB.batch(
    [
      "import_rows",
      "import_batches",
      "subscription_occurrences",
      "subscriptions",
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

  it("allows editable custom transfer categories while protecting unclassified semantics", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO categories (
          id, name, normalized_name, kind, system_key, editable, active,
          created_at, updated_at, version
        ) VALUES ('category-transfer-emt', 'EMT', 'emt', 'TRANSFER', NULL, 1, 1,
          '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 1)`,
      ).run(),
    ).resolves.toBeDefined();

    await expect(
      env.DB.prepare(
        `INSERT INTO categories (
          id, name, normalized_name, kind, system_key, editable, active,
          created_at, updated_at, version
        ) VALUES ('category-unclassified-owner', 'Owner unknown', 'owner unknown',
          'UNCLASSIFIED', NULL, 1, 1,
          '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 1)`,
      ).run(),
    ).rejects.toThrow(/invalid category kind or system state/);

    await expect(
      env.DB.prepare(
        `UPDATE categories SET name = 'Changed transfer'
         WHERE id = 'category-system-transfer'`,
      ).run(),
    ).rejects.toThrow(/system categories are immutable/);
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
    await expect(
      env.DB.prepare(
        `UPDATE transactions
         SET plaid_pfc_primary = 'INCOME', plaid_pfc_detailed = NULL
         WHERE id = 'pending-1'`,
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `UPDATE transactions
         SET plaid_pfc_primary = 'income', plaid_pfc_detailed = 'income_wages'
         WHERE id = 'pending-1'`,
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE transactions SET normalized_merchant = ? WHERE id = 'pending-1'")
        .bind("x".repeat(257))
        .run(),
    ).rejects.toThrow();
  });

  it("accepts only complete, bounded installment metadata on manual transactions", async () => {
    await seedLedgerGraph();

    const insertManualInstallment = (id: string, metadata: readonly unknown[]) =>
      env.DB.prepare(
        `INSERT INTO transactions (
          id, source, account_label, status, posted_date, amount_minor, direction, currency,
          raw_description, category_id, categorization_source, needs_review,
          installment_group_id, installment_number, installment_count,
          created_at, updated_at, version
        ) VALUES (?, 'MANUAL', 'RBC Credit', 'POSTED', '2026-01-31', 3333, 'OUTFLOW',
          'CAD', 'Laptop', 'category-1', 'MANUAL', 0, ?, ?, ?, ?, ?, 1)`,
      )
        .bind(id, ...metadata, "2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
        .run();

    await expect(
      insertManualInstallment("transaction-installment-1", ["installment-group-1", 1, 3]),
    ).resolves.toBeDefined();
    await expect(
      insertManualInstallment("transaction-installment-duplicate", ["installment-group-1", 1, 3]),
    ).rejects.toThrow();
    await expect(
      insertManualInstallment("transaction-installment-partial", ["installment-group-1", 2, null]),
    ).rejects.toThrow();
    await expect(
      insertManualInstallment("transaction-installment-zero", ["installment-group-1", 0, 3]),
    ).rejects.toThrow();
    await expect(
      insertManualInstallment("transaction-installment-overflow", ["installment-group-1", 4, 3]),
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
      env.DB.prepare("UPDATE category_audits SET reason = 'Tampered'").run(),
    ).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM category_audits").run()).rejects.toThrow(
      /append-only/,
    );

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
    await insertTransaction("transfer-third", { direction: "INFLOW" });

    await env.DB.prepare(
      `INSERT INTO transfer_matches (
        id, left_transaction_id, right_transaction_id, status, confidence,
        evidence_json, created_at, updated_at, version
      ) VALUES ('match-1', 'transfer-left', 'transfer-right', 'AUTO_CONFIRMED',
        'HIGH', '{}', ?, ?, 1)`,
    )
      .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
      .run();
    await expect(
      env.DB.prepare(
        `INSERT INTO transfer_matches (
          id, left_transaction_id, right_transaction_id, status, confidence,
          evidence_json, created_at, updated_at, version
        ) VALUES ('match-overlap-active', 'transfer-left', 'transfer-third', 'CONFIRMED',
          'HIGH', '{}', ?, ?, 1)`,
      )
        .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();
    await env.DB.prepare(
      `INSERT INTO transfer_matches (
        id, left_transaction_id, right_transaction_id, status, confidence,
        evidence_json, created_at, updated_at, version
      ) VALUES ('match-overlap-pending', 'transfer-left', 'transfer-third', 'PENDING_REVIEW',
        'AMBIGUOUS', '{}', ?, ?, 1)`,
    )
      .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
      .run();
    await expect(
      env.DB.prepare(
        `UPDATE transfer_matches SET status = 'CONFIRMED'
         WHERE id = 'match-overlap-pending'`,
      ).run(),
    ).rejects.toThrow();
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
        "UPDATE import_batches SET source_filename_hash = 'not-a-sha256' WHERE id = 'batch-1'",
      ).run(),
    ).rejects.toThrow();
    await env.DB.prepare("UPDATE import_batches SET source_filename_hash = ? WHERE id = 'batch-1'")
      .bind("a".repeat(64))
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

  it("enforces append-only transfer decision audit constraints", async () => {
    await seedLedgerGraph();
    await insertTransaction("audit-transfer-left", { direction: "OUTFLOW" });
    await insertTransaction("audit-transfer-right", { direction: "INFLOW" });
    await env.DB.prepare(
      `INSERT INTO transfer_matches (
        id, left_transaction_id, right_transaction_id, status, confidence,
        evidence_json, created_at, updated_at, version
      ) VALUES ('match-audit', 'audit-transfer-left', 'audit-transfer-right', 'AUTO_CONFIRMED',
        'HIGH', '{}', ?, ?, 1)`,
    )
      .bind("2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z")
      .run();

    const insertAudit = (
      id: string,
      overrides: {
        action?: string;
        matchVersion?: number;
        newStatus?: string;
        oldStatus?: string;
        reason?: string;
        transferMatchId?: string;
      } = {},
    ) => {
      const action = overrides.action ?? "CONFIRM";
      const reason =
        overrides.reason ??
        (action === "BREAK"
          ? "OWNER_BROKE"
          : action === "IGNORE"
            ? "OWNER_IGNORED"
            : "OWNER_CONFIRMED");
      return env.DB.prepare(
        `INSERT INTO transfer_match_audits (
          id, transfer_match_id, action, old_status, new_status, reason,
          match_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          overrides.transferMatchId ?? "match-audit",
          action,
          overrides.oldStatus ?? "AUTO_CONFIRMED",
          overrides.newStatus ?? "CONFIRMED",
          reason,
          overrides.matchVersion ?? 2,
          "2026-01-15T12:30:00.000Z",
        )
        .run();
    };

    await insertAudit("transfer-audit-1");
    await insertAudit("transfer-audit-2", {
      action: "BREAK",
      matchVersion: 3,
      newStatus: "BROKEN",
      oldStatus: "CONFIRMED",
    });
    await insertAudit("transfer-audit-3", {
      action: "IGNORE",
      matchVersion: 4,
      newStatus: "IGNORED",
      oldStatus: "PENDING_REVIEW",
    });
    await expect(
      insertAudit("transfer-audit-action", { action: "DELETE", matchVersion: 5 }),
    ).rejects.toThrow();
    await expect(
      insertAudit("transfer-audit-old-status", { matchVersion: 6, oldStatus: "UNKNOWN" }),
    ).rejects.toThrow();
    await expect(
      insertAudit("transfer-audit-new-status", { matchVersion: 7, newStatus: "UNKNOWN" }),
    ).rejects.toThrow();
    await expect(insertAudit("transfer-audit-zero", { matchVersion: 0 })).rejects.toThrow();
    await expect(insertAudit("transfer-audit-float", { matchVersion: 2.5 })).rejects.toThrow();
    await expect(insertAudit("transfer-audit-duplicate-version")).rejects.toThrow();
    await expect(
      insertAudit("transfer-audit-orphan", {
        matchVersion: 8,
        transferMatchId: "missing-match",
      }),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `UPDATE transfer_match_audits SET reason = 'OWNER_IGNORED'
         WHERE id = 'transfer-audit-1'`,
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("DELETE FROM transfer_match_audits WHERE id = 'transfer-audit-1'").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("DELETE FROM transfer_matches WHERE id = 'match-audit'").run(),
    ).rejects.toThrow();
  });
});
