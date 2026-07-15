import {
  SyncRunRepository,
  TransactionSyncPersistenceError,
  TransactionSyncRepository,
} from "@ledger/persistence";
import type { PlaidTransaction } from "@ledger/plaid";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const STARTED_AT = "2026-07-15T12:00:00.000Z";

function transaction(transactionId: string): PlaidTransaction {
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
  };
}

function createRepository() {
  let id = 0;
  let token = 0;
  return new SyncRunRepository(env.DB, {
    createId: () => `sync-run-${(id += 1)}`,
    createLeaseToken: () => `lease-token-fixture-${(token += 1)}`,
    random: () => 0,
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch(
    ["transactions", "sync_runs", "accounts", "connections"].map((table) =>
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
        X'0102', X'0304', 1, 'cursor-1', 'HEALTHY', ?, ?, 1
      )`,
    ).bind(STARTED_AT, STARTED_AT),
    env.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-1', 'connection-1', 'plaid-account-1', 'Daily Chequing', '1234',
        'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1
      )`,
    ).bind(STARTED_AT, STARTED_AT),
  ]);
});

describe("per-Item sync leases", () => {
  it("allows only one concurrent trigger to acquire the cursor loop", async () => {
    const repository = createRepository();
    const acquisitions = await Promise.all([
      repository.acquire({
        connectionId: "connection-1",
        now: STARTED_AT,
        startCursor: "cursor-1",
        trigger: "WEBHOOK",
      }),
      repository.acquire({
        connectionId: "connection-1",
        now: STARTED_AT,
        startCursor: "cursor-1",
        trigger: "SCHEDULED",
      }),
    ]);

    expect(acquisitions.filter(({ kind }) => kind === "ACQUIRED")).toHaveLength(1);
    expect(acquisitions.filter(({ kind }) => kind === "EXISTING")).toHaveLength(1);
    expect(new Set(acquisitions.map(({ run }) => run.id)).size).toBe(1);

    let cursorLoops = 0;
    for (const acquisition of acquisitions) {
      if (acquisition.kind === "ACQUIRED") cursorLoops += 1;
    }
    expect(cursorLoops).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_runs").first<number>("count"),
    ).toBe(1);
  });

  it("selects stale, failed, queued, due-retry, and expired-lease Items only", async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM transactions"),
      env.DB.prepare("DELETE FROM sync_runs"),
      env.DB.prepare("DELETE FROM accounts"),
      env.DB.prepare("DELETE FROM connections"),
    ]);

    const connections = [
      {
        id: "connection-stale",
        lastSuccess: "2026-07-15T10:00:00.000Z",
        status: "HEALTHY",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
      {
        id: "connection-failed",
        lastSuccess: "2026-07-15T10:00:00.000Z",
        status: "ERROR",
        updatedAt: "2026-07-15T10:30:00.000Z",
      },
      {
        id: "connection-queued",
        lastSuccess: "2026-07-15T11:30:00.000Z",
        status: "SYNCING",
        updatedAt: "2026-07-15T11:59:00.000Z",
      },
      {
        id: "connection-retry-due",
        lastSuccess: "2026-07-15T11:30:00.000Z",
        status: "ERROR",
        updatedAt: "2026-07-15T11:59:00.000Z",
      },
      {
        id: "connection-lease-expired",
        lastSuccess: "2026-07-15T11:30:00.000Z",
        status: "SYNCING",
        updatedAt: "2026-07-15T11:59:00.000Z",
      },
      {
        id: "connection-fresh",
        lastSuccess: "2026-07-15T11:30:00.000Z",
        status: "HEALTHY",
        updatedAt: "2026-07-15T11:30:00.000Z",
      },
      {
        id: "connection-event",
        lastSuccess: "2026-07-15T11:30:00.000Z",
        status: "HEALTHY",
        updatedAt: "2026-07-15T11:30:00.000Z",
      },
      {
        id: "connection-retry-wait",
        lastSuccess: "2026-07-15T10:00:00.000Z",
        status: "ERROR",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
      {
        id: "connection-lease-live",
        lastSuccess: "2026-07-15T10:00:00.000Z",
        status: "SYNCING",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
      {
        id: "connection-action",
        lastSuccess: "2026-07-15T10:00:00.000Z",
        status: "ACTION_REQUIRED",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
      {
        id: "connection-action-repaired",
        lastSuccess: "2026-07-15T10:00:00.000Z",
        status: "ACTION_REQUIRED",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
      {
        id: "connection-disconnected",
        lastSuccess: "2026-07-15T10:00:00.000Z",
        status: "DISCONNECTED",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
    ] as const;
    for (const [index, connection] of connections.entries()) {
      await env.DB.prepare(
        `INSERT INTO connections (
          id, institution_id, institution_name, plaid_item_id,
          access_token_ciphertext, access_token_iv, token_key_version,
          sync_cursor, status, last_success_at, created_at, updated_at, version
        ) VALUES (?, 'ins_42', 'Fixture Bank', ?, X'0102', X'0304', 1,
          ?, ?, ?, '2026-07-15T09:00:00.000Z', ?, 1)`,
      )
        .bind(
          connection.id,
          `plaid-item-${index}`,
          `cursor-${index}`,
          connection.status,
          connection.lastSuccess,
          connection.updatedAt,
        )
        .run();
    }

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sync_runs (
          id, connection_id, trigger, status, start_cursor, attempt_count,
          created_at, version, next_attempt_at
        ) VALUES ('sync-run-queued', 'connection-queued', 'SCHEDULED', 'QUEUED',
          'cursor-2', 1, '2026-07-15T11:59:00.000Z', 1, '2026-07-15T11:59:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_events (
          id, event_hash, connection_id, event_type, minimal_payload_json,
          status, received_at
        ) VALUES (
          'sync-event-repaired', 'event-hash-repaired', 'connection-action-repaired',
          'TRANSACTIONS.SYNC_UPDATES_AVAILABLE', '{}', 'PENDING',
          '2026-07-15T11:59:00.000Z'
        )`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_events (
          id, event_hash, connection_id, event_type, minimal_payload_json,
          status, received_at
        ) VALUES (
          'sync-event-action-error', 'event-hash-action-error', 'connection-action',
          'ITEM.ERROR', '{}', 'PENDING', '2026-07-15T11:59:00.000Z'
        )`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_runs (
          id, connection_id, trigger, status, start_cursor, attempt_count,
          created_at, version, next_attempt_at
        ) VALUES ('sync-run-retry-due', 'connection-retry-due', 'SCHEDULED',
          'RETRY_WAIT', 'cursor-3', 1, '2026-07-15T11:59:00.000Z', 1,
          '2026-07-15T11:59:59.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_runs (
          id, connection_id, trigger, status, start_cursor, lease_expires_at,
          attempt_count, created_at, started_at, version, lease_token
        ) VALUES ('sync-run-lease-expired', 'connection-lease-expired', 'SCHEDULED',
          'RUNNING', 'cursor-4', '2026-07-15T11:59:59.000Z', 1,
          '2026-07-15T11:58:00.000Z', '2026-07-15T11:58:00.000Z', 1,
          'lease-token-expired-fixture')`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_runs (
          id, connection_id, trigger, status, start_cursor, attempt_count,
          created_at, version, next_attempt_at
        ) VALUES ('sync-run-retry-wait', 'connection-retry-wait', 'SCHEDULED',
          'RETRY_WAIT', 'cursor-6', 1, '2026-07-15T11:59:00.000Z', 1,
          '2026-07-15T12:05:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_runs (
          id, connection_id, trigger, status, start_cursor, lease_expires_at,
          attempt_count, created_at, started_at, version, lease_token
        ) VALUES ('sync-run-lease-live', 'connection-lease-live', 'SCHEDULED',
          'RUNNING', 'cursor-7', '2026-07-15T12:05:00.000Z', 1,
          '2026-07-15T11:58:00.000Z', '2026-07-15T11:58:00.000Z', 1,
          'lease-token-current-fixture')`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_events (
          id, event_hash, connection_id, event_type, minimal_payload_json,
          status, received_at
        ) VALUES (
          'sync-event-candidate', 'event-hash-candidate', 'connection-event',
          'TRANSACTIONS.SYNC_UPDATES_AVAILABLE', '{}', 'PENDING',
          '2026-07-15T11:59:00.000Z'
        )`,
      ),
    ]);

    const candidates = await createRepository().findScheduledCandidates({
      limit: 20,
      now: STARTED_AT,
      staleBefore: "2026-07-15T11:00:00.000Z",
    });

    expect(candidates.map(({ connectionId }) => connectionId).sort()).toEqual([
      "connection-action-repaired",
      "connection-event",
      "connection-failed",
      "connection-lease-expired",
      "connection-queued",
      "connection-retry-due",
      "connection-stale",
    ]);
    expect(candidates.every(({ syncCursor }) => syncCursor?.startsWith("cursor-") === true)).toBe(
      true,
    );
  });

  it("moves retryable failures through exponential backoff before resuming the same run", async () => {
    const repository = createRepository();
    const acquired = await repository.acquire({
      connectionId: "connection-1",
      now: STARTED_AT,
      startCursor: "cursor-1",
      trigger: "WEBHOOK",
    });
    expect(acquired.kind).toBe("ACQUIRED");
    if (acquired.kind !== "ACQUIRED") throw new Error("Expected an acquired lease.");

    const firstFailure = await repository.recordFailure({
      errorCode: "UPSTREAM_UNAVAILABLE",
      leaseToken: acquired.leaseToken,
      now: "2026-07-15T12:00:01.000Z",
      retryable: true,
      runId: acquired.run.id,
    });
    expect(firstFailure).toMatchObject({
      attemptCount: 1,
      nextAttemptAt: "2026-07-15T12:00:16.000Z",
      status: "RETRY_WAIT",
    });

    const early = await repository.acquire({
      connectionId: "connection-1",
      now: "2026-07-15T12:00:15.999Z",
      startCursor: "cursor-1",
      trigger: "SCHEDULED",
    });
    expect(early).toMatchObject({ kind: "EXISTING", run: { status: "RETRY_WAIT" } });

    const resumed = await repository.acquire({
      connectionId: "connection-1",
      now: "2026-07-15T12:00:16.000Z",
      startCursor: "cursor-1",
      trigger: "SCHEDULED",
    });
    expect(resumed).toMatchObject({
      kind: "ACQUIRED",
      run: { attemptCount: 2, id: acquired.run.id, status: "RUNNING" },
    });
    if (resumed.kind !== "ACQUIRED") throw new Error("Expected the retry lease.");

    const secondFailure = await repository.recordFailure({
      errorCode: "UPSTREAM_UNAVAILABLE",
      leaseToken: resumed.leaseToken,
      now: "2026-07-15T12:00:17.000Z",
      retryable: true,
      runId: resumed.run.id,
    });
    expect(secondFailure).toMatchObject({
      attemptCount: 2,
      nextAttemptAt: "2026-07-15T12:00:47.000Z",
      status: "RETRY_WAIT",
    });
  });

  it("reclaims an expired run but rejects the stale worker's token and cursor commit", async () => {
    const repository = createRepository();
    const original = await repository.acquire({
      connectionId: "connection-1",
      leaseMilliseconds: 60_000,
      now: STARTED_AT,
      startCursor: "cursor-1",
      trigger: "WEBHOOK",
    });
    expect(original.kind).toBe("ACQUIRED");
    if (original.kind !== "ACQUIRED") throw new Error("Expected an acquired lease.");

    const resumed = await repository.acquire({
      connectionId: "connection-1",
      leaseMilliseconds: 60_000,
      now: "2026-07-15T12:01:00.001Z",
      startCursor: "cursor-1",
      trigger: "SCHEDULED",
    });
    expect(resumed).toMatchObject({
      kind: "ACQUIRED",
      run: { attemptCount: 2, id: original.run.id },
    });
    if (resumed.kind !== "ACQUIRED") throw new Error("Expected a resumed lease.");
    expect(resumed.leaseToken).not.toBe(original.leaseToken);

    const transactionRepository = new TransactionSyncRepository(env.DB);
    const staleBatch = {
      added: [transaction("stale-transaction")],
      connectionId: "connection-1",
      finalCursor: "stale-cursor",
      initialCursor: "cursor-1",
      modified: [],
      now: "2026-07-15T12:01:00.001Z",
      removed: [],
      runLease: { leaseToken: original.leaseToken, runId: original.run.id },
    };
    await expect(transactionRepository.apply(staleBatch)).rejects.toEqual(
      new TransactionSyncPersistenceError("BATCH_FAILED"),
    );
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT sync_cursor FROM connections WHERE id = 'connection-1'",
      ).first<string>("sync_cursor"),
    ).toBe("cursor-1");

    await transactionRepository.apply({
      ...staleBatch,
      added: [transaction("resumed-transaction")],
      finalCursor: "cursor-2",
      runLease: { leaseToken: resumed.leaseToken, runId: resumed.run.id },
    });

    expect(
      await env.DB.prepare("SELECT plaid_transaction_id FROM transactions").first<string>(
        "plaid_transaction_id",
      ),
    ).toBe("resumed-transaction");
    expect(
      await env.DB.prepare(
        "SELECT sync_cursor FROM connections WHERE id = 'connection-1'",
      ).first<string>("sync_cursor"),
    ).toBe("cursor-2");
    expect(await repository.findById(resumed.run.id)).toMatchObject({
      endCursor: "cursor-2",
      finishedAt: "2026-07-15T12:01:00.001Z",
      leaseExpiresAt: null,
      nextAttemptAt: null,
      status: "SUCCEEDED",
    });
  });
});
