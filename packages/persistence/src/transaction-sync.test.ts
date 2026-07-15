import { describe, expect, it } from "vitest";

import {
  TransactionSyncPersistenceError,
  TransactionSyncRepository,
  type TransactionSyncPersistenceInput,
} from "./transaction-sync";

interface RecordedStatement {
  bindings: unknown[];
  sql: string;
}

function recordingDatabase({
  batchChanges = 1,
  batchError,
}: {
  batchChanges?: number;
  batchError?: Error;
} = {}) {
  const prepared: RecordedStatement[] = [];
  const batches: D1PreparedStatement[][] = [];
  const database = {
    batch(statements: D1PreparedStatement[]) {
      batches.push(statements);
      if (batchError) return Promise.reject(batchError);
      return Promise.resolve(
        statements.map((_, index) => ({
          meta: { changes: index === statements.length - 1 ? batchChanges : 1 },
        })),
      );
    },
    prepare(sql: string) {
      const recorded: RecordedStatement = { bindings: [], sql };
      prepared.push(recorded);
      const statement = {
        bind(...bindings: unknown[]) {
          recorded.bindings = bindings;
          return statement;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { batches, database, prepared };
}

function transaction(transactionId: string, amount = 12.34) {
  return {
    accountId: "plaid-account-1",
    amount,
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
  };
}

function batch(
  overrides: Partial<TransactionSyncPersistenceInput> = {},
): TransactionSyncPersistenceInput {
  return {
    added: [],
    connectionId: "connection-1",
    finalCursor: "cursor-2",
    initialCursor: "cursor-1",
    modified: [],
    now: "2026-07-15T12:00:00.000Z",
    removed: [],
    ...overrides,
  };
}

describe("TransactionSyncRepository", () => {
  it("binds all added, modified, removed, linkage, and cursor writes into one batch", async () => {
    const recording = recordingDatabase();
    const repository = new TransactionSyncRepository(recording.database);
    const added = transaction("added-transaction");
    const modified = {
      ...transaction("modified-transaction", -1.2),
      paymentMetadata: {
        ...transaction("unused").paymentMetadata,
        payer: "",
      },
      pending: true,
      pendingTransactionId: "pending-transaction",
    };

    await repository.apply(
      batch({
        added: [added],
        initialCursor: null,
        modified: [modified],
        removed: [{ accountId: "plaid-account-1", transactionId: "removed-transaction" }],
      }),
    );

    expect(recording.batches).toHaveLength(1);
    expect(recording.prepared).toHaveLength(6);
    const sql = recording.prepared.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("ON CONFLICT(plaid_transaction_id) DO UPDATE");
    expect(sql).toContain("SET pending_transaction_id = CASE");
    expect(sql).toContain("SET status = 'REMOVED'");
    expect(sql).toContain("SET sync_cursor = ?");
    expect(sql).not.toContain("added-transaction");
    expect(recording.prepared.flatMap((statement) => statement.bindings)).toContain(
      "added-transaction",
    );
    expect(recording.prepared[0]?.bindings).toContain(1234);
    expect(recording.prepared[1]?.bindings).toContain(120);
    expect(recording.prepared[1]?.bindings).toContain("INFLOW");
    expect(recording.prepared[1]?.bindings).toContain('{"payer":""}');
    expect(recording.prepared.at(-1)?.bindings).toEqual([
      "cursor-2",
      null,
      null,
      "2026-07-15T12:00:00.000Z",
      "2026-07-15T12:00:00.000Z",
      "connection-1",
    ]);
  });

  it.each([
    { input: { ...batch(), unknown: "field" }, name: "unknown fields" },
    { input: batch({ added: [transaction("too-precise", 0.001)] }), name: "sub-cent amounts" },
    {
      input: batch({ added: [transaction("unsafe-minor", 90_071_992_547_410)] }),
      name: "unsafe minor amounts",
    },
    { input: batch({ added: [transaction("exponent", 1e21)] }), name: "exponent amounts" },
    {
      input: batch({ added: [{ ...transaction("bad-currency"), isoCurrencyCode: "cad" }] }),
      name: "invalid currencies",
    },
  ])("rejects $name before database execution", async ({ input }) => {
    const recording = recordingDatabase();

    await expect(new TransactionSyncRepository(recording.database).apply(input)).rejects.toEqual(
      new TransactionSyncPersistenceError("INVALID_BATCH"),
    );
    expect(recording.batches).toHaveLength(0);
  });

  it("sanitizes D1 failures", async () => {
    const recording = recordingDatabase({ batchError: new Error("private database detail") });

    const operation = new TransactionSyncRepository(recording.database).apply(batch());

    await expect(operation).rejects.toEqual(new TransactionSyncPersistenceError("BATCH_FAILED"));
    await expect(operation).rejects.not.toThrow(/private database detail/);
  });

  it("rejects a missing connection cursor update", async () => {
    const recording = recordingDatabase({ batchChanges: 0 });

    await expect(new TransactionSyncRepository(recording.database).apply(batch())).rejects.toEqual(
      new TransactionSyncPersistenceError("BATCH_FAILED"),
    );
  });

  it("guards cursor persistence and run completion with the private lease token", async () => {
    const recording = recordingDatabase();

    await new TransactionSyncRepository(recording.database).apply(
      batch({
        runLease: {
          leaseToken: "lease-token-fixture-current",
          processPendingEventsThrough: "2026-07-15T12:00:00.000Z",
          runId: "sync-run-1",
        },
      }),
    );

    expect(recording.prepared).toHaveLength(3);
    const sql = recording.prepared.map(({ sql }) => sql).join("\n");
    expect(sql).toContain("lease_token = ? AND lease_expires_at > ?");
    expect(sql).toContain("SET status = 'SUCCEEDED'");
    expect(sql).toContain("SET status = 'PROCESSED'");
    expect(sql).not.toContain("lease-token-fixture-current");
    expect(recording.prepared.flatMap(({ bindings }) => bindings)).toContain(
      "lease-token-fixture-current",
    );
  });
});
