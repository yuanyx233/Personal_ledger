import { TransactionRepository } from "@ledger/persistence";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const NOW = "2026-07-15T12:00:00.000Z";

async function insertHistoricalTransaction(amountMinor: number) {
  await env.DB.prepare(
    `INSERT INTO transactions (
    id, source, account_id, plaid_transaction_id, status, posted_date,
    amount_minor, direction, currency, raw_description, category_id,
    categorization_source, needs_review, created_at, updated_at, version
  ) VALUES ('historical-bank-row', 'PLAID', 'account-1', 'historical-provider-id',
    'POSTED', '2026-07-15', ?, 'OUTFLOW', 'CAD', 'Historical purchase',
    'category-expense', 'MANUAL', 0, ?, ?, 1)`,
  )
    .bind(amountMinor, NOW, NOW)
    .run();
}

function insertLocalTransaction(input: {
  amountMinor: number;
  direction?: "INFLOW" | "OUTFLOW";
  id: string;
  importFingerprint?: string;
  source: "CSV" | "MANUAL";
}) {
  return env.DB.prepare(
    `INSERT INTO transactions (
      id, source, account_label, import_fingerprint, status, posted_date,
      amount_minor, direction, currency, raw_description, merchant_name,
      category_id, categorization_source, needs_review, created_at, updated_at, version
    ) VALUES (?, ?, 'Cash wallet', ?, 'POSTED', '2026-07-15', ?, ?, 'CAD',
      'Same visible transaction fields', 'Shared Merchant', 'category-expense',
      'MANUAL', 0, ?, ?, 1)`,
  )
    .bind(
      input.id,
      input.source,
      input.importFingerprint ?? null,
      input.amountMinor,
      input.direction ?? "OUTFLOW",
      NOW,
      NOW,
    )
    .run();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch(
    ["transactions", "categories WHERE system_key IS NULL", "accounts", "connections"].map(
      (table) => env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO connections (
        id, institution_id, institution_name, plaid_item_id,
        access_token_ciphertext, access_token_iv, token_key_version,
        sync_cursor, status, created_at, updated_at, version
      ) VALUES (
        'connection-1', 'ins_42', 'Fixture Bank', 'plaid-item-1',
        X'0102', X'0304', 1, 'cursor-1', 'SYNCING', ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-1', 'connection-1', 'plaid-account-1', 'Daily Chequing', '1234',
        'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1
      )`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-expense', 'Expense', 'EXPENSE', 1, 1, ?, ?, 1)`,
    ).bind(NOW, NOW),
  ]);
});

describe("canonical ledger across sources", () => {
  it("keeps committed Plaid, manual, and CSV records in one exact-money population", async () => {
    await insertHistoricalTransaction(1001);
    await insertLocalTransaction({ amountMinor: 1001, id: "transaction-manual", source: "MANUAL" });
    await insertLocalTransaction({
      amountMinor: 1001,
      id: "transaction-csv",
      importFingerprint: "csv-row-fingerprint-1",
      source: "CSV",
    });

    const records = await new TransactionRepository(env.DB).list({ pageSize: 10 });
    expect(records).toHaveLength(3);
    expect(records.map(({ source }) => source).sort()).toEqual(["CSV", "MANUAL", "PLAID"]);
    expect(records.every(({ amountMinor }) => amountMinor === 1001)).toBe(true);

    const storageTypes = await env.DB.prepare(
      `SELECT source, typeof(amount_minor) AS storage_type
       FROM transactions ORDER BY source`,
    ).all<{ source: string; storage_type: string }>();
    expect(storageTypes.results).toEqual([
      { source: "CSV", storage_type: "integer" },
      { source: "MANUAL", storage_type: "integer" },
      { source: "PLAID", storage_type: "integer" },
    ]);
  });

  it("uses source identities instead of visible fields and rejects floating-point persistence", async () => {
    await insertHistoricalTransaction(1001);
    await env.DB.prepare("UPDATE transactions SET amount_minor = 1002 WHERE id = ?")
      .bind("historical-bank-row")
      .run();
    await insertLocalTransaction({ amountMinor: 1001, id: "transaction-manual", source: "MANUAL" });
    await insertLocalTransaction({
      amountMinor: 1001,
      id: "transaction-csv",
      importFingerprint: "csv-row-fingerprint-1",
      source: "CSV",
    });

    const rows = await env.DB.prepare(
      `SELECT source, amount_minor FROM transactions ORDER BY source`,
    ).all<{ amount_minor: number; source: string }>();
    expect(rows.results).toEqual([
      { amount_minor: 1001, source: "CSV" },
      { amount_minor: 1001, source: "MANUAL" },
      { amount_minor: 1002, source: "PLAID" },
    ]);

    await expect(
      insertLocalTransaction({
        amountMinor: 1001,
        id: "transaction-csv-duplicate",
        importFingerprint: "csv-row-fingerprint-1",
        source: "CSV",
      }),
    ).rejects.toThrow();
    await expect(
      insertLocalTransaction({ amountMinor: 10.01, id: "transaction-floating", source: "MANUAL" }),
    ).rejects.toThrow();
  });

  it("keeps an expense-category inflow as a refund instead of changing it to income", async () => {
    await insertLocalTransaction({
      amountMinor: 2599,
      direction: "INFLOW",
      id: "transaction-refund",
      source: "MANUAL",
    });

    const refund = await new TransactionRepository(env.DB).findById("transaction-refund");

    expect(refund).toMatchObject({
      amountMinor: 2599,
      categorizationSource: "MANUAL",
      categoryId: "category-expense",
      direction: "INFLOW",
      status: "POSTED",
    });
  });
});
