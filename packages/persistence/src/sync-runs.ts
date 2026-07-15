import * as z from "zod";

const DEFAULT_LEASE_MILLISECONDS = 2 * 60 * 1000;
const MINIMUM_LEASE_MILLISECONDS = 1_000;
const MAXIMUM_LEASE_MILLISECONDS = 15 * 60 * 1000;
const RETRY_BASE_MILLISECONDS = 30_000;
const RETRY_MAXIMUM_MILLISECONDS = 60 * 60 * 1000;
const MAXIMUM_ATTEMPTS = 5;
const ACTIVE_STATUSES = ["QUEUED", "RUNNING", "RETRY_WAIT"] as const;
const identifierSchema = z.string().min(1).max(160);
const cursorSchema = z.string().max(256).nullable();
const timestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const acquireSchema = z.strictObject({
  connectionId: identifierSchema,
  idempotencyKey: z.string().min(16).max(160).optional(),
  leaseMilliseconds: z
    .int()
    .min(MINIMUM_LEASE_MILLISECONDS)
    .max(MAXIMUM_LEASE_MILLISECONDS)
    .default(DEFAULT_LEASE_MILLISECONDS),
  now: timestampSchema,
  runId: identifierSchema.optional(),
  startCursor: cursorSchema,
  trigger: z.enum(["WEBHOOK", "SCHEDULED", "MANUAL", "INITIAL"]),
});
const runActionSchema = z.strictObject({
  leaseToken: z.string().min(16).max(160),
  now: timestampSchema,
  runId: identifierSchema,
});
const failureSchema = runActionSchema.extend({
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  retryable: z.boolean(),
});
const renewSchema = runActionSchema.extend({
  leaseMilliseconds: z
    .int()
    .min(MINIMUM_LEASE_MILLISECONDS)
    .max(MAXIMUM_LEASE_MILLISECONDS)
    .default(DEFAULT_LEASE_MILLISECONDS),
});
const scheduledCandidatesSchema = z.strictObject({
  limit: z.int().min(1).max(100),
  now: timestampSchema,
  staleBefore: timestampSchema,
});
const manualEnqueueSchema = z.strictObject({
  connectionId: identifierSchema,
  idempotencyKey: z.string().min(16).max(160),
  now: timestampSchema,
});

export type SyncRunStatus = "QUEUED" | "RUNNING" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED" | "PAUSED";

export interface SyncRunRecord {
  attemptCount: number;
  connectionId: string;
  createdAt: string;
  endCursor: string | null;
  finishedAt: string | null;
  id: string;
  idempotencyKey: string | null;
  lastErrorCode: string | null;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
  startCursor: string | null;
  startedAt: string | null;
  status: SyncRunStatus;
  trigger: "WEBHOOK" | "SCHEDULED" | "MANUAL" | "INITIAL";
  version: number;
}

export interface ScheduledSyncCandidate {
  connectionId: string;
  syncCursor: string | null;
}

export type SyncRunAcquisition =
  | { kind: "ACQUIRED"; leaseToken: string; run: SyncRunRecord }
  | { kind: "EXISTING"; run: SyncRunRecord };

export type ManualSyncRunEnqueueResult = {
  kind: "CREATED" | "EXISTING_ACTIVE" | "REPLAY";
  run: SyncRunRecord;
};

export type SyncRunPersistenceErrorCode = "DATABASE_FAILURE" | "INVALID_INPUT" | "NOT_FOUND";

export class SyncRunPersistenceError extends Error {
  constructor(readonly code: SyncRunPersistenceErrorCode) {
    super(code);
    this.name = "SyncRunPersistenceError";
  }
}

interface SyncRunRow {
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
  trigger: SyncRunRecord["trigger"];
  version: number;
}

interface ScheduledSyncCandidateRow {
  connection_id: string;
  sync_cursor: string | null;
}

interface SyncRunRepositoryOptions {
  createId?: () => string;
  createLeaseToken?: () => string;
  random?: () => number;
}

const RUN_COLUMNS = `
  id, connection_id, trigger, status, idempotency_key, start_cursor, end_cursor,
  lease_expires_at, attempt_count, last_error_code, created_at, started_at,
  finished_at, version, lease_token, next_attempt_at
`;

const QUALIFIED_RUN_COLUMNS = `
  sync_runs.id, sync_runs.connection_id, sync_runs.trigger, sync_runs.status,
  sync_runs.idempotency_key, sync_runs.start_cursor, sync_runs.end_cursor,
  sync_runs.lease_expires_at, sync_runs.attempt_count, sync_runs.last_error_code,
  sync_runs.created_at, sync_runs.started_at, sync_runs.finished_at,
  sync_runs.version, sync_runs.lease_token, sync_runs.next_attempt_at
`;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new SyncRunPersistenceError("INVALID_INPUT");
  return result.data;
}

function toRecord(row: SyncRunRow): SyncRunRecord {
  return {
    attemptCount: row.attempt_count,
    connectionId: row.connection_id,
    createdAt: row.created_at,
    endCursor: row.end_cursor,
    finishedAt: row.finished_at,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    lastErrorCode: row.last_error_code,
    leaseExpiresAt: row.lease_expires_at,
    nextAttemptAt: row.next_attempt_at,
    startCursor: row.start_cursor,
    startedAt: row.started_at,
    status: row.status,
    trigger: row.trigger,
    version: row.version,
  };
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

export function calculateSyncRetryDelayMilliseconds(
  attemptCount: number,
  randomValue: number,
): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > MAXIMUM_ATTEMPTS) {
    throw new SyncRunPersistenceError("INVALID_INPUT");
  }
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new SyncRunPersistenceError("INVALID_INPUT");
  }
  const exponential = Math.min(
    RETRY_MAXIMUM_MILLISECONDS,
    RETRY_BASE_MILLISECONDS * 2 ** (attemptCount - 1),
  );
  return Math.round(exponential * (0.5 + randomValue * 0.5));
}

export class SyncRunRepository {
  private readonly createId: () => string;
  private readonly createLeaseToken: () => string;
  private readonly random: () => number;

  constructor(
    private readonly database: D1Database,
    {
      createId = () => `sync-run-${crypto.randomUUID()}`,
      createLeaseToken = () => `sync-lease-${crypto.randomUUID()}`,
      random = Math.random,
    }: SyncRunRepositoryOptions = {},
  ) {
    this.createId = createId;
    this.createLeaseToken = createLeaseToken;
    this.random = random;
  }

  async findById(runId: unknown): Promise<SyncRunRecord | null> {
    const validatedRunId = parse(identifierSchema, runId);
    try {
      const row = await this.database
        .prepare(`SELECT ${RUN_COLUMNS} FROM sync_runs WHERE id = ?`)
        .bind(validatedRunId)
        .first<SyncRunRow>();
      return row ? toRecord(row) : null;
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  async acquire(input: unknown): Promise<SyncRunAcquisition> {
    const parsed = parse(acquireSchema, input);
    return this.acquireValidated(parsed, 0);
  }

  async findScheduledCandidates(input: unknown): Promise<ScheduledSyncCandidate[]> {
    const parsed = parse(scheduledCandidatesSchema, input);
    try {
      const result = await this.database
        .prepare(
          `SELECT connections.id AS connection_id, connections.sync_cursor
           FROM connections
           LEFT JOIN sync_runs
             ON sync_runs.connection_id = connections.id
            AND sync_runs.status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT')
           WHERE connections.status IN ('HEALTHY', 'ERROR', 'SYNCING', 'ACTION_REQUIRED')
             AND (
               (sync_runs.id IS NULL AND (
                 EXISTS (
                   SELECT 1 FROM sync_events
                   WHERE sync_events.connection_id = connections.id
                     AND sync_events.status = 'PENDING'
                     AND (
                       sync_events.event_type LIKE 'TRANSACTIONS.%' OR
                       sync_events.event_type = 'ITEM.LOGIN_REPAIRED'
                     )
                 ) OR
                 (connections.status = 'HEALTHY' AND (
                   connections.last_success_at IS NULL OR connections.last_success_at <= ?
                 )) OR
                 (connections.status IN ('ERROR', 'SYNCING') AND connections.updated_at <= ?)
               )) OR
               sync_runs.status = 'QUEUED' OR
               (sync_runs.status = 'RETRY_WAIT' AND sync_runs.next_attempt_at <= ?) OR
               (sync_runs.status = 'RUNNING' AND (
                 sync_runs.lease_expires_at IS NULL OR sync_runs.lease_expires_at <= ?
               ))
             )
           ORDER BY
             CASE WHEN sync_runs.id IS NOT NULL OR EXISTS (
                    SELECT 1 FROM sync_events
                    WHERE sync_events.connection_id = connections.id
                      AND sync_events.status = 'PENDING'
                      AND (
                        sync_events.event_type LIKE 'TRANSACTIONS.%' OR
                        sync_events.event_type = 'ITEM.LOGIN_REPAIRED'
                      )
                  ) THEN 0
                  WHEN connections.status IN ('ERROR', 'SYNCING') THEN 1
                  ELSE 2 END,
             COALESCE(
               sync_runs.next_attempt_at,
               sync_runs.lease_expires_at,
               connections.last_success_at,
               connections.updated_at
             ),
             connections.id
           LIMIT ?`,
        )
        .bind(parsed.staleBefore, parsed.staleBefore, parsed.now, parsed.now, parsed.limit)
        .all<ScheduledSyncCandidateRow>();
      return result.results.map((row) => ({
        connectionId: row.connection_id,
        syncCursor: row.sync_cursor,
      }));
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  async enqueueManual(input: unknown): Promise<ManualSyncRunEnqueueResult> {
    const parsed = parse(manualEnqueueSchema, input);
    return this.enqueueManualValidated(parsed, 0);
  }

  async renew(input: unknown): Promise<SyncRunRecord | null> {
    const parsed = parse(renewSchema, input);
    const leaseExpiresAt = addMilliseconds(parsed.now, parsed.leaseMilliseconds);
    try {
      const result = await this.database
        .prepare(
          `UPDATE sync_runs
           SET lease_expires_at = ?, version = version + 1
           WHERE id = ? AND status = 'RUNNING' AND lease_token = ?
             AND lease_expires_at > ?`,
        )
        .bind(leaseExpiresAt, parsed.runId, parsed.leaseToken, parsed.now)
        .run();
      if (result.meta.changes !== 1) return null;
      return await this.findById(parsed.runId);
    } catch (error) {
      if (error instanceof SyncRunPersistenceError) throw error;
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  async releaseForResume(input: unknown): Promise<SyncRunRecord | null> {
    const parsed = parse(runActionSchema, input);
    try {
      const result = await this.database
        .prepare(
          `UPDATE sync_runs
           SET status = 'QUEUED', lease_expires_at = NULL, lease_token = NULL,
               next_attempt_at = ?, version = version + 1
           WHERE id = ? AND status = 'RUNNING' AND lease_token = ?
             AND lease_expires_at > ?`,
        )
        .bind(parsed.now, parsed.runId, parsed.leaseToken, parsed.now)
        .run();
      if (result.meta.changes !== 1) return null;
      return await this.findById(parsed.runId);
    } catch (error) {
      if (error instanceof SyncRunPersistenceError) throw error;
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  async recordFailure(input: unknown): Promise<SyncRunRecord | null> {
    const parsed = parse(failureSchema, input);
    const current = await this.findRowById(parsed.runId);
    if (!current) throw new SyncRunPersistenceError("NOT_FOUND");

    const shouldRetry = parsed.retryable && current.attempt_count < MAXIMUM_ATTEMPTS;
    const nextAttemptAt = shouldRetry
      ? addMilliseconds(
          parsed.now,
          calculateSyncRetryDelayMilliseconds(current.attempt_count, this.random()),
        )
      : null;
    const status = shouldRetry ? "RETRY_WAIT" : "FAILED";
    try {
      const results = await this.database.batch([
        this.database
          .prepare(
            `UPDATE sync_runs
             SET status = ?, lease_expires_at = NULL, lease_token = NULL,
                 next_attempt_at = ?, last_error_code = ?, finished_at = ?,
                 version = version + 1
             WHERE id = ? AND version = ? AND status = 'RUNNING' AND lease_token = ?
               AND lease_expires_at > ?`,
          )
          .bind(
            status,
            nextAttemptAt,
            parsed.errorCode,
            shouldRetry ? null : parsed.now,
            parsed.runId,
            current.version,
            parsed.leaseToken,
            parsed.now,
          ),
        this.database
          .prepare(
            `UPDATE connections
             SET status = CASE
                   WHEN ? = 'ITEM_LOGIN_REQUIRED' THEN 'ACTION_REQUIRED'
                   ELSE 'ERROR'
                 END,
                 last_error_code = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM sync_runs
               WHERE id = ? AND version = ? AND status = ? AND last_error_code = ?
             )`,
          )
          .bind(
            parsed.errorCode,
            parsed.errorCode,
            parsed.now,
            current.connection_id,
            parsed.runId,
            current.version + 1,
            status,
            parsed.errorCode,
          ),
      ]);
      if (results[0]?.meta.changes !== 1) return null;
      return await this.findById(parsed.runId);
    } catch (error) {
      if (error instanceof SyncRunPersistenceError) throw error;
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  private async acquireValidated(
    input: z.infer<typeof acquireSchema>,
    retryCount: number,
  ): Promise<SyncRunAcquisition> {
    if (retryCount > 3) throw new SyncRunPersistenceError("DATABASE_FAILURE");
    const active = await this.findActive(input.connectionId);
    if (active) {
      if (input.runId && active.id !== input.runId) {
        return { kind: "EXISTING", run: toRecord(active) };
      }
      const resumable =
        active.status === "QUEUED" ||
        (active.status === "RETRY_WAIT" &&
          active.next_attempt_at !== null &&
          active.next_attempt_at <= input.now) ||
        (active.status === "RUNNING" &&
          (active.lease_expires_at === null || active.lease_expires_at <= input.now));
      if (!resumable) return { kind: "EXISTING", run: toRecord(active) };

      const leaseToken = parse(z.string().min(16).max(160), this.createLeaseToken());
      const leaseExpiresAt = addMilliseconds(input.now, input.leaseMilliseconds);
      try {
        const results = await this.database.batch([
          this.database
            .prepare(
              `UPDATE sync_runs
               SET status = 'RUNNING', lease_expires_at = ?, lease_token = ?,
                   next_attempt_at = NULL, attempt_count = attempt_count + 1,
                   started_at = COALESCE(started_at, ?), version = version + 1
               WHERE id = ? AND version = ? AND (
                 status = 'QUEUED' OR
                 (status = 'RETRY_WAIT' AND next_attempt_at <= ?) OR
                 (status = 'RUNNING' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
               )`,
            )
            .bind(
              leaseExpiresAt,
              leaseToken,
              input.now,
              active.id,
              active.version,
              input.now,
              input.now,
            ),
          this.database
            .prepare(
              `UPDATE connections
               SET status = 'SYNCING', last_error_code = NULL, updated_at = ?,
                   version = version + 1
               WHERE id = ? AND EXISTS (
                 SELECT 1 FROM sync_runs
                 WHERE id = ? AND version = ? AND status = 'RUNNING' AND lease_token = ?
               )`,
            )
            .bind(input.now, input.connectionId, active.id, active.version + 1, leaseToken),
        ]);
        if (results[0]?.meta.changes === 1) {
          const run = await this.findById(active.id);
          if (!run) throw new SyncRunPersistenceError("DATABASE_FAILURE");
          return { kind: "ACQUIRED", leaseToken, run };
        }
      } catch (error) {
        if (error instanceof SyncRunPersistenceError) throw error;
        throw new SyncRunPersistenceError("DATABASE_FAILURE");
      }
      return this.acquireValidated(input, retryCount + 1);
    }

    if (input.runId) {
      const requested = await this.findRowById(input.runId);
      if (!requested || requested.connection_id !== input.connectionId) {
        throw new SyncRunPersistenceError("NOT_FOUND");
      }
      return { kind: "EXISTING", run: toRecord(requested) };
    }

    const runId = parse(identifierSchema, this.createId());
    const leaseToken = parse(z.string().min(16).max(160), this.createLeaseToken());
    const leaseExpiresAt = addMilliseconds(input.now, input.leaseMilliseconds);
    try {
      const results = await this.database.batch([
        this.database
          .prepare(
            `INSERT OR IGNORE INTO sync_runs (
              id, connection_id, trigger, status, idempotency_key, start_cursor,
              end_cursor, lease_expires_at, attempt_count, last_error_code,
              created_at, started_at, finished_at, version, lease_token, next_attempt_at
            )
            SELECT ?, id, ?, 'RUNNING', ?, ?, NULL, ?, 1, NULL, ?, ?, NULL, 1, ?, NULL
            FROM connections WHERE id = ?`,
          )
          .bind(
            runId,
            input.trigger,
            input.idempotencyKey ?? null,
            input.startCursor,
            leaseExpiresAt,
            input.now,
            input.now,
            leaseToken,
            input.connectionId,
          ),
        this.database
          .prepare(
            `UPDATE connections
             SET status = 'SYNCING', last_error_code = NULL, updated_at = ?,
                 version = version + 1
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM sync_runs WHERE id = ? AND status = 'RUNNING' AND lease_token = ?
             )`,
          )
          .bind(input.now, input.connectionId, runId, leaseToken),
      ]);
      if (results[0]?.meta.changes === 1) {
        const run = await this.findById(runId);
        if (!run) throw new SyncRunPersistenceError("DATABASE_FAILURE");
        return { kind: "ACQUIRED", leaseToken, run };
      }
    } catch (error) {
      if (error instanceof SyncRunPersistenceError) throw error;
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }

    const winner = await this.findActive(input.connectionId);
    if (winner) return { kind: "EXISTING", run: toRecord(winner) };
    if (input.idempotencyKey) {
      const idempotentRun = await this.findByIdempotencyKey(
        input.connectionId,
        input.idempotencyKey,
      );
      if (idempotentRun) return { kind: "EXISTING", run: toRecord(idempotentRun) };
    }

    let connection: { id: string } | null;
    try {
      connection = await this.database
        .prepare("SELECT id FROM connections WHERE id = ?")
        .bind(input.connectionId)
        .first<{ id: string }>();
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
    if (!connection) throw new SyncRunPersistenceError("NOT_FOUND");
    return this.acquireValidated(input, retryCount + 1);
  }

  private async enqueueManualValidated(
    input: z.infer<typeof manualEnqueueSchema>,
    retryCount: number,
  ): Promise<ManualSyncRunEnqueueResult> {
    if (retryCount > 3) throw new SyncRunPersistenceError("DATABASE_FAILURE");
    const replay = await this.findManualRequest(input.connectionId, input.idempotencyKey);
    if (replay) return { kind: "REPLAY", run: toRecord(replay) };

    const active = await this.findActive(input.connectionId);
    if (active) {
      try {
        await this.database
          .prepare(
            `INSERT OR IGNORE INTO sync_run_requests (
              connection_id, idempotency_key, run_id, created_at
            ) SELECT ?, ?, id, ? FROM sync_runs WHERE id = ? AND connection_id = ?`,
          )
          .bind(input.connectionId, input.idempotencyKey, input.now, active.id, input.connectionId)
          .run();
      } catch {
        throw new SyncRunPersistenceError("DATABASE_FAILURE");
      }
      const mapped = await this.findManualRequest(input.connectionId, input.idempotencyKey);
      if (mapped) return { kind: "EXISTING_ACTIVE", run: toRecord(mapped) };
      return this.enqueueManualValidated(input, retryCount + 1);
    }

    const runId = parse(identifierSchema, this.createId());
    try {
      const results = await this.database.batch([
        this.database
          .prepare(
            `INSERT OR IGNORE INTO sync_runs (
              id, connection_id, trigger, status, idempotency_key, start_cursor,
              end_cursor, lease_expires_at, attempt_count, last_error_code,
              created_at, started_at, finished_at, version, lease_token, next_attempt_at
            )
            SELECT ?, id, 'MANUAL', 'QUEUED', NULL, sync_cursor, NULL, NULL, 0, NULL,
                   ?, NULL, NULL, 1, NULL, ?
            FROM connections
            WHERE id = ? AND NOT EXISTS (
              SELECT 1 FROM sync_run_requests
              WHERE connection_id = ? AND idempotency_key = ?
            )`,
          )
          .bind(
            runId,
            input.now,
            input.now,
            input.connectionId,
            input.connectionId,
            input.idempotencyKey,
          ),
        this.database
          .prepare(
            `INSERT OR IGNORE INTO sync_run_requests (
              connection_id, idempotency_key, run_id, created_at
            ) SELECT ?, ?, id, ? FROM sync_runs WHERE id = ? AND connection_id = ?`,
          )
          .bind(input.connectionId, input.idempotencyKey, input.now, runId, input.connectionId),
      ]);
      if (results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1) {
        const run = await this.findById(runId);
        if (!run) throw new SyncRunPersistenceError("DATABASE_FAILURE");
        return { kind: "CREATED", run };
      }
    } catch (error) {
      if (error instanceof SyncRunPersistenceError) throw error;
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }

    const connection = await this.findConnection(input.connectionId);
    if (!connection) throw new SyncRunPersistenceError("NOT_FOUND");
    return this.enqueueManualValidated(input, retryCount + 1);
  }

  private async findManualRequest(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<SyncRunRow | null> {
    try {
      return await this.database
        .prepare(
          `SELECT ${QUALIFIED_RUN_COLUMNS} FROM sync_run_requests
           JOIN sync_runs ON sync_runs.id = sync_run_requests.run_id
           WHERE sync_run_requests.connection_id = ?
             AND sync_run_requests.idempotency_key = ? LIMIT 1`,
        )
        .bind(connectionId, idempotencyKey)
        .first<SyncRunRow>();
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  private async findConnection(connectionId: string): Promise<{ id: string } | null> {
    try {
      return await this.database
        .prepare("SELECT id FROM connections WHERE id = ?")
        .bind(connectionId)
        .first<{ id: string }>();
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  private async findByIdempotencyKey(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<SyncRunRow | null> {
    try {
      return await this.database
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM sync_runs
           WHERE connection_id = ? AND idempotency_key = ? LIMIT 1`,
        )
        .bind(connectionId, idempotencyKey)
        .first<SyncRunRow>();
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  private async findActive(connectionId: string): Promise<SyncRunRow | null> {
    try {
      return await this.database
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM sync_runs
           WHERE connection_id = ? AND status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT')
           ORDER BY created_at, id LIMIT 1`,
        )
        .bind(connectionId)
        .first<SyncRunRow>();
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }

  private async findRowById(runId: string): Promise<SyncRunRow | null> {
    try {
      return await this.database
        .prepare(`SELECT ${RUN_COLUMNS} FROM sync_runs WHERE id = ?`)
        .bind(runId)
        .first<SyncRunRow>();
    } catch {
      throw new SyncRunPersistenceError("DATABASE_FAILURE");
    }
  }
}

export const SYNC_RUN_ACTIVE_STATUSES = ACTIVE_STATUSES;
