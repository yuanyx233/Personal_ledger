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
      id, source, account_label, import_fingerprint, status, posted_date,
      amount_minor, direction, currency, raw_description, category_id,
      categorization_source, needs_review, created_at, updated_at, version
    ) VALUES (
      'transaction-1', 'CSV', 'Daily Chequing', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'POSTED',
      '2026-01-15', 1234, 'OUTFLOW', 'CAD', 'Fixture purchase', 'category-1',
      'RULE', 0, '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
    )`,
  ).run();
});

describe("repositories against D1", () => {
  it("runs prepared reads and maps database rows", async () => {
    const transactions = new TransactionRepository(env.DB);

    await expect(
      transactions.list({
        accountId: "Daily Chequing",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      }),
    ).resolves.toMatchObject([{ amountMinor: 1234, id: "transaction-1" }]);
  });

  it("treats filter text as data and rejects executable sort text", async () => {
    const transactions = new TransactionRepository(env.DB);
    const injectedId = "Daily Chequing' OR 1=1 --";

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
