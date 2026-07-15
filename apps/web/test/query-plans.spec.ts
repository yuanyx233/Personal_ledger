import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const EXPECTED_INDEXES = [
  "idx_accounts_connection_enabled",
  "idx_connections_sync_candidates",
  "idx_connections_creation_request",
  "idx_import_batches_status_expiry",
  "idx_import_rows_fingerprint",
  "idx_sync_events_status_received",
  "idx_sync_events_connection_pending",
  "idx_sync_runs_one_active_connection",
  "idx_sync_runs_retry_due",
  "idx_sync_run_requests_run",
  "idx_transactions_account_date",
  "idx_transactions_category_date",
  "idx_transactions_filter_state_date",
  "idx_transactions_pending_link",
  "idx_transactions_report_posted_currency_date",
  "idx_transactions_review_queue",
] as const;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function queryPlan(sql: string, bindings: unknown[] = []): Promise<string> {
  const statement = env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  const result = await (bindings.length > 0 ? statement.bind(...bindings) : statement).all<{
    detail: string;
  }>();
  return result.results.map(({ detail }) => detail).join("\n");
}

async function expectIndex(
  sql: string,
  index: string | RegExp,
  bindings: unknown[] = [],
): Promise<void> {
  const plan = await queryPlan(sql, bindings);
  expect(plan).toMatch(index instanceof RegExp ? index : new RegExp(`INDEX ${index}\\b`));
}

describe("D1 query plans", () => {
  it("keeps provider identity lookups on unique indexes", async () => {
    await expectIndex(
      "SELECT id FROM connections WHERE plaid_item_id = ?",
      /INDEX sqlite_autoindex_connections_\d+\b/,
      ["item-1"],
    );
    await expectIndex(
      "SELECT id FROM accounts WHERE plaid_account_id = ?",
      /INDEX sqlite_autoindex_accounts_\d+\b/,
      ["account-1"],
    );
    await expectIndex(
      "SELECT id FROM transactions WHERE plaid_transaction_id = ?",
      /INDEX sqlite_autoindex_transactions_\d+\b/,
      ["transaction-1"],
    );
    await expectIndex(
      "SELECT id FROM connections WHERE creation_idempotency_key = ?",
      "idx_connections_creation_request",
      ["connection-request-0001"],
    );
  });

  it("indexes Item sync selection and account eligibility", async () => {
    await expectIndex(
      `SELECT id, sync_cursor FROM connections
       WHERE status = ? AND last_success_at < ?
       ORDER BY last_success_at, id LIMIT 50`,
      "idx_connections_sync_candidates",
      ["HEALTHY", "2026-01-15T12:00:00.000Z"],
    );
    await expectIndex(
      `SELECT id FROM accounts
       WHERE connection_id = ? AND enabled = 1 ORDER BY id`,
      "idx_accounts_connection_enabled",
      ["connection-1"],
    );
  });

  it("indexes report ranges and URL-backed transaction filters", async () => {
    await expectIndex(
      `SELECT raw_description FROM transactions
       WHERE status = 'POSTED' AND currency = ? AND posted_date BETWEEN ? AND ?
       ORDER BY posted_date DESC, id DESC LIMIT 100`,
      "idx_transactions_report_posted_currency_date",
      ["CAD", "2026-01-01", "2026-01-31"],
    );
    await expectIndex(
      `SELECT raw_description FROM transactions
       WHERE account_id = ? AND posted_date BETWEEN ? AND ?
       ORDER BY posted_date DESC, id DESC LIMIT 100`,
      "idx_transactions_account_date",
      ["account-1", "2026-01-01", "2026-01-31"],
    );
    await expectIndex(
      `SELECT raw_description FROM transactions
       WHERE category_id = ? AND posted_date BETWEEN ? AND ?
       ORDER BY posted_date DESC, id DESC LIMIT 100`,
      "idx_transactions_category_date",
      ["category-1", "2026-01-01", "2026-01-31"],
    );
    await expectIndex(
      `SELECT raw_description FROM transactions
       WHERE status = ? AND source = ? AND categorization_source = ?
       ORDER BY posted_date DESC, id DESC LIMIT 100`,
      "idx_transactions_filter_state_date",
      ["POSTED", "PLAID", "RULE"],
    );
  });

  it("indexes exact rules, review work, and pending linkage", async () => {
    await expectIndex(
      `SELECT category_id FROM merchant_rules
       WHERE active = 1 AND normalized_merchant = ?`,
      /INDEX sqlite_autoindex_merchant_rules_\d+\b/,
      ["fixture merchant"],
    );
    await expectIndex(
      `SELECT id FROM transactions
       WHERE needs_review = 1 ORDER BY posted_date DESC, id DESC LIMIT 50`,
      "idx_transactions_review_queue",
    );
    await expectIndex(
      "SELECT id FROM transactions WHERE pending_transaction_id = ?",
      "idx_transactions_pending_link",
      ["pending-1"],
    );
  });

  it("indexes sync leases/events and import deduplication", async () => {
    await expectIndex(
      `SELECT id FROM sync_runs
       WHERE connection_id = ? AND status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT')
       ORDER BY created_at, id LIMIT 1`,
      "idx_sync_runs_one_active_connection",
      ["connection-1"],
    );
    await expectIndex(
      `SELECT id FROM sync_runs
       WHERE status = 'RETRY_WAIT' AND next_attempt_at <= ?
       ORDER BY next_attempt_at, connection_id, id LIMIT 50`,
      "idx_sync_runs_retry_due",
      ["2026-01-15T12:00:00.000Z"],
    );
    await expectIndex(
      `SELECT id FROM sync_events
       WHERE status = ? ORDER BY received_at, id LIMIT 50`,
      "idx_sync_events_status_received",
      ["PENDING"],
    );
    await expectIndex(
      `SELECT id FROM sync_events
       WHERE connection_id = ? AND status = 'PENDING'
       ORDER BY received_at, id LIMIT 1`,
      "idx_sync_events_connection_pending",
      ["connection-1"],
    );
    await expectIndex(
      "SELECT id FROM import_rows WHERE canonical_fingerprint = ?",
      "idx_import_rows_fingerprint",
      ["fingerprint-1"],
    );
    await expectIndex(
      `SELECT id FROM import_batches
       WHERE status = ? AND preview_expires_at < ?`,
      "idx_import_batches_status_expiry",
      ["PREVIEWED", "2026-01-15T12:00:00.000Z"],
    );
    await expectIndex(
      "SELECT id FROM transactions WHERE import_fingerprint = ?",
      /INDEX sqlite_autoindex_transactions_\d+\b/,
      ["fingerprint-1"],
    );
  });

  it("declares every reviewed named index", async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
       ORDER BY name`,
    ).all<{ name: string }>();

    expect(result.results.map(({ name }) => name)).toEqual([...EXPECTED_INDEXES].sort());
  });
});
