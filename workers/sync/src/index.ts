import { WorkerEntrypoint } from "cloudflare:workers";
import { syncRunDispatchInputSchema } from "@ledger/domain/api-contracts";
import { createStructuredLogger, type StructuredLogInput } from "@ledger/domain/logging";
import { syncWorkerEnvSchema } from "@ledger/domain/environment";
import {
  REQUEST_LIMITS,
  RequestLimitError,
  enforceRequestLimits,
} from "@ledger/domain/request-limits";
import { decryptPlaidAccessToken, PlaidTokenCryptoError } from "@ledger/domain/token-crypto";
import {
  ConnectionRepository,
  SyncRunRepository,
  TransactionSyncPersistenceError,
  TransactionSyncRepository,
  WebhookEventPersistenceError,
  WebhookEventRepository,
  type ScheduledSyncCandidate,
} from "@ledger/persistence";
import {
  PlaidAdapterError,
  createPlaidClient,
  runTransactionSync,
  type PlaidEnvironment,
  type PlaidWebhookVerificationKey,
} from "@ledger/plaid";

import { PlaidWebhookVerificationError, verifyPlaidWebhook } from "./plaid-webhook";

const PLAID_WEBHOOK_PATH = "/webhooks/plaid";
const VERIFICATION_KEY_CACHE_LIMIT = 8;
const VERIFICATION_KEY_CACHE_MILLISECONDS = 5 * 60 * 1000;
const SCHEDULED_SYNC_LEASE_MILLISECONDS = 5 * 60 * 1000;
const WEBHOOK_TYPES = new Set(["ITEM", "TRANSACTIONS"]);
const WEBHOOK_SEGMENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export interface SyncEnv {
  APP_TIMEZONE: "America/Toronto";
  DB: D1Database;
  PLAID_CLIENT_ID: string;
  PLAID_ENV: PlaidEnvironment;
  PLAID_SECRET: string;
  PLAID_TOKEN_ENCRYPTION_KEY: string;
  SCHEDULED_SYNC_MAX_ITEMS: string;
  SCHEDULED_SYNC_MAX_PAGES: string;
  SCHEDULED_SYNC_MAX_RUNTIME_MS: string;
  SYNC_STALE_AFTER_MINUTES: string;
  WEBHOOK_RATE_LIMITER: RateLimit;
}

export interface ScheduledConnectionSyncInput {
  candidate: ScheduledSyncCandidate;
  env: SyncEnv;
  maximumPages: number;
  now: Date;
  runId?: string;
}

export type ScheduledConnectionSyncResult =
  | { kind: "SKIPPED"; runId: string }
  | { kind: "SUCCEEDED"; runId: string }
  | {
      errorCode: "INTERNAL_ERROR" | "ITEM_LOGIN_REQUIRED" | "UPSTREAM_UNAVAILABLE";
      kind: "FAILED";
      runId: string;
    };

export type SyncScheduledConnection = (
  input: ScheduledConnectionSyncInput,
) => Promise<ScheduledConnectionSyncResult>;

export interface SyncWorkerDependencies {
  durationNow?: () => number;
  getVerificationKey?: (keyId: string, env: SyncEnv) => Promise<PlaidWebhookVerificationKey>;
  loggerSink?: (serializedLine: string) => void;
  now?: () => Date;
  syncScheduledConnection?: SyncScheduledConnection;
}

interface MinimalWebhookPayload {
  itemId: string;
  webhookCode: string;
  webhookType: string;
}

interface CachedVerificationKey {
  cachedAt: number;
  key: PlaidWebhookVerificationKey;
}

class ScheduledSyncConfigurationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWebhookPayload(rawBody: Uint8Array<ArrayBuffer>): MinimalWebhookPayload | undefined {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(rawBody),
    );
    if (!isRecord(value)) return undefined;
    const itemId = value.item_id;
    const webhookCode = value.webhook_code;
    const webhookType = value.webhook_type;
    if (
      typeof itemId !== "string" ||
      itemId.length === 0 ||
      itemId.length > 160 ||
      typeof webhookCode !== "string" ||
      webhookCode.length === 0 ||
      webhookCode.length > 64 ||
      !WEBHOOK_SEGMENT_PATTERN.test(webhookCode) ||
      typeof webhookType !== "string" ||
      !WEBHOOK_TYPES.has(webhookType)
    ) {
      return undefined;
    }
    return { itemId, webhookCode, webhookType };
  } catch {
    return undefined;
  }
}

function responseHeaders(requestId: string): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
  });
}

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    headers: responseHeaders(requestId),
    status,
  });
}

function errorResponse(code: string, message: string, status: number, requestId: string): Response {
  return jsonResponse({ error: { code, message } }, status, requestId);
}

function rateLimited(requestId: string): Response {
  const response = errorResponse("RATE_LIMITED", "Too many requests.", 429, requestId);
  response.headers.set("Retry-After", "60");
  return response;
}

function defaultLoggerSink(serializedLine: string): void {
  console.info(serializedLine);
}

function defaultGetVerificationKey(
  keyId: string,
  env: SyncEnv,
): Promise<PlaidWebhookVerificationKey> {
  return createPlaidClient({
    clientId: env.PLAID_CLIENT_ID,
    environment: env.PLAID_ENV,
    secret: env.PLAID_SECRET,
  }).getWebhookVerificationKey(keyId);
}

async function defaultSyncScheduledConnection({
  candidate,
  env,
  maximumPages,
  now,
  runId,
}: ScheduledConnectionSyncInput): Promise<ScheduledConnectionSyncResult> {
  const runs = new SyncRunRepository(env.DB);
  const acquisition = await runs.acquire({
    connectionId: candidate.connectionId,
    leaseMilliseconds: SCHEDULED_SYNC_LEASE_MILLISECONDS,
    now: now.toISOString(),
    runId,
    startCursor: candidate.syncCursor,
    trigger: "SCHEDULED",
  });
  if (acquisition.kind === "EXISTING") {
    return { kind: "SKIPPED", runId: acquisition.run.id };
  }

  try {
    const access = await new ConnectionRepository(env.DB).findAccessById(candidate.connectionId);
    if (!access) throw new ScheduledSyncConfigurationError();
    const accessToken = await decryptPlaidAccessToken(
      access.encryptedAccessToken,
      {
        connectionId: access.connection.id,
        plaidItemId: access.connection.plaidItemId,
      },
      [
        {
          encodedKey: env.PLAID_TOKEN_ENCRYPTION_KEY,
          version: access.encryptedAccessToken.keyVersion,
        },
      ],
    );
    const plaid = createPlaidClient({
      clientId: env.PLAID_CLIENT_ID,
      environment: env.PLAID_ENV,
      secret: env.PLAID_SECRET,
    });
    await runTransactionSync({
      accessToken,
      fetchPage: (input) => plaid.syncTransactions(input),
      initialCursor: acquisition.run.startCursor,
      maximumPages,
      persist: (batch) =>
        new TransactionSyncRepository(env.DB).apply({
          ...batch,
          connectionId: candidate.connectionId,
          now: now.toISOString(),
          runLease: {
            leaseToken: acquisition.leaseToken,
            processPendingEventsThrough: now.toISOString(),
            runId: acquisition.run.id,
          },
        }),
    });
    return { kind: "SUCCEEDED", runId: acquisition.run.id };
  } catch (error) {
    const itemLoginRequired =
      error instanceof PlaidAdapterError && error.code === "ITEM_LOGIN_REQUIRED";
    const retryable =
      (error instanceof PlaidAdapterError && error.code === "UPSTREAM_UNAVAILABLE") ||
      (error instanceof TransactionSyncPersistenceError && error.code === "BATCH_FAILED") ||
      !(
        error instanceof PlaidAdapterError ||
        error instanceof TransactionSyncPersistenceError ||
        error instanceof PlaidTokenCryptoError ||
        error instanceof ScheduledSyncConfigurationError
      );
    const errorCode = itemLoginRequired
      ? "ITEM_LOGIN_REQUIRED"
      : retryable
        ? "UPSTREAM_UNAVAILABLE"
        : "INTERNAL_ERROR";
    try {
      await runs.recordFailure({
        errorCode,
        leaseToken: acquisition.leaseToken,
        now: now.toISOString(),
        retryable,
        runId: acquisition.run.id,
      });
    } catch {
      // Preserve the original stable outcome when failure-state persistence also fails.
    }
    return { errorCode, kind: "FAILED", runId: acquisition.run.id };
  }
}

export class SyncService extends WorkerEntrypoint<SyncEnv> {
  async syncConnection(input: unknown): Promise<void> {
    const parsedInput = syncRunDispatchInputSchema.safeParse(input);
    if (!parsedInput.success) return;

    const parsedConfig = syncWorkerEnvSchema.safeParse(this.env);
    if (!parsedConfig.success) throw new Error("INVALID_SYNC_CONFIGURATION");

    const run = await new SyncRunRepository(this.env.DB).findById(parsedInput.data.runId);
    if (!run || run.connectionId !== parsedInput.data.connectionId) return;

    const currentTime = new Date();
    const result = await defaultSyncScheduledConnection({
      candidate: {
        connectionId: run.connectionId,
        syncCursor: run.startCursor,
      },
      env: this.env,
      maximumPages: parsedConfig.data.SCHEDULED_SYNC_MAX_PAGES,
      now: currentTime,
      runId: run.id,
    });
    if (result.kind === "SKIPPED") return;

    createStructuredLogger({ sink: defaultLoggerSink }).write({
      connectionId: run.connectionId,
      ...(result.kind === "FAILED" ? { errorCode: result.errorCode } : {}),
      event: "SYNC_RUN",
      level: result.kind === "FAILED" ? "ERROR" : "INFO",
      outcome: result.kind === "FAILED" ? "FAILED" : "SUCCESS",
      syncRunId: result.runId,
    });
  }
}

export function createSyncWorker({
  durationNow = () => performance.now(),
  getVerificationKey = defaultGetVerificationKey,
  loggerSink = defaultLoggerSink,
  now = () => new Date(),
  syncScheduledConnection = defaultSyncScheduledConnection,
}: SyncWorkerDependencies = {}) {
  const logger = createStructuredLogger({ now, sink: loggerSink });
  const keyCache = new Map<string, CachedVerificationKey>();

  async function cachedVerificationKey(
    keyId: string,
    env: SyncEnv,
  ): Promise<PlaidWebhookVerificationKey> {
    const currentTime = now().getTime();
    const cached = keyCache.get(keyId);
    if (cached && currentTime - cached.cachedAt <= VERIFICATION_KEY_CACHE_MILLISECONDS) {
      return cached.key;
    }

    const key = await getVerificationKey(keyId, env);
    if (keyCache.size >= VERIFICATION_KEY_CACHE_LIMIT) {
      const oldestKeyId = keyCache.keys().next().value;
      if (oldestKeyId !== undefined) keyCache.delete(oldestKeyId);
    }
    keyCache.set(keyId, { cachedAt: currentTime, key });
    return key;
  }

  return {
    async scheduled(
      controller: ScheduledController,
      env: SyncEnv,
      context: ExecutionContext,
    ): Promise<void> {
      void context;
      const startedAt = durationNow();
      const parsedConfig = syncWorkerEnvSchema.safeParse(env);
      const scheduledAt = new Date(controller.scheduledTime);
      if (!parsedConfig.success || Number.isNaN(scheduledAt.getTime())) {
        logger.write({
          errorCode: "INTERNAL_ERROR",
          event: "SYNC_RUN",
          level: "ERROR",
          outcome: "FAILED",
        });
        return;
      }

      const config = parsedConfig.data;
      const staleBefore = new Date(
        scheduledAt.getTime() - config.SYNC_STALE_AFTER_MINUTES * 60_000,
      ).toISOString();
      let candidates: ScheduledSyncCandidate[];
      try {
        candidates = await new SyncRunRepository(env.DB).findScheduledCandidates({
          limit: config.SCHEDULED_SYNC_MAX_ITEMS,
          now: scheduledAt.toISOString(),
          staleBefore,
        });
      } catch {
        logger.write({
          errorCode: "UPSTREAM_UNAVAILABLE",
          event: "SYNC_RUN",
          level: "ERROR",
          outcome: "FAILED",
        });
        return;
      }

      for (const candidate of candidates) {
        if (durationNow() - startedAt >= config.SCHEDULED_SYNC_MAX_RUNTIME_MS) break;
        try {
          const result = await syncScheduledConnection({
            candidate,
            env,
            maximumPages: config.SCHEDULED_SYNC_MAX_PAGES,
            now: scheduledAt,
          });
          if (result.kind === "SKIPPED") continue;
          logger.write({
            connectionId: candidate.connectionId,
            ...(result.kind === "FAILED" ? { errorCode: result.errorCode } : {}),
            event: "SYNC_RUN",
            level: result.kind === "FAILED" ? "ERROR" : "INFO",
            outcome: result.kind === "FAILED" ? "FAILED" : "SUCCESS",
            syncRunId: result.runId,
          });
        } catch {
          logger.write({
            connectionId: candidate.connectionId,
            errorCode: "UPSTREAM_UNAVAILABLE",
            event: "SYNC_RUN",
            level: "ERROR",
            outcome: "FAILED",
          });
        }
      }
    },

    async fetch(request: Request, env: SyncEnv): Promise<Response> {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== PLAID_WEBHOOK_PATH) {
        return new Response(null, { status: 404 });
      }

      const requestId = `request-${crypto.randomUUID()}`;
      const startedAt = durationNow();
      const logResult = (
        status: number,
        outcome: StructuredLogInput["outcome"],
        errorCode?: StructuredLogInput["errorCode"],
      ) => {
        const durationMs = Math.max(0, Math.min(3_600_000, Math.round(durationNow() - startedAt)));
        logger.write({
          durationMs,
          errorCode,
          event: "PLAID_WEBHOOK",
          level: status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO",
          outcome,
          requestId,
          status,
        });
      };

      let rawBody: Uint8Array<ArrayBuffer>;
      try {
        const rateLimit = await env.WEBHOOK_RATE_LIMITER.limit({ key: "plaid-webhook" });
        if (!rateLimit.success) {
          logResult(429, "DENIED", "RATE_LIMITED");
          return rateLimited(requestId);
        }

        const mediaType = request.headers
          .get("Content-Type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (mediaType !== "application/json") {
          logResult(415, "DENIED", "UNSUPPORTED_MEDIA_TYPE");
          return errorResponse(
            "UNSUPPORTED_MEDIA_TYPE",
            "Expected application/json.",
            415,
            requestId,
          );
        }

        rawBody = await enforceRequestLimits(request, {
          bodyBytes: REQUEST_LIMITS.PLAID_WEBHOOK_BYTES,
          routeId: "plaid-webhook",
        });
      } catch (error) {
        if (error instanceof RequestLimitError && error.code === "PAYLOAD_TOO_LARGE") {
          logResult(error.status, "DENIED", error.code);
          return errorResponse(
            error.code,
            "Request payload is too large.",
            error.status,
            requestId,
          );
        }
        if (error instanceof RequestLimitError) {
          logResult(error.status, "DENIED", error.code);
          return errorResponse(
            "WEBHOOK_INVALID",
            "Webhook request is invalid.",
            error.status,
            requestId,
          );
        }
        logResult(503, "FAILED", "UPSTREAM_UNAVAILABLE");
        return errorResponse(
          "WEBHOOK_INTAKE_UNAVAILABLE",
          "Webhook intake is temporarily unavailable.",
          503,
          requestId,
        );
      }

      let bodyHash: string;
      try {
        ({ bodyHash } = await verifyPlaidWebhook({
          getVerificationKey: (keyId) => cachedVerificationKey(keyId, env),
          now: now(),
          rawBody,
          verificationHeader: request.headers.get("Plaid-Verification"),
        }));
      } catch (error) {
        if (error instanceof PlaidWebhookVerificationError && error.code === "KEY_UNAVAILABLE") {
          logResult(503, "FAILED", "UPSTREAM_UNAVAILABLE");
          return errorResponse(
            "WEBHOOK_VERIFICATION_UNAVAILABLE",
            "Webhook verification is temporarily unavailable.",
            503,
            requestId,
          );
        }
        logResult(401, "DENIED", "FORBIDDEN");
        return errorResponse(
          "WEBHOOK_VERIFICATION_FAILED",
          "Webhook verification failed.",
          401,
          requestId,
        );
      }

      const payload = parseWebhookPayload(rawBody);
      if (!payload) {
        logResult(400, "DENIED", "VALIDATION_ERROR");
        return errorResponse("WEBHOOK_INVALID", "Webhook payload is invalid.", 400, requestId);
      }

      try {
        await new WebhookEventRepository(env.DB).record({
          eventHash: bodyHash,
          eventId: `sync-event-${crypto.randomUUID()}`,
          itemId: payload.itemId,
          receivedAt: now().toISOString(),
          webhookCode: payload.webhookCode,
          webhookType: payload.webhookType,
        });
      } catch (error) {
        if (error instanceof WebhookEventPersistenceError) {
          logResult(503, "FAILED", "UPSTREAM_UNAVAILABLE");
          return errorResponse(
            "WEBHOOK_INTAKE_UNAVAILABLE",
            "Webhook intake is temporarily unavailable.",
            503,
            requestId,
          );
        }
        logResult(500, "FAILED", "INTERNAL_ERROR");
        return errorResponse("INTERNAL_ERROR", "An internal error occurred.", 500, requestId);
      }

      logResult(200, "SUCCESS");
      return jsonResponse({ received: true }, 200, requestId);
    },
  };
}

export default createSyncWorker() satisfies ExportedHandler<SyncEnv>;
