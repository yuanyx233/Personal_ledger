import {
  syncRunCreateResponseSchema,
  syncRunStatusResponseSchema,
  type SyncWorkerService,
} from "@ledger/domain/api-contracts";
import { SyncRunRepository } from "@ledger/persistence";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const dispatch = vi.fn<SyncWorkerService["syncConnection"]>();
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
  SYNC: { syncConnection: dispatch },
} as unknown as AppEnv;
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  undefined,
  () => NOW,
);

let csrfToken: string;
let backgroundTasks: Promise<unknown>[];

function context(): ExecutionContext {
  return {
    passThroughOnException() {},
    props: {},
    waitUntil(task: Promise<unknown>) {
      backgroundTasks.push(task);
    },
  } as unknown as ExecutionContext;
}

function createRequest(
  idempotencyKey = "manual-sync-request-0001",
  body: Record<string, unknown> = { connectionId: "connection-rbc-1" },
): Request {
  return new Request("https://ledger.example/api/v1/sync-runs", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      Origin: "https://ledger.example",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrfToken,
    },
    method: "POST",
  });
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

beforeEach(async () => {
  dispatch.mockReset().mockResolvedValue(undefined);
  backgroundTasks = [];
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare("DELETE FROM sync_run_requests"),
    cloudflareEnv.DB.prepare("DELETE FROM sync_runs"),
    cloudflareEnv.DB.prepare("DELETE FROM accounts"),
    cloudflareEnv.DB.prepare("DELETE FROM connections"),
  ]);
  await cloudflareEnv.DB.prepare(
    `INSERT INTO connections (
      id, institution_id, institution_name, plaid_item_id,
      access_token_ciphertext, access_token_iv, token_key_version,
      sync_cursor, status, created_at, updated_at, version
    ) VALUES (
      'connection-rbc-1', 'ins_100001', 'Royal Bank of Canada', 'plaid-item-private',
      X'0102', X'0304', 1, 'cursor-current', 'HEALTHY', ?, ?, 1
    )`,
  )
    .bind(NOW.toISOString(), NOW.toISOString())
    .run();
});

describe("protected manual sync runs", () => {
  it("queues, dispatches, and polls one secret-free run", async () => {
    const response = await worker.fetch(createRequest(), workerEnv, context());
    const responseText = await response.text();
    const body = syncRunCreateResponseSchema.parse(JSON.parse(responseText));

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(`/api/v1/sync-runs/${body.data.syncRun.id}`);
    expect(body).toMatchObject({
      data: {
        syncRun: {
          attemptCount: 0,
          connectionId: "connection-rbc-1",
          status: "QUEUED",
          trigger: "MANUAL",
        },
      },
      meta: { replayed: false, reusedActive: false },
    });
    expect(responseText).not.toContain("manual-sync-request-0001");
    expect(responseText).not.toContain("cursor-current");
    expect(responseText).not.toContain("lease");
    expect(dispatch).toHaveBeenCalledWith({
      connectionId: "connection-rbc-1",
      runId: body.data.syncRun.id,
    });
    await Promise.all(backgroundTasks);

    const statusResponse = await worker.fetch(
      new Request(`https://ledger.example/api/v1/sync-runs/${body.data.syncRun.id}`),
      workerEnv,
    );
    const statusBody = syncRunStatusResponseSchema.parse(await statusResponse.json());
    expect(statusResponse.status).toBe(200);
    expect(statusBody.data.syncRun.id).toBe(body.data.syncRun.id);
  });

  it("maps distinct concurrent request keys to one active run and replays each key", async () => {
    const firstResponse = await worker.fetch(createRequest(), workerEnv, context());
    const first = syncRunCreateResponseSchema.parse(await firstResponse.json());
    const secondResponse = await worker.fetch(
      createRequest("manual-sync-request-0002"),
      workerEnv,
      context(),
    );
    const second = syncRunCreateResponseSchema.parse(await secondResponse.json());

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(200);
    expect(second.data.syncRun.id).toBe(first.data.syncRun.id);
    expect(second.meta).toEqual({ replayed: false, reusedActive: true });

    await cloudflareEnv.DB.prepare(
      `UPDATE sync_runs
       SET status = 'SUCCEEDED', next_attempt_at = NULL, finished_at = ?, version = version + 1
       WHERE id = ?`,
    )
      .bind(NOW.toISOString(), first.data.syncRun.id)
      .run();
    const replayResponse = await worker.fetch(
      createRequest("manual-sync-request-0002"),
      workerEnv,
      context(),
    );
    const replay = syncRunCreateResponseSchema.parse(await replayResponse.json());

    expect(replayResponse.status).toBe(200);
    expect(replay.data.syncRun.id).toBe(first.data.syncRun.id);
    expect(replay.data.syncRun.status).toBe("SUCCEEDED");
    expect(replay.meta).toEqual({ replayed: true, reusedActive: false });
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM sync_runs").first<number>(
        "count",
      ),
    ).toBe(1);
    expect(
      await cloudflareEnv.DB.prepare(
        "SELECT COUNT(*) AS count FROM sync_run_requests",
      ).first<number>("count"),
    ).toBe(2);
  });

  it("keeps a queued checkpoint available when immediate dispatch fails", async () => {
    dispatch.mockRejectedValueOnce(new Error("private RPC detail"));

    const response = await worker.fetch(createRequest(), workerEnv, context());
    const body = syncRunCreateResponseSchema.parse(await response.json());
    await Promise.all(backgroundTasks);

    expect(response.status).toBe(202);
    expect(
      await cloudflareEnv.DB.prepare("SELECT status FROM sync_runs WHERE id = ?")
        .bind(body.data.syncRun.id)
        .first<string>("status"),
    ).toBe("QUEUED");
  });

  it("lets a later scheduled execution acquire the exact queued run", async () => {
    const response = await worker.fetch(createRequest(), workerEnv, context());
    const body = syncRunCreateResponseSchema.parse(await response.json());

    const acquisition = await new SyncRunRepository(cloudflareEnv.DB, {
      createLeaseToken: () => "lease-token-later-scheduled",
    }).acquire({
      connectionId: "connection-rbc-1",
      now: "2026-07-15T12:01:00.000Z",
      runId: body.data.syncRun.id,
      startCursor: "cursor-current",
      trigger: "SCHEDULED",
    });

    expect(acquisition).toMatchObject({
      kind: "ACQUIRED",
      run: { id: body.data.syncRun.id, status: "RUNNING", trigger: "MANUAL" },
    });
  });

  it("rejects invalid requests and returns not found for an unknown connection or run", async () => {
    const missingKey = createRequest();
    missingKey.headers.delete("Idempotency-Key");
    const [missingKeyResponse, strictBodyResponse, missingConnectionResponse, missingRunResponse] =
      await Promise.all([
        worker.fetch(missingKey, workerEnv, context()),
        worker.fetch(
          createRequest("manual-sync-request-0003", {
            connectionId: "connection-rbc-1",
            leaseToken: "not-allowed",
          }),
          workerEnv,
          context(),
        ),
        worker.fetch(
          createRequest("manual-sync-request-0004", { connectionId: "connection-missing" }),
          workerEnv,
          context(),
        ),
        worker.fetch(
          new Request("https://ledger.example/api/v1/sync-runs/sync-run-missing"),
          workerEnv,
        ),
      ]);

    expect(missingKeyResponse.status).toBe(422);
    expect(strictBodyResponse.status).toBe(422);
    expect(missingConnectionResponse.status).toBe(404);
    expect(missingRunResponse.status).toBe(404);
  });
});
