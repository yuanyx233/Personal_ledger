import { describe, expect, it } from "vitest";

import {
  SyncRunPersistenceError,
  SyncRunRepository,
  calculateSyncRetryDelayMilliseconds,
  type SyncRunStatus,
} from "./sync-runs";

const NOW = "2026-07-15T12:00:00.000Z";

interface Row {
  attempt_count: number;
  connection_id: string;
  created_at: string;
  end_cursor: string | null;
  finished_at: string | null;
  id: string;
  idempotency_key: string | null;
  last_error_code: string | null;
  lease_expires_at: string | null;
  lease_token: string | null;
  next_attempt_at: string | null;
  start_cursor: string | null;
  started_at: string | null;
  status: SyncRunStatus;
  trigger: "WEBHOOK" | "SCHEDULED" | "MANUAL" | "INITIAL";
  version: number;
}

interface ScriptedDatabaseInput {
  alls?: Array<Array<{ connection_id: string; sync_cursor: string | null }> | Error>;
  batches?: Array<Array<number> | Error>;
  firsts?: Array<Row | { id: string } | null | Error>;
  runs?: Array<number | Error>;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    attempt_count: 1,
    connection_id: "connection-1",
    created_at: NOW,
    end_cursor: null,
    finished_at: null,
    id: "sync-run-1",
    idempotency_key: null,
    last_error_code: null,
    lease_expires_at: "2026-07-15T12:02:00.000Z",
    lease_token: "lease-token-fixture-current",
    next_attempt_at: null,
    start_cursor: "cursor-1",
    started_at: NOW,
    status: "RUNNING",
    trigger: "WEBHOOK",
    version: 1,
    ...overrides,
  };
}

function scriptedDatabase({
  alls = [],
  batches = [],
  firsts = [],
  runs = [],
}: ScriptedDatabaseInput = {}) {
  const prepared: Array<{ bindings: unknown[]; sql: string }> = [];
  const database = {
    batch() {
      const next = batches.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(
        (next ?? []).map((changes) => ({ meta: { changes } })) as D1Result<unknown>[],
      );
    },
    prepare(sql: string) {
      const recorded = { bindings: [] as unknown[], sql };
      prepared.push(recorded);
      const statement = {
        bind(...bindings: unknown[]) {
          recorded.bindings = bindings;
          return statement;
        },
        all() {
          const next = alls.shift();
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve({ results: next ?? [] });
        },
        first() {
          const next = firsts.shift();
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve(next ?? null);
        },
        run() {
          const next = runs.shift();
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve({ meta: { changes: next ?? 0 } });
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { database, prepared };
}

function repository(database: D1Database, random = () => 0) {
  return new SyncRunRepository(database, {
    createId: () => "sync-run-created",
    createLeaseToken: () => "lease-token-fixture-created",
    random,
  });
}

function acquireInput(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: "connection-1",
    now: NOW,
    startCursor: "cursor-1",
    trigger: "WEBHOOK",
    ...overrides,
  };
}

describe("sync retry policy", () => {
  it("uses capped exponential equal-jitter backoff", () => {
    expect(calculateSyncRetryDelayMilliseconds(1, 0)).toBe(15_000);
    expect(calculateSyncRetryDelayMilliseconds(2, 0)).toBe(30_000);
    expect(calculateSyncRetryDelayMilliseconds(5, 0.999)).toBe(479_760);
  });

  it.each([
    [0, 0],
    [1.5, 0],
    [6, 0],
    [1, -0.1],
    [1, 1],
    [1, Number.NaN],
  ])("rejects invalid retry inputs", (attemptCount, randomValue) => {
    expect(() => calculateSyncRetryDelayMilliseconds(attemptCount, randomValue)).toThrow(
      new SyncRunPersistenceError("INVALID_INPUT"),
    );
  });
});

describe("SyncRunRepository", () => {
  it("creates a new run and returns a token separately from the public run record", async () => {
    const scripted = scriptedDatabase({
      batches: [[1, 1]],
      firsts: [null, row({ id: "sync-run-created", lease_token: "private-token" })],
    });

    const result = await repository(scripted.database).acquire(acquireInput());

    expect(result).toMatchObject({
      kind: "ACQUIRED",
      leaseToken: "lease-token-fixture-created",
      run: { attemptCount: 1, id: "sync-run-created", status: "RUNNING" },
    });
    expect(result.run).not.toHaveProperty("leaseToken");
    expect(scripted.prepared.map(({ sql }) => sql).join("\n")).not.toContain(
      "lease-token-fixture-created",
    );
    expect(scripted.prepared.flatMap(({ bindings }) => bindings)).toContain(
      "lease-token-fixture-created",
    );
  });

  it("returns a live active run without issuing a competing write", async () => {
    const scripted = scriptedDatabase({ firsts: [row()] });

    await expect(repository(scripted.database).acquire(acquireInput())).resolves.toMatchObject({
      kind: "EXISTING",
      run: { id: "sync-run-1", status: "RUNNING" },
    });
    expect(scripted.prepared).toHaveLength(1);
  });

  it("does not create a replacement when a targeted run already finished", async () => {
    const completed = row({
      finished_at: NOW,
      lease_expires_at: null,
      lease_token: null,
      status: "SUCCEEDED",
    });
    const scripted = scriptedDatabase({ firsts: [null, completed] });

    await expect(
      repository(scripted.database).acquire(acquireInput({ runId: "sync-run-1" })),
    ).resolves.toMatchObject({ kind: "EXISTING", run: { status: "SUCCEEDED" } });
    expect(scripted.prepared).toHaveLength(2);
  });

  it("creates a queued manual run and stores the request key separately", async () => {
    const created = row({
      attempt_count: 0,
      id: "sync-run-created",
      idempotency_key: null,
      lease_expires_at: null,
      lease_token: null,
      next_attempt_at: NOW,
      started_at: null,
      status: "QUEUED",
      trigger: "MANUAL",
    });
    const scripted = scriptedDatabase({ batches: [[1, 1]], firsts: [null, null, created] });

    await expect(
      repository(scripted.database).enqueueManual({
        connectionId: "connection-1",
        idempotencyKey: "manual-sync-key-0001",
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: "CREATED", run: { id: "sync-run-created" } });
    expect(scripted.prepared.map(({ sql }) => sql).join("\n")).toContain("sync_run_requests");
  });

  it("replays a completed manual request and maps a new key to an active run", async () => {
    const completed = row({ finished_at: NOW, status: "SUCCEEDED" });
    const replay = scriptedDatabase({ firsts: [completed] });
    await expect(
      repository(replay.database).enqueueManual({
        connectionId: "connection-1",
        idempotencyKey: "manual-sync-key-0001",
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: "REPLAY", run: { status: "SUCCEEDED" } });

    const active = row({ status: "QUEUED" });
    const reused = scriptedDatabase({ firsts: [null, active, active], runs: [1] });
    await expect(
      repository(reused.database).enqueueManual({
        connectionId: "connection-1",
        idempotencyKey: "manual-sync-key-0002",
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: "EXISTING_ACTIVE", run: { id: "sync-run-1" } });
  });

  it("reports a missing connection when a manual enqueue cannot create a run", async () => {
    const scripted = scriptedDatabase({
      batches: [[0, 0]],
      firsts: [null, null, null],
    });

    await expect(
      repository(scripted.database).enqueueManual({
        connectionId: "connection-missing",
        idempotencyKey: "manual-sync-key-0001",
        now: NOW,
      }),
    ).rejects.toEqual(new SyncRunPersistenceError("NOT_FOUND"));
  });

  it("maps bounded scheduled candidates without exposing token material", async () => {
    const scripted = scriptedDatabase({
      alls: [
        [
          { connection_id: "connection-1", sync_cursor: "cursor-1" },
          { connection_id: "connection-2", sync_cursor: null },
        ],
      ],
    });

    await expect(
      repository(scripted.database).findScheduledCandidates({
        limit: 2,
        now: NOW,
        staleBefore: "2026-07-15T11:00:00.000Z",
      }),
    ).resolves.toEqual([
      { connectionId: "connection-1", syncCursor: "cursor-1" },
      { connectionId: "connection-2", syncCursor: null },
    ]);
    expect(scripted.prepared[0]?.bindings).toEqual([
      "2026-07-15T11:00:00.000Z",
      "2026-07-15T11:00:00.000Z",
      NOW,
      NOW,
      2,
    ]);
  });

  it("sanitizes scheduled candidate query failures", async () => {
    const scripted = scriptedDatabase({ alls: [new Error("private query detail")] });

    await expect(
      repository(scripted.database).findScheduledCandidates({
        limit: 2,
        now: NOW,
        staleBefore: "2026-07-15T11:00:00.000Z",
      }),
    ).rejects.toEqual(new SyncRunPersistenceError("DATABASE_FAILURE"));
  });

  it.each([
    row({ status: "QUEUED", lease_expires_at: null }),
    row({
      lease_expires_at: null,
      next_attempt_at: NOW,
      status: "RETRY_WAIT",
    }),
    row({ lease_expires_at: "2026-07-15T11:59:59.999Z" }),
  ])("reclaims resumable state $status with optimistic versioning", async (active) => {
    const updated = row({
      attempt_count: 2,
      lease_token: "lease-token-fixture-created",
      status: "RUNNING",
      version: 2,
    });
    const scripted = scriptedDatabase({ batches: [[1, 1]], firsts: [active, updated] });

    await expect(repository(scripted.database).acquire(acquireInput())).resolves.toMatchObject({
      kind: "ACQUIRED",
      run: { attemptCount: 2, status: "RUNNING", version: 2 },
    });
  });

  it("returns the winning run when an optimistic reclaim loses a race", async () => {
    const expired = row({ lease_expires_at: "2026-07-15T11:59:59.999Z" });
    const winner = row({ lease_token: "winner-token-private" });
    const scripted = scriptedDatabase({ batches: [[0, 0]], firsts: [expired, winner] });

    await expect(repository(scripted.database).acquire(acquireInput())).resolves.toMatchObject({
      kind: "EXISTING",
      run: { id: "sync-run-1" },
    });
  });

  it("returns the winner when a concurrent insert claims the Item", async () => {
    const scripted = scriptedDatabase({ batches: [[0, 0]], firsts: [null, row()] });

    await expect(repository(scripted.database).acquire(acquireInput())).resolves.toMatchObject({
      kind: "EXISTING",
      run: { id: "sync-run-1" },
    });
  });

  it("returns a completed run for a repeated idempotency key", async () => {
    const completed = row({
      finished_at: NOW,
      idempotency_key: "manual-sync-key-0001",
      lease_expires_at: null,
      lease_token: null,
      status: "SUCCEEDED",
    });
    const scripted = scriptedDatabase({
      batches: [[0, 0]],
      firsts: [null, null, completed],
    });

    await expect(
      repository(scripted.database).acquire(
        acquireInput({ idempotencyKey: "manual-sync-key-0001" }),
      ),
    ).resolves.toMatchObject({
      kind: "EXISTING",
      run: { id: "sync-run-1", status: "SUCCEEDED" },
    });
  });

  it("reports a missing connection without leaking database details", async () => {
    const scripted = scriptedDatabase({
      batches: [[0, 0]],
      firsts: [null, null, null],
    });

    await expect(repository(scripted.database).acquire(acquireInput())).rejects.toEqual(
      new SyncRunPersistenceError("NOT_FOUND"),
    );
  });

  it("renews only a still-valid matching lease", async () => {
    const renewed = row({ lease_expires_at: "2026-07-15T12:04:00.000Z", version: 2 });
    const success = scriptedDatabase({ firsts: [renewed], runs: [1] });
    const lost = scriptedDatabase({ runs: [0] });

    await expect(
      repository(success.database).renew({
        leaseMilliseconds: 240_000,
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        runId: "sync-run-1",
      }),
    ).resolves.toMatchObject({ leaseExpiresAt: "2026-07-15T12:04:00.000Z", version: 2 });
    await expect(
      repository(lost.database).renew({
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        runId: "sync-run-1",
      }),
    ).resolves.toBeNull();
  });

  it("releases valid work as queued for a later safe resume", async () => {
    const queued = row({
      lease_expires_at: null,
      lease_token: null,
      next_attempt_at: NOW,
      status: "QUEUED",
      version: 2,
    });
    const success = scriptedDatabase({ firsts: [queued], runs: [1] });
    const lost = scriptedDatabase({ runs: [0] });

    await expect(
      repository(success.database).releaseForResume({
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        runId: "sync-run-1",
      }),
    ).resolves.toMatchObject({ nextAttemptAt: NOW, status: "QUEUED", version: 2 });
    await expect(
      repository(lost.database).releaseForResume({
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        runId: "sync-run-1",
      }),
    ).resolves.toBeNull();
  });

  it("records retry wait with bounded jitter and sanitizes the connection error", async () => {
    const retryWait = row({
      last_error_code: "UPSTREAM_UNAVAILABLE",
      lease_expires_at: null,
      lease_token: null,
      next_attempt_at: "2026-07-15T12:00:22.500Z",
      status: "RETRY_WAIT",
      version: 2,
    });
    const scripted = scriptedDatabase({ batches: [[1, 1]], firsts: [row(), retryWait] });

    await expect(
      repository(scripted.database, () => 0.5).recordFailure({
        errorCode: "UPSTREAM_UNAVAILABLE",
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        retryable: true,
        runId: "sync-run-1",
      }),
    ).resolves.toMatchObject({
      lastErrorCode: "UPSTREAM_UNAVAILABLE",
      nextAttemptAt: "2026-07-15T12:00:22.500Z",
      status: "RETRY_WAIT",
    });
  });

  it.each([
    { retryable: false, current: row(), name: "a non-retryable failure" },
    {
      retryable: true,
      current: row({ attempt_count: 5 }),
      name: "the maximum attempt",
    },
  ])("finishes $name as failed", async ({ current, retryable }) => {
    const failed = row({
      ...current,
      finished_at: NOW,
      last_error_code: "SYNC_FAILED",
      lease_expires_at: null,
      lease_token: null,
      status: "FAILED",
      version: current.version + 1,
    });
    const scripted = scriptedDatabase({ batches: [[1, 1]], firsts: [current, failed] });

    await expect(
      repository(scripted.database).recordFailure({
        errorCode: "SYNC_FAILED",
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        retryable,
        runId: "sync-run-1",
      }),
    ).resolves.toMatchObject({ finishedAt: NOW, nextAttemptAt: null, status: "FAILED" });
  });

  it("does not mutate a run after its lease is lost", async () => {
    const scripted = scriptedDatabase({ batches: [[0, 0]], firsts: [row()] });

    await expect(
      repository(scripted.database).recordFailure({
        errorCode: "UPSTREAM_UNAVAILABLE",
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        retryable: true,
        runId: "sync-run-1",
      }),
    ).resolves.toBeNull();
  });

  it("finds sanitized records and handles missing rows", async () => {
    const scripted = scriptedDatabase({ firsts: [row(), null] });
    const subject = repository(scripted.database);

    await expect(subject.findById("sync-run-1")).resolves.toMatchObject({ id: "sync-run-1" });
    await expect(subject.findById("sync-run-missing")).resolves.toBeNull();
  });

  it.each([
    () => repository(scriptedDatabase().database).acquire({}),
    () => repository(scriptedDatabase().database).findById(""),
    () => repository(scriptedDatabase().database).enqueueManual({}),
    () => repository(scriptedDatabase().database).findScheduledCandidates({ limit: 0 }),
    () =>
      repository(scriptedDatabase().database).recordFailure({
        errorCode: "private error text",
        leaseToken: "short",
        now: "not-a-date",
        retryable: true,
        runId: "sync-run-1",
      }),
  ])("rejects invalid inputs before database execution", async (operation) => {
    await expect(operation()).rejects.toEqual(new SyncRunPersistenceError("INVALID_INPUT"));
  });

  it.each([
    {
      operation: (subject: SyncRunRepository) => subject.findById("sync-run-1"),
      scripted: scriptedDatabase({ firsts: [new Error("private read error")] }),
    },
    {
      operation: (subject: SyncRunRepository) => subject.acquire(acquireInput()),
      scripted: scriptedDatabase({ batches: [new Error("private batch error")], firsts: [null] }),
    },
    {
      operation: (subject: SyncRunRepository) => subject.acquire(acquireInput()),
      scripted: scriptedDatabase({
        batches: [[0, 0]],
        firsts: [null, null, new Error("private connection read error")],
      }),
    },
    {
      operation: (subject: SyncRunRepository) =>
        subject.renew({
          leaseToken: "lease-token-fixture-current",
          now: NOW,
          runId: "sync-run-1",
        }),
      scripted: scriptedDatabase({ runs: [new Error("private renew error")] }),
    },
    {
      operation: (subject: SyncRunRepository) =>
        subject.releaseForResume({
          leaseToken: "lease-token-fixture-current",
          now: NOW,
          runId: "sync-run-1",
        }),
      scripted: scriptedDatabase({ runs: [new Error("private release error")] }),
    },
    {
      operation: (subject: SyncRunRepository) =>
        subject.recordFailure({
          errorCode: "UPSTREAM_UNAVAILABLE",
          leaseToken: "lease-token-fixture-current",
          now: NOW,
          retryable: true,
          runId: "sync-run-1",
        }),
      scripted: scriptedDatabase({
        batches: [new Error("private failure write")],
        firsts: [row()],
      }),
    },
  ])("maps database exceptions to one stable error", async ({ operation, scripted }) => {
    await expect(operation(repository(scripted.database))).rejects.toEqual(
      new SyncRunPersistenceError("DATABASE_FAILURE"),
    );
  });

  it("rejects a failure for an unknown run", async () => {
    const scripted = scriptedDatabase({ firsts: [null] });
    await expect(
      repository(scripted.database).recordFailure({
        errorCode: "UPSTREAM_UNAVAILABLE",
        leaseToken: "lease-token-fixture-current",
        now: NOW,
        retryable: true,
        runId: "sync-run-missing",
      }),
    ).rejects.toEqual(new SyncRunPersistenceError("NOT_FOUND"));
  });
});
