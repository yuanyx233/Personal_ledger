import { TransactionRepository } from "@ledger/persistence";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch(
    [
      "transactions",
      "categories WHERE system_key IS NULL",
      "accounts",
      "connections",
      "connection_requests",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO connections (
        id, institution_id, institution_name, plaid_item_id,
        access_token_ciphertext, access_token_iv, token_key_version,
        status, last_success_at, created_at, updated_at, version
      ) VALUES (
        'connection-1', 'ins_42', 'Fixture Bank', 'plaid-item-1',
        X'0102', X'0304', 1, 'HEALTHY', '2026-01-15T12:00:00.000Z',
        '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
      )`,
    ),
    env.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-1', 'connection-1', 'plaid-account-1', 'Daily Chequing', '1234',
        'DEPOSITORY', 'CHECKING', 'CAD', 1,
        '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
      )`,
    ),
    env.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES (
        'category-1', 'Shopping', 'EXPENSE', 1, 1,
        '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
      )`,
    ),
  ]);

  await env.DB.prepare(
    `INSERT INTO transactions (
      id, source, account_id, plaid_transaction_id, status, posted_date,
      amount_minor, direction, currency, raw_description, category_id,
      categorization_source, needs_review, created_at, updated_at, version
    ) VALUES (
      'transaction-1', 'PLAID', 'account-1', 'plaid-transaction-1', 'POSTED',
      '2026-01-15', 1234, 'OUTFLOW', 'CAD', 'Fixture purchase', 'category-1',
      'PLAID', 0, '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
    )`,
  ).run();
});

describe("repositories against D1", () => {
  it("runs prepared reads and maps database rows", async () => {
    const transactions = new TransactionRepository(env.DB);

    await expect(
      transactions.list({
        accountId: "account-1",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      }),
    ).resolves.toMatchObject([{ amountMinor: 1234, id: "transaction-1" }]);
  });

  it("treats filter text as data and rejects executable sort text", async () => {
    const transactions = new TransactionRepository(env.DB);
    const injectedId = "account-1' OR 1=1 --";

    await expect(transactions.list({ accountId: injectedId })).resolves.toEqual([]);
    await expect(
      transactions.list({ sort: "POSTED_DATE_DESC; DROP TABLE transactions; --" }),
    ).rejects.toThrow();

    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'transactions'",
    ).first<{ name: string }>();
    expect(table?.name).toBe("transactions");
  });
});
