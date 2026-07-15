import { exports } from "cloudflare:workers";
import { encryptPlaidAccessToken } from "@ledger/domain/token-crypto";
import { SyncRunRepository } from "@ledger/persistence";
import { applyD1Migrations, env } from "cloudflare:test";
import type { PlaidWebhookVerificationKey } from "@ledger/plaid";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncWorker, type SyncEnv, type SyncWorkerDependencies } from "../src/index";
import {
  SANDBOX_CATCH_UP_SYNC_PAGE,
  SANDBOX_ITEM_LOGIN_REQUIRED,
  SANDBOX_PENDING_SYNC_PAGE,
  SANDBOX_POSTED_SYNC_PAGE,
  sandboxTransactionsWebhook,
} from "./fixtures/plaid-sandbox";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const KEY_ID = "verification-key-1";
const BASE_BODY = JSON.stringify({
  extra_private_field: "must-not-be-stored",
  item_id: "plaid-item-1",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  webhook_type: "TRANSACTIONS",
});

let privateKey: CryptoKey;
let publicJwk: JWK;
let wrongPrivateKey: CryptoKey;
const syncService = (
  exports as unknown as {
    SyncService: { syncConnection(input: unknown): Promise<void> };
  }
).SyncService;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verificationHeader({
  body = BASE_BODY,
  iat = Math.floor(NOW.getTime() / 1000),
  key = privateKey,
  keyId = KEY_ID,
  payloadOverrides = {},
}: {
  body?: string;
  iat?: number;
  key?: CryptoKey;
  keyId?: string;
  payloadOverrides?: Record<string, unknown>;
} = {}): Promise<string> {
  return new SignJWT({ iat, request_body_sha256: await sha256Hex(body), ...payloadOverrides })
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .sign(key);
}

function testEnv(): SyncEnv {
  return {
    APP_TIMEZONE: "America/Toronto",
    DB: env.DB,
    PLAID_CLIENT_ID: "test-client-id",
    PLAID_ENV: "sandbox",
    PLAID_SECRET: "test-client-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    SCHEDULED_SYNC_MAX_ITEMS: "2",
    SCHEDULED_SYNC_MAX_PAGES: "20",
    SCHEDULED_SYNC_MAX_RUNTIME_MS: "20000",
    SYNC_STALE_AFTER_MINUTES: "60",
    WEBHOOK_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  };
}

function verificationKey(keyId = KEY_ID): PlaidWebhookVerificationKey {
  return {
    createdAt: 1_700_000_000,
    expiredAt: null,
    jwk: {
      alg: "ES256",
      crv: "P-256",
      kid: keyId,
      kty: "EC",
      use: "sig",
      x: publicJwk.x!,
      y: publicJwk.y!,
    },
  };
}

function worker(overrides: Parameters<typeof createSyncWorker>[0] = {}) {
  return createSyncWorker({
    getVerificationKey: () => Promise.resolve(verificationKey()),
    loggerSink: vi.fn(),
    now: () => NOW,
    ...overrides,
  });
}

async function request({
  body = BASE_BODY,
  header,
}: {
  body?: string;
  header?: string;
} = {}): Promise<Request> {
  return new Request("https://sync.example/webhooks/plaid", {
    body,
    headers: {
      "Content-Type": "application/json",
      "Plaid-Verification": header ?? (await verificationHeader({ body })),
    },
    method: "POST",
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  wrongPrivateKey = (await generateKeyPair("ES256")).privateKey;
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM transactions"),
    env.DB.prepare("DELETE FROM sync_events"),
    env.DB.prepare("DELETE FROM sync_runs"),
    env.DB.prepare("DELETE FROM accounts"),
    env.DB.prepare("DELETE FROM connections"),
  ]);
  await env.DB.prepare(
    `INSERT INTO connections (
      id, institution_id, institution_name, plaid_item_id,
      access_token_ciphertext, access_token_iv, token_key_version,
      status, created_at, updated_at, version
    ) VALUES (
      'connection-1', 'ins_42', 'Fixture Bank', 'plaid-item-1',
      X'0102', X'0304', 1, 'HEALTHY', ?, ?, 1
    )`,
  )
    .bind(NOW.toISOString(), NOW.toISOString())
    .run();
});

function scheduledController(at = NOW): ScheduledController {
  return {
    cron: "*/30 * * * *",
    noRetry() {},
    scheduledTime: at.getTime(),
    type: "scheduled",
  } as ScheduledController;
}

async function seedSandboxSyncableConnection(): Promise<void> {
  const encrypted = await encryptPlaidAccessToken(
    "access-token-private",
    { connectionId: "connection-1", plaidItemId: "plaid-item-1" },
    { encodedKey: testEnv().PLAID_TOKEN_ENCRYPTION_KEY, version: 1 },
  );
  await env.DB.prepare(
    `UPDATE connections
     SET access_token_ciphertext = ?, access_token_iv = ?, token_key_version = 1,
         sync_cursor = NULL, status = 'HEALTHY', last_success_at = NULL,
         last_error_code = NULL
     WHERE id = 'connection-1'`,
  )
    .bind(encrypted.ciphertext, encrypted.iv)
    .run();
  await env.DB.prepare(
    `INSERT INTO accounts (
      id, connection_id, plaid_account_id, display_name, mask, type, subtype,
      currency, enabled, created_at, updated_at, version
    ) VALUES (
      'account-1', 'connection-1', 'plaid-account-1', 'Sandbox Chequing', '1234',
      'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1
    )`,
  )
    .bind(NOW.toISOString(), NOW.toISOString())
    .run();
}

async function insertStaleConnection(index: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO connections (
      id, institution_id, institution_name, plaid_item_id,
      access_token_ciphertext, access_token_iv, token_key_version,
      status, last_success_at, created_at, updated_at, version
    ) VALUES (?, 'ins_42', 'Fixture Bank', ?, X'0102', X'0304', 1,
      'HEALTHY', '2026-07-15T10:00:00.000Z', ?, ?, 1)`,
  )
    .bind(
      `connection-${index}`,
      `plaid-item-${index}`,
      "2026-07-15T10:00:00.000Z",
      "2026-07-15T10:00:00.000Z",
    )
    .run();
}

describe("scheduled catch-up sync", () => {
  it("honors the configured per-invocation Item cap", async () => {
    await insertStaleConnection(2);
    await insertStaleConnection(3);
    const syncScheduledConnection = vi
      .fn<NonNullable<SyncWorkerDependencies["syncScheduledConnection"]>>()
      .mockResolvedValue({ kind: "SKIPPED", runId: "sync-run-fixture" });

    await worker({ syncScheduledConnection }).scheduled(
      scheduledController(),
      testEnv(),
      {} as ExecutionContext,
    );

    expect(syncScheduledConnection).toHaveBeenCalledTimes(2);
  });

  it("stops starting more Items after the wall-clock work budget", async () => {
    await insertStaleConnection(2);
    await insertStaleConnection(3);
    const syncScheduledConnection = vi
      .fn<NonNullable<SyncWorkerDependencies["syncScheduledConnection"]>>()
      .mockResolvedValue({ kind: "SKIPPED", runId: "sync-run-fixture" });
    const durationNow = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(20_001);

    await worker({ durationNow, syncScheduledConnection }).scheduled(
      scheduledController(),
      {
        ...testEnv(),
        SCHEDULED_SYNC_MAX_ITEMS: "3",
        SCHEDULED_SYNC_MAX_PAGES: "10",
      },
      {} as ExecutionContext,
    );

    expect(syncScheduledConnection).toHaveBeenCalledOnce();
  });

  it("fails closed on invalid work-cap configuration without touching D1", async () => {
    const logs: string[] = [];
    const syncScheduledConnection = vi
      .fn<NonNullable<SyncWorkerDependencies["syncScheduledConnection"]>>()
      .mockResolvedValue({ kind: "SKIPPED", runId: "sync-run-fixture" });

    await worker({
      loggerSink: (line) => logs.push(line),
      syncScheduledConnection,
    }).scheduled(
      scheduledController(),
      { ...testEnv(), SCHEDULED_SYNC_MAX_ITEMS: "0" },
      {} as ExecutionContext,
    );

    expect(syncScheduledConnection).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain('"event":"SYNC_RUN"');
    expect(logs.join("\n")).toContain('"errorCode":"INTERNAL_ERROR"');
  });

  it("reports candidate-query failure without invoking sync work", async () => {
    const logs: string[] = [];
    const syncScheduledConnection = vi
      .fn<NonNullable<SyncWorkerDependencies["syncScheduledConnection"]>>()
      .mockResolvedValue({ kind: "SKIPPED", runId: "sync-run-fixture" });
    const brokenDatabase = {
      prepare() {
        throw new Error("private candidate query detail");
      },
    } as unknown as D1Database;

    await worker({
      loggerSink: (line) => logs.push(line),
      syncScheduledConnection,
    }).scheduled(
      scheduledController(),
      { ...testEnv(), DB: brokenDatabase },
      {} as ExecutionContext,
    );

    expect(syncScheduledConnection).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain('"errorCode":"UPSTREAM_UNAVAILABLE"');
    expect(logs.join("\n")).not.toContain("private candidate query detail");
  });

  it("records an unreadable encrypted token as a terminal sanitized failure", async () => {
    const plaidFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", plaidFetch);

    await worker().scheduled(scheduledController(), testEnv(), {} as ExecutionContext);

    expect(plaidFetch).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT status, last_error_code FROM sync_runs WHERE connection_id = 'connection-1'",
      ).first<{ last_error_code: string; status: string }>(),
    ).toEqual({ last_error_code: "INTERNAL_ERROR", status: "FAILED" });
    vi.unstubAllGlobals();
  });

  it("decrypts the Item token and completes a bounded Plaid cursor sync", async () => {
    const encrypted = await encryptPlaidAccessToken(
      "access-token-private",
      { connectionId: "connection-1", plaidItemId: "plaid-item-1" },
      { encodedKey: testEnv().PLAID_TOKEN_ENCRYPTION_KEY, version: 1 },
    );
    await env.DB.prepare(
      `UPDATE connections
       SET access_token_ciphertext = ?, access_token_iv = ?, token_key_version = 1,
           last_success_at = '2026-07-15T10:00:00.000Z'
       WHERE id = 'connection-1'`,
    )
      .bind(encrypted.ciphertext, encrypted.iv)
      .run();
    await env.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-1', 'connection-1', 'plaid-account-1', 'Daily Chequing', '1234',
        'DEPOSITORY', 'CHECKING', 'CAD', 1, ?, ?, 1
      )`,
    )
      .bind(NOW.toISOString(), NOW.toISOString())
      .run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sync_events (
          id, event_hash, connection_id, event_type, minimal_payload_json,
          status, received_at
        ) VALUES (
          'sync-event-before', 'event-hash-before', 'connection-1',
          'TRANSACTIONS.SYNC_UPDATES_AVAILABLE', '{}', 'PENDING', ?
        )`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO sync_events (
          id, event_hash, connection_id, event_type, minimal_payload_json,
          status, received_at
        ) VALUES (
          'sync-event-after', 'event-hash-after', 'connection-1',
          'TRANSACTIONS.SYNC_UPDATES_AVAILABLE', '{}', 'PENDING', ?
        )`,
      ).bind("2026-07-15T12:00:00.001Z"),
    ]);
    const plaidFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        added: [
          {
            account_id: "plaid-account-1",
            amount: 12.34,
            authorized_date: "2026-07-14",
            date: "2026-07-15",
            iso_currency_code: "CAD",
            merchant_name: "Fixture Merchant",
            name: "Fixture purchase",
            payment_meta: {},
            pending: false,
            pending_transaction_id: null,
            transaction_id: "plaid-scheduled-transaction",
          },
        ],
        has_more: false,
        modified: [],
        next_cursor: "cursor-scheduled",
        removed: [],
        request_id: "plaid-request-1",
      }),
    );
    vi.stubGlobal("fetch", plaidFetch);

    await worker().scheduled(scheduledController(), testEnv(), {} as ExecutionContext);

    expect(plaidFetch).toHaveBeenCalledOnce();
    expect(
      await env.DB.prepare(
        "SELECT plaid_transaction_id FROM transactions WHERE plaid_transaction_id = 'plaid-scheduled-transaction'",
      ).first<string>("plaid_transaction_id"),
    ).toBe("plaid-scheduled-transaction");
    expect(
      await env.DB.prepare(
        "SELECT sync_cursor FROM connections WHERE id = 'connection-1'",
      ).first<string>("sync_cursor"),
    ).toBe("cursor-scheduled");
    expect(
      await env.DB.prepare(
        "SELECT status FROM sync_runs WHERE connection_id = 'connection-1'",
      ).first<string>("status"),
    ).toBe("SUCCEEDED");
    expect(
      await env.DB.prepare("SELECT id, status FROM sync_events ORDER BY id").all<{
        id: string;
        status: string;
      }>(),
    ).toMatchObject({
      results: [
        { id: "sync-event-after", status: "PENDING" },
        { id: "sync-event-before", status: "PROCESSED" },
      ],
    });
    vi.unstubAllGlobals();
  });

  it("puts a transient Plaid failure into retry wait", async () => {
    const encrypted = await encryptPlaidAccessToken(
      "access-token-private",
      { connectionId: "connection-1", plaidItemId: "plaid-item-1" },
      { encodedKey: testEnv().PLAID_TOKEN_ENCRYPTION_KEY, version: 1 },
    );
    await env.DB.prepare(
      `UPDATE connections
       SET access_token_ciphertext = ?, access_token_iv = ?, token_key_version = 1,
           last_success_at = '2026-07-15T10:00:00.000Z'
       WHERE id = 'connection-1'`,
    )
      .bind(encrypted.ciphertext, encrypted.iv)
      .run();
    const plaidFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("private network detail"));
    vi.stubGlobal("fetch", plaidFetch);

    await worker().scheduled(scheduledController(), testEnv(), {} as ExecutionContext);

    expect(plaidFetch).toHaveBeenCalledOnce();
    const run = await env.DB.prepare(
      "SELECT status, last_error_code, next_attempt_at FROM sync_runs WHERE connection_id = 'connection-1'",
    ).first<{ last_error_code: string; next_attempt_at: string; status: string }>();
    expect(run).toMatchObject({
      last_error_code: "UPSTREAM_UNAVAILABLE",
      status: "RETRY_WAIT",
    });
    expect(run!.next_attempt_at > NOW.toISOString()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("Plaid Sandbox lifecycle fixtures", () => {
  it("deduplicates out-of-order webhooks, links pending to posted, and catches up without one", async () => {
    await seedSandboxSyncableConnection();
    const plaidFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(SANDBOX_PENDING_SYNC_PAGE))
      .mockResolvedValueOnce(Response.json(SANDBOX_POSTED_SYNC_PAGE))
      .mockResolvedValueOnce(Response.json(SANDBOX_CATCH_UP_SYNC_PAGE));
    vi.stubGlobal("fetch", plaidFetch);

    await worker().scheduled(scheduledController(), testEnv(), {} as ExecutionContext);

    const historicalBody = sandboxTransactionsWebhook("HISTORICAL_UPDATE");
    const initialBody = sandboxTransactionsWebhook("INITIAL_UPDATE");
    const intake = worker();
    await intake.fetch(await request({ body: historicalBody }), testEnv());
    await intake.fetch(await request({ body: historicalBody }), testEnv());
    await intake.fetch(await request({ body: initialBody }), testEnv());

    await worker().scheduled(
      scheduledController(new Date("2026-07-15T12:01:00.000Z")),
      testEnv(),
      {} as ExecutionContext,
    );

    const transactions = await env.DB.prepare(
      `SELECT id, plaid_transaction_id, pending_transaction_id, status
       FROM transactions ORDER BY plaid_transaction_id`,
    ).all<{
      id: string;
      pending_transaction_id: string | null;
      plaid_transaction_id: string;
      status: string;
    }>();
    const pending = transactions.results.find(
      ({ plaid_transaction_id }) => plaid_transaction_id === "sandbox-pending-1",
    );
    const posted = transactions.results.find(
      ({ plaid_transaction_id }) => plaid_transaction_id === "sandbox-posted-1",
    );
    expect(pending?.status).toBe("REMOVED");
    expect(posted).toMatchObject({ pending_transaction_id: pending?.id, status: "POSTED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_events").first<number>("count"),
    ).toBe(2);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM sync_events WHERE status = 'PROCESSED'",
      ).first<number>("count"),
    ).toBe(2);

    await env.DB.prepare(
      `UPDATE connections
       SET last_success_at = '2026-07-15T10:00:00.000Z',
           updated_at = '2026-07-15T10:00:00.000Z'
       WHERE id = 'connection-1'`,
    ).run();
    await worker().scheduled(
      scheduledController(new Date("2026-07-15T14:00:00.000Z")),
      testEnv(),
      {} as ExecutionContext,
    );

    expect(plaidFetch).toHaveBeenCalledTimes(3);
    expect(
      await env.DB.prepare(
        "SELECT sync_cursor FROM connections WHERE id = 'connection-1'",
      ).first<string>("sync_cursor"),
    ).toBe("sandbox-cursor-catch-up");
    vi.unstubAllGlobals();
  });

  it("surfaces ITEM_LOGIN_REQUIRED and resumes the original Item after update-mode data arrives", async () => {
    await seedSandboxSyncableConnection();
    const plaidFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(SANDBOX_ITEM_LOGIN_REQUIRED, { status: 400 }))
      .mockResolvedValueOnce(Response.json(SANDBOX_CATCH_UP_SYNC_PAGE));
    vi.stubGlobal("fetch", plaidFetch);

    await worker().scheduled(scheduledController(), testEnv(), {} as ExecutionContext);

    expect(
      await env.DB.prepare(
        "SELECT status, last_error_code FROM connections WHERE id = 'connection-1'",
      ).first(),
    ).toEqual({ last_error_code: "ITEM_LOGIN_REQUIRED", status: "ACTION_REQUIRED" });
    expect(
      await env.DB.prepare(
        "SELECT status, last_error_code FROM sync_runs WHERE connection_id = 'connection-1'",
      ).first(),
    ).toEqual({ last_error_code: "ITEM_LOGIN_REQUIRED", status: "FAILED" });

    const repairedDataBody = sandboxTransactionsWebhook("SYNC_UPDATES_AVAILABLE");
    await worker().fetch(await request({ body: repairedDataBody }), testEnv());
    await worker().scheduled(
      scheduledController(new Date("2026-07-15T12:01:00.000Z")),
      testEnv(),
      {} as ExecutionContext,
    );

    expect(
      await env.DB.prepare(
        "SELECT plaid_item_id, status, last_error_code, sync_cursor FROM connections WHERE id = 'connection-1'",
      ).first(),
    ).toEqual({
      last_error_code: null,
      plaid_item_id: "plaid-item-1",
      status: "HEALTHY",
      sync_cursor: "sandbox-cursor-catch-up",
    });
    const accessTokens = plaidFetch.mock.calls.map(([, init]) => {
      const body = JSON.parse(init?.body as string) as { access_token: string };
      return body.access_token;
    });
    expect(accessTokens).toEqual(["access-token-private", "access-token-private"]);
    vi.unstubAllGlobals();
  });
});

describe("sync Worker routing and limits", () => {
  it("returns 404 for every method or path outside POST /webhooks/plaid", async () => {
    const [unknown, wrongMethod] = await Promise.all([
      exports.default.fetch("https://sync.example/unknown"),
      exports.default.fetch("https://sync.example/webhooks/plaid"),
    ]);

    expect(unknown.status).toBe(404);
    expect(wrongMethod.status).toBe(404);
  });

  it("returns stable 429 responses from the dedicated webhook limiter", async () => {
    const response = await worker().fetch(await request(), {
      ...testEnv(),
      WEBHOOK_RATE_LIMITER: { limit: () => Promise.resolve({ success: false }) },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("rejects non-JSON media types before reading the body", async () => {
    const response = await worker().fetch(
      new Request("https://sync.example/webhooks/plaid", {
        body: BASE_BODY,
        headers: { "Content-Type": "text/plain" },
        method: "POST",
      }),
      testEnv(),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails closed when the limiter is unavailable", async () => {
    const response = await worker().fetch(await request(), {
      ...testEnv(),
      WEBHOOK_RATE_LIMITER: {
        limit: () => Promise.reject(new Error("private limiter detail")),
      },
    });

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain("private limiter detail");
  });

  it("returns a stable 413 before buffering an oversized webhook", async () => {
    const response = await worker().fetch(
      new Request("https://sync.example/webhooks/plaid", {
        body: "x".repeat(256 * 1024 + 1),
        headers: { "Content-Type": "application/json", "Plaid-Verification": "ignored" },
        method: "POST",
      }),
      testEnv(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large." },
    });
  });
});

describe("private manual-sync RPC", () => {
  it("executes the exact queued run once and leaves terminal replays untouched", async () => {
    await env.DB.prepare(
      "UPDATE connections SET sync_cursor = 'cursor-before' WHERE id = 'connection-1'",
    ).run();
    const queued = await new SyncRunRepository(env.DB).enqueueManual({
      connectionId: "connection-1",
      idempotencyKey: "manual-sync-request-0001",
      now: NOW.toISOString(),
    });
    await syncService.syncConnection({
      connectionId: "connection-1",
      runId: queued.run.id,
    });
    await syncService.syncConnection({
      connectionId: "connection-1",
      runId: queued.run.id,
    });

    expect(
      await env.DB.prepare("SELECT status, last_error_code FROM sync_runs WHERE id = ?")
        .bind(queued.run.id)
        .first(),
    ).toEqual({ last_error_code: "INTERNAL_ERROR", status: "FAILED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_runs").first<number>("count"),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT sync_cursor FROM connections WHERE id = 'connection-1'",
      ).first<string>("sync_cursor"),
    ).toBe("cursor-before");
  });

  it("ignores malformed RPC input before starting work", async () => {
    await expect(
      syncService.syncConnection({ connectionId: "connection-1", runId: "invalid" }),
    ).resolves.toBeUndefined();
    expect(await env.DB.prepare("SELECT id FROM sync_runs").first()).toBeNull();
  });
});

describe("verified and idempotent Plaid webhook intake", () => {
  it("verifies and stores only one minimal event before returning success", async () => {
    const logs: string[] = [];
    const signedHeader = await verificationHeader();
    const response = await worker({ loggerSink: (line) => logs.push(line) }).fetch(
      await request({ header: signedHeader }),
      testEnv(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-ID")).toMatch(/^request-/);
    await expect(response.json()).resolves.toEqual({ received: true });
    const rows = await env.DB.prepare(
      `SELECT connection_id, event_type, minimal_payload_json, status FROM sync_events`,
    ).all<{
      connection_id: string;
      event_type: string;
      minimal_payload_json: string;
      status: string;
    }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      connection_id: "connection-1",
      event_type: "TRANSACTIONS.SYNC_UPDATES_AVAILABLE",
      status: "PENDING",
    });
    expect(JSON.parse(rows.results[0]!.minimal_payload_json)).toEqual({
      itemId: "plaid-item-1",
      webhookCode: "SYNC_UPDATES_AVAILABLE",
      webhookType: "TRANSACTIONS",
    });
    expect(rows.results[0]!.minimal_payload_json).not.toContain("must-not-be-stored");
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(signedHeader);
    expect(logs[0]).not.toContain("plaid-item-1");
    expect(logs[0]).not.toContain("must-not-be-stored");
  });

  it.each([
    {
      header: () => verificationHeader({ key: wrongPrivateKey }),
      name: "signature",
    },
    {
      body: `${BASE_BODY} `,
      header: () => verificationHeader(),
      name: "body hash",
    },
    {
      header: () => verificationHeader({ iat: Math.floor(NOW.getTime() / 1000) - 301 }),
      name: "timestamp",
    },
  ])("rejects an invalid $name without touching D1", async ({ body, header }) => {
    const response = await worker().fetch(
      await request({ ...(body === undefined ? {} : { body }), header: await header() }),
      testEnv(),
    );

    expect(response.status).toBe(401);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_events").first<number>(
      "count",
    );
    expect(count).toBe(0);
  });

  it("rejects a key whose identity does not match the signed JWT", async () => {
    const response = await worker({
      getVerificationKey: () => Promise.resolve(verificationKey("another-key")),
    }).fetch(await request(), testEnv());

    expect(response.status).toBe(401);
    expect(await env.DB.prepare("SELECT id FROM sync_events").first()).toBeNull();
  });

  it("returns a retryable response when the verification key cannot be loaded", async () => {
    const response = await worker({
      getVerificationKey: () => Promise.reject(new Error("private Plaid response")),
    }).fetch(await request(), testEnv());

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain("private Plaid response");
  });

  it("rejects malformed headers and invalid signed claims or key lifetimes", async () => {
    const nowSeconds = Math.floor(NOW.getTime() / 1000);
    const wrongAlgorithmHeader = `${btoa(JSON.stringify({ alg: "none", kid: KEY_ID }))}.e30.`;
    const cases = [
      {
        header: "not-a-jwt",
        intake: worker(),
      },
      {
        header: wrongAlgorithmHeader,
        intake: worker(),
      },
      {
        header: await verificationHeader({
          payloadOverrides: { request_body_sha256: undefined },
        }),
        intake: worker(),
      },
      {
        header: await verificationHeader({ iat: nowSeconds + 31 }),
        intake: worker(),
      },
      {
        header: await verificationHeader(),
        intake: worker({
          getVerificationKey: () =>
            Promise.resolve({ ...verificationKey(), createdAt: nowSeconds + 1 }),
        }),
      },
      {
        header: await verificationHeader(),
        intake: worker({
          getVerificationKey: () =>
            Promise.resolve({ ...verificationKey(), expiredAt: nowSeconds - 1 }),
        }),
      },
    ];

    for (const testCase of cases) {
      const response = await testCase.intake.fetch(
        await request({ header: testCase.header }),
        testEnv(),
      );
      expect(response.status).toBe(401);
    }
  });

  it("bounds the verification-key cache and evicts the oldest key", async () => {
    const getVerificationKey = vi
      .fn<NonNullable<SyncWorkerDependencies["getVerificationKey"]>>()
      .mockImplementation((keyId) => Promise.resolve(verificationKey(keyId)));
    const intake = worker({ getVerificationKey });

    for (let index = 0; index < 9; index += 1) {
      const body = JSON.stringify({
        item_id: "plaid-item-1",
        sequence: index,
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        webhook_type: "TRANSACTIONS",
      });
      const keyId = `verification-key-${index}`;
      await intake.fetch(
        await request({ body, header: await verificationHeader({ body, keyId }) }),
        testEnv(),
      );
    }
    const replayBody = JSON.stringify({
      item_id: "plaid-item-1",
      sequence: "replay",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      webhook_type: "TRANSACTIONS",
    });
    await intake.fetch(
      await request({
        body: replayBody,
        header: await verificationHeader({ body: replayBody, keyId: "verification-key-0" }),
      }),
      testEnv(),
    );

    expect(getVerificationKey).toHaveBeenCalledTimes(10);
  });

  it.each([
    { body: "not-json", name: "non-JSON body" },
    { body: "[]", name: "non-object body" },
    {
      body: JSON.stringify({
        item_id: "plaid-item-1",
        webhook_code: "lowercase-code",
        webhook_type: "TRANSACTIONS",
      }),
      name: "invalid event code",
    },
    {
      body: JSON.stringify({
        item_id: "plaid-item-1",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        webhook_type: "UNSUPPORTED",
      }),
      name: "unsupported event type",
    },
  ])("rejects a signed $name after verification", async ({ body }) => {
    const response = await worker().fetch(await request({ body }), testEnv());

    expect(response.status).toBe(400);
    expect(await env.DB.prepare("SELECT id FROM sync_events").first()).toBeNull();
  });

  it("returns a retryable sanitized response when D1 is unavailable", async () => {
    const brokenDatabase = {
      prepare() {
        throw new Error("private database detail");
      },
    } as unknown as D1Database;
    const response = await worker().fetch(await request(), {
      ...testEnv(),
      DB: brokenDatabase,
    });

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain("private database detail");
  });

  it("uses the default Plaid key adapter and emits a structured denial log", async () => {
    const plaidFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        key: {
          alg: "ES256",
          created_at: 1_700_000_000,
          crv: "P-256",
          expired_at: null,
          kid: KEY_ID,
          kty: "EC",
          use: "sig",
          x: publicJwk.x,
          y: publicJwk.y,
        },
        request_id: "plaid-request-1",
      }),
    );
    vi.stubGlobal("fetch", plaidFetch);
    const logger = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await createSyncWorker({ now: () => NOW }).fetch(await request(), testEnv());
    const denied = await createSyncWorker({ now: () => NOW }).fetch(
      new Request("https://sync.example/webhooks/plaid", {
        body: BASE_BODY,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      testEnv(),
    );

    expect(response.status).toBe(200);
    expect(denied.status).toBe(401);
    expect(plaidFetch).toHaveBeenCalledOnce();
    expect(logger.mock.calls.flat().join("\n")).toContain('"event":"PLAID_WEBHOOK"');
    logger.mockRestore();
    vi.unstubAllGlobals();
  });

  it("acknowledges an unknown Item without persisting or revealing its existence", async () => {
    const body = JSON.stringify({
      item_id: "unknown-item",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      webhook_type: "TRANSACTIONS",
    });
    const response = await worker().fetch(await request({ body }), testEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(await env.DB.prepare("SELECT id FROM sync_events").first()).toBeNull();
  });

  it("deduplicates exact retries and accepts distinct out-of-order events", async () => {
    const intake = worker();
    const firstHeader = await verificationHeader();
    await intake.fetch(await request({ header: firstHeader }), testEnv());
    await intake.fetch(await request({ header: firstHeader }), testEnv());

    const historicalBody = JSON.stringify({
      item_id: "plaid-item-1",
      webhook_code: "HISTORICAL_UPDATE",
      webhook_type: "TRANSACTIONS",
    });
    const initialBody = JSON.stringify({
      item_id: "plaid-item-1",
      webhook_code: "INITIAL_UPDATE",
      webhook_type: "TRANSACTIONS",
    });
    await intake.fetch(await request({ body: historicalBody }), testEnv());
    await intake.fetch(await request({ body: initialBody }), testEnv());

    const events = await env.DB.prepare(
      "SELECT event_type, status FROM sync_events ORDER BY received_at, event_type",
    ).all<{ event_type: string; status: string }>();
    expect(events.results).toEqual([
      { event_type: "TRANSACTIONS.HISTORICAL_UPDATE", status: "PENDING" },
      { event_type: "TRANSACTIONS.INITIAL_UPDATE", status: "PENDING" },
      { event_type: "TRANSACTIONS.SYNC_UPDATES_AVAILABLE", status: "PENDING" },
    ]);
  });
});
