import { TransactionSyncRepository } from "@ledger/persistence";
import type { PlaidTransaction } from "@ledger/plaid";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const NOW = "2026-07-15T12:00:00.000Z";

function transaction(
  transactionId: string,
  overrides: Partial<PlaidTransaction> = {},
): PlaidTransaction {
  return {
    accountId: "plaid-account-1",
    amount: 12.34,
    authorizedDate: "2026-07-14",
    date: "2026-07-15",
    isoCurrencyCode: "CAD",
    merchantName: "Fixture Merchant",
    name: "Fixture purchase",
    paymentMetadata: {
      byOrderOf: null,
      payee: null,
      payer: null,
      paymentMethod: null,
      paymentProcessor: null,
      ppdId: null,
      reason: null,
      referenceNumber: null,
    },
    pending: false,
    pendingTransactionId: null,
    transactionId,
    ...overrides,
  };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch(
    ["transactions", "accounts", "connections"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
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
  ]);
});

describe("atomic Plaid transaction persistence", () => {
  it("converts exact money and persists only allowlisted transaction metadata with the cursor", async () => {
    const repository = new TransactionSyncRepository(env.DB);

    await repository.apply({
      added: [
        transaction("plaid-transaction-1", {
          amount: -123.45,
          merchantName: "Fixture Employer",
          name: "Payroll",
          paymentMetadata: {
            byOrderOf: null,
            payee: null,
            payer: "",
            paymentMethod: "ACH",
            paymentProcessor: null,
            ppdId: null,
            reason: null,
            referenceNumber: "reference-1",
          },
        }),
      ],
      connectionId: "connection-1",
      finalCursor: "cursor-2",
      initialCursor: "cursor-1",
      modified: [],
      now: NOW,
      removed: [],
    });

    const connection = await env.DB.prepare(
      `SELECT sync_cursor, last_success_at, status FROM connections WHERE id = ?`,
    )
      .bind("connection-1")
      .first<{ last_success_at: string; status: string; sync_cursor: string }>();
    expect(connection).toEqual({
      last_success_at: NOW,
      status: "HEALTHY",
      sync_cursor: "cursor-2",
    });

    const row = await env.DB.prepare(
      `SELECT account_id, amount_minor, direction, provider_amount_decimal,
              payment_metadata_json, plaid_transaction_id, status
       FROM transactions WHERE plaid_transaction_id = ?`,
    )
      .bind("plaid-transaction-1")
      .first<{
        account_id: string;
        amount_minor: number;
        direction: string;
        payment_metadata_json: string;
        plaid_transaction_id: string;
        provider_amount_decimal: string;
        status: string;
      }>();
    expect(row).toMatchObject({
      account_id: "account-1",
      amount_minor: 12345,
      direction: "INFLOW",
      plaid_transaction_id: "plaid-transaction-1",
      provider_amount_decimal: "-123.45",
      status: "POSTED",
    });
    expect(JSON.parse(row!.payment_metadata_json)).toEqual({
      payer: "",
      paymentMethod: "ACH",
      referenceNumber: "reference-1",
    });
  });

  it("upserts repeated ids, links pending to posted, and marks removed records", async () => {
    const repository = new TransactionSyncRepository(env.DB);
    await repository.apply({
      added: [transaction("pending-1", { amount: 10.01, pending: true })],
      connectionId: "connection-1",
      finalCursor: "cursor-2",
      initialCursor: "cursor-1",
      modified: [],
      now: NOW,
      removed: [],
    });

    await repository.apply({
      added: [
        transaction("posted-1", {
          amount: 10.01,
          name: "Posted purchase",
          pendingTransactionId: "pending-1",
        }),
      ],
      connectionId: "connection-1",
      finalCursor: "cursor-3",
      initialCursor: "cursor-2",
      modified: [transaction("pending-1", { amount: 11.02, pending: true })],
      now: "2026-07-15T12:01:00.000Z",
      removed: [{ accountId: "plaid-account-1", transactionId: "pending-1" }],
    });

    const rows = await env.DB.prepare(
      `SELECT id, plaid_transaction_id, pending_transaction_id, amount_minor, status
       FROM transactions ORDER BY plaid_transaction_id`,
    ).all<{
      amount_minor: number;
      id: string;
      pending_transaction_id: string | null;
      plaid_transaction_id: string;
      status: string;
    }>();
    expect(rows.results).toHaveLength(2);
    const pending = rows.results.find((row) => row.plaid_transaction_id === "pending-1")!;
    const posted = rows.results.find((row) => row.plaid_transaction_id === "posted-1")!;
    expect(pending).toMatchObject({ amount_minor: 1102, status: "REMOVED" });
    expect(posted).toMatchObject({ pending_transaction_id: pending.id, status: "POSTED" });
  });

  it("rolls back every transaction and the cursor when any prepared write fails", async () => {
    const repository = new TransactionSyncRepository(env.DB);

    await expect(
      repository.apply({
        added: [
          transaction("would-have-been-written"),
          transaction("unknown-account-transaction", { accountId: "unknown-account" }),
        ],
        connectionId: "connection-1",
        finalCursor: "cursor-must-not-commit",
        initialCursor: "cursor-1",
        modified: [],
        now: NOW,
        removed: [],
      }),
    ).rejects.toThrow();

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>(
      "count",
    );
    const cursor = await env.DB.prepare(
      "SELECT sync_cursor FROM connections WHERE id = 'connection-1'",
    ).first<string>("sync_cursor");
    expect(count).toBe(0);
    expect(cursor).toBe("cursor-1");
  });
});
