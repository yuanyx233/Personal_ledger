import { API_PREFIX, PRODUCT_NAME, mapConnectionHealth } from "@ledger/domain";
import {
  accountEnabledUpdateRequestSchema,
  idempotencyKeySchema,
  linkTokenRequestSchema,
  publicTokenExchangeRequestSchema,
  syncRunCreateRequestSchema,
  syncRunIdSchema,
  type SyncWorkerService,
} from "@ledger/domain/api-contracts";
import { createStructuredLogger, type StructuredLogger } from "@ledger/domain/logging";
import {
  RequestLimitError,
  enforceRequestLimits,
  resolveAppRequestPolicy,
} from "@ledger/domain/request-limits";
import {
  AccountRepository,
  ConnectionRepository,
  SyncRunPersistenceError,
  SyncRunRepository,
  type AccountRecord,
  type SyncRunRecord,
} from "@ledger/persistence";
import { createPlaidClient, type PlaidClient, type PlaidEnvironment } from "@ledger/plaid";

import {
  AccessDeniedError,
  createRemoteAccessVerifier,
  type AccessIdentity,
  type AccessRequestVerifier,
  type AccessVerifierConfig,
} from "./security/access";
import { issueCsrfToken } from "./security/csrf";
import { RequestGuardError, validateApiRequest } from "./security/request-guard";
import { applySecurityHeaders } from "./security/response-headers";
import {
  ConnectionCreationServiceError,
  createConnectionCreationService,
} from "./plaid/connection-service";
import { LinkTokenServiceError, createLinkTokenService } from "./plaid/link-token-service";

export interface AppEnv {
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  API_RATE_LIMITER: RateLimit;
  APP_TIMEZONE: "America/Toronto";
  ASSETS: Fetcher;
  CSRF_HMAC_KEY: string;
  DB: D1Database;
  OWNER_EMAIL: string;
  PLAID_BMO_INSTITUTION_ID: string;
  PLAID_CLIENT_ID: string;
  PLAID_ENV: PlaidEnvironment;
  PLAID_LINK_CUSTOMIZATION_NAME: string;
  PLAID_RBC_INSTITUTION_ID: string;
  PLAID_SECRET: string;
  PLAID_TOKEN_ENCRYPTION_KEY: string;
  PLAID_WEBHOOK_URL: string;
  SYNC: SyncWorkerService;
}

export type AccessGate = (request: Request, env: AppEnv) => Promise<AccessIdentity>;
export type AccessVerifierFactory = (config: AccessVerifierConfig) => AccessRequestVerifier;
export type PlaidClientFactory = (env: AppEnv) => PlaidClient;

const NOOP_LOGGER: StructuredLogger = { write: () => false };

export function createConfiguredAccessGate(
  createVerifier: AccessVerifierFactory = createRemoteAccessVerifier,
): AccessGate {
  let cachedVerifier: { cacheKey: string; verify: AccessRequestVerifier } | undefined;

  return (request, env) => {
    const cacheKey = `${env.ACCESS_TEAM_DOMAIN}\u0000${env.ACCESS_AUD}\u0000${env.OWNER_EMAIL}`;
    if (!cachedVerifier || cachedVerifier.cacheKey !== cacheKey) {
      cachedVerifier = {
        cacheKey,
        verify: createVerifier({
          audience: env.ACCESS_AUD,
          ownerEmail: env.OWNER_EMAIL,
          teamDomain: env.ACCESS_TEAM_DOMAIN,
        }),
      };
    }
    return cachedVerifier.verify(request);
  };
}

function accessDenied(code: AccessDeniedError["code"]): Response {
  return Response.json(
    {
      error: {
        code,
        message: "Access denied.",
      },
    },
    { status: 403 },
  );
}

function requestDenied(error: RequestGuardError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: "Request denied.",
      },
    },
    { status: error.status },
  );
}

function internalError(): Response {
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    },
    { status: 500 },
  );
}

function methodNotAllowed(): Response {
  return Response.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "This method is not allowed.",
      },
    },
    { status: 405 },
  );
}

function notFound(): Response {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "The requested resource was not found." } },
    { status: 404 },
  );
}

function versionConflict(currentVersion: number): Response {
  return Response.json(
    {
      error: {
        code: "VERSION_CONFLICT",
        currentVersion,
        message: "The account changed. Refresh and try again.",
      },
    },
    { status: 409 },
  );
}

function upstreamUnavailable(): Response {
  return Response.json(
    {
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Plaid is temporarily unavailable.",
      },
    },
    { status: 503 },
  );
}

function linkTokenDenied(error: LinkTokenServiceError): Response {
  if (error.code === "NOT_FOUND") return notFound();
  if (error.code === "UPSTREAM_UNAVAILABLE") return upstreamUnavailable();
  if (error.code === "INTERNAL_ERROR") return internalError();
  if (error.code === "CONNECTION_NOT_REPAIRABLE") {
    return Response.json(
      {
        error: {
          code: error.code,
          message: "This connection cannot be repaired with update mode.",
        },
      },
      { status: 409 },
    );
  }
  return Response.json(
    {
      error: {
        code: error.code,
        message: `Plaid Trial allows 10 Items, and removing one does not restore a slot. Confirm creating an additional ${error.institutionCode ?? "bank"} Item.`,
      },
    },
    { status: 409 },
  );
}

function connectionCreationDenied(error: ConnectionCreationServiceError): Response {
  const details = {
    IDEMPOTENCY_CONFLICT: {
      message: "The idempotency key is already in use.",
      status: 409,
    },
    NO_SUPPORTED_ACCOUNTS: {
      message: "No supported checking or credit-card account was returned.",
      status: 422,
    },
    UNSUPPORTED_INSTITUTION: {
      message: "Only configured RBC and BMO connections are supported.",
      status: 422,
    },
  } as const;
  if (error.code === "UPSTREAM_UNAVAILABLE") return upstreamUnavailable();
  if (error.code === "INTERNAL_ERROR") return internalError();
  const detail = details[error.code];
  return Response.json(
    { error: { code: error.code, message: detail.message } },
    { status: detail.status },
  );
}

function requestLimitDenied(error: RequestLimitError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message:
          error.code === "PAYLOAD_TOO_LARGE"
            ? "Request payload is too large."
            : "Request parameters are invalid.",
      },
    },
    { status: error.status },
  );
}

function rateLimited(): Response {
  const response = Response.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests." } },
    { status: 429 },
  );
  response.headers.set("Retry-After", "60");
  return response;
}

function parseJsonBody(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body));
  } catch {
    return undefined;
  }
}

function accountReadModel(account: AccountRecord) {
  return {
    currency: account.currency,
    displayName: account.displayName,
    enabled: account.enabled,
    id: account.id,
    mask: account.mask,
    subtype: account.subtype,
    type: account.type,
    version: account.version,
  };
}

function syncRunReadModel(run: SyncRunRecord) {
  return {
    attemptCount: run.attemptCount,
    connectionId: run.connectionId,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    id: run.id,
    lastErrorCode: run.lastErrorCode,
    nextAttemptAt: run.nextAttemptAt,
    startedAt: run.startedAt,
    status: run.status,
    trigger: run.trigger,
    version: run.version,
  };
}

export const createConfiguredPlaidClient: PlaidClientFactory = (env) =>
  createPlaidClient({
    clientId: env.PLAID_CLIENT_ID,
    environment: env.PLAID_ENV,
    secret: env.PLAID_SECRET,
  });

export function createAppWorker(
  verifyAccess: AccessGate = createConfiguredAccessGate(),
  logger: StructuredLogger = NOOP_LOGGER,
  createPlaid: PlaidClientFactory = createConfiguredPlaidClient,
  now: () => Date = () => new Date(),
) {
  return {
    async fetch(request: Request, env: AppEnv, context?: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const isApiRequest = url.pathname.startsWith(API_PREFIX);
      const secure = (response: Response, noStore = isApiRequest): Response =>
        applySecurityHeaders(response, noStore);

      let identity: AccessIdentity;
      try {
        identity = await verifyAccess(request, env);
      } catch (error) {
        const code = error instanceof AccessDeniedError ? error.code : "ACCESS_ASSERTION_INVALID";
        logger.write({
          errorCode: code,
          event: "ACCESS_CHECK",
          level: "WARN",
          outcome: "DENIED",
          status: 403,
        });
        return secure(accessDenied(code), true);
      }

      if (isApiRequest) {
        let requestBody: Uint8Array;
        try {
          await validateApiRequest(request, identity, env.CSRF_HMAC_KEY);
        } catch (error) {
          const denied =
            error instanceof RequestGuardError ? error : new RequestGuardError("CSRF_INVALID", 403);
          logger.write({
            errorCode: denied.code,
            event: "API_REQUEST",
            level: "WARN",
            outcome: "DENIED",
            status: denied.status,
          });
          return secure(requestDenied(denied));
        }
        const requestPolicy = resolveAppRequestPolicy(request);
        try {
          const rateLimit = await env.API_RATE_LIMITER.limit({
            key: `${identity.sessionBinding}:${requestPolicy.routeId}`,
          });
          if (!rateLimit.success) {
            logger.write({
              errorCode: "RATE_LIMITED",
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: 429,
            });
            return secure(rateLimited());
          }
          requestBody = await enforceRequestLimits(request, requestPolicy);
        } catch (error) {
          if (error instanceof RequestLimitError) {
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }
          logger.write({
            errorCode: "INTERNAL_ERROR",
            event: "API_REQUEST",
            level: "ERROR",
            outcome: "FAILED",
            status: 500,
          });
          return secure(internalError());
        }
        if (request.method === "GET" && url.pathname === `${API_PREFIX}/session`) {
          try {
            return secure(
              Response.json({
                data: {
                  csrfToken: await issueCsrfToken(identity, env.CSRF_HMAC_KEY),
                  identity: { email: identity.email },
                  timezone: env.APP_TIMEZONE,
                },
                meta: {},
              }),
            );
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/connections`) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          try {
            const connections = await new ConnectionRepository(env.DB).listWithAccounts();
            const data = connections.map(({ accounts, connection }) => {
              const institutionCode =
                connection.institutionId === env.PLAID_RBC_INSTITUTION_ID
                  ? "RBC"
                  : connection.institutionId === env.PLAID_BMO_INSTITUTION_ID
                    ? "BMO"
                    : undefined;
              if (!institutionCode) throw new Error("unconfigured institution");
              const health = mapConnectionHealth(connection, now());
              return {
                accounts: accounts.map(accountReadModel),
                ...health,
                id: connection.id,
                institutionCode,
                institutionName: connection.institutionName,
                version: connection.version,
              };
            });
            return secure(Response.json({ data: { connections: data }, meta: {} }));
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/sync-runs`) {
          if (request.method !== "POST") return secure(methodNotAllowed());
          const parsedBody = syncRunCreateRequestSchema.safeParse(parseJsonBody(requestBody));
          const parsedIdempotencyKey = idempotencyKeySchema.safeParse(
            request.headers.get("Idempotency-Key"),
          );
          if (!parsedBody.success || !parsedIdempotencyKey.success) {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          try {
            const result = await new SyncRunRepository(env.DB).enqueueManual({
              connectionId: parsedBody.data.connectionId,
              idempotencyKey: parsedIdempotencyKey.data,
              now: now().toISOString(),
            });
            const runId = syncRunIdSchema.safeParse(result.run.id);
            if (!runId.success) throw new SyncRunPersistenceError("DATABASE_FAILURE");
            const shouldDispatch = ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(result.run.status);
            if (shouldDispatch && context) {
              const dispatchInput = {
                connectionId: parsedBody.data.connectionId,
                runId: runId.data,
              };
              try {
                const dispatch = env.SYNC.syncConnection(dispatchInput).catch(() => {
                  logger.write({
                    connectionId: parsedBody.data.connectionId,
                    errorCode: "UPSTREAM_UNAVAILABLE",
                    event: "SYNC_RUN",
                    level: "ERROR",
                    outcome: "FAILED",
                    syncRunId: result.run.id,
                  });
                });
                context.waitUntil(dispatch);
              } catch {
                logger.write({
                  connectionId: parsedBody.data.connectionId,
                  errorCode: "UPSTREAM_UNAVAILABLE",
                  event: "SYNC_RUN",
                  level: "ERROR",
                  outcome: "FAILED",
                  syncRunId: result.run.id,
                });
              }
            }

            const status = result.kind === "CREATED" ? 202 : 200;
            const response = Response.json(
              {
                data: { syncRun: syncRunReadModel(result.run) },
                meta: {
                  replayed: result.kind === "REPLAY",
                  reusedActive: result.kind === "EXISTING_ACTIVE",
                },
              },
              { status },
            );
            response.headers.set("Location", `${API_PREFIX}/sync-runs/${runId.data}`);
            logger.write({
              connectionId: parsedBody.data.connectionId,
              event: "API_REQUEST",
              level: "INFO",
              outcome: "SUCCESS",
              status,
              syncRunId: result.run.id,
            });
            return secure(response);
          } catch (error) {
            if (error instanceof SyncRunPersistenceError && error.code === "NOT_FOUND") {
              return secure(notFound());
            }
            logger.write({
              connectionId: parsedBody.data.connectionId,
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        const syncRunPath = new RegExp(`^${API_PREFIX}/sync-runs/([^/]+)$`).exec(url.pathname);
        if (syncRunPath) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          const parsedRunId = syncRunIdSchema.safeParse(syncRunPath[1]);
          if (!parsedRunId.success) return secure(notFound());
          try {
            const run = await new SyncRunRepository(env.DB).findById(parsedRunId.data);
            if (!run) return secure(notFound());
            return secure(Response.json({ data: { syncRun: syncRunReadModel(run) }, meta: {} }));
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        const accountPath = new RegExp(`^${API_PREFIX}/accounts/([^/]+)$`).exec(url.pathname);
        if (accountPath) {
          if (request.method !== "PATCH") return secure(methodNotAllowed());
          const accountId = accountPath[1]!;
          const parsedBody = accountEnabledUpdateRequestSchema.safeParse(
            parseJsonBody(requestBody),
          );
          if (!/^account-[A-Za-z0-9_-]{1,152}$/.test(accountId) || !parsedBody.success) {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          try {
            const result = await new AccountRepository(env.DB).updateEnabled({
              enabled: parsedBody.data.enabled,
              id: accountId,
              now: new Date().toISOString(),
              version: parsedBody.data.version,
            });
            if (result.kind === "NOT_FOUND") return secure(notFound());
            if (result.kind === "VERSION_CONFLICT") {
              return secure(versionConflict(result.currentVersion));
            }
            logger.write({
              accountId,
              event: "API_REQUEST",
              level: "INFO",
              outcome: "SUCCESS",
              status: 200,
            });
            return secure(
              Response.json({ data: { account: accountReadModel(result.account) }, meta: {} }),
            );
          } catch {
            logger.write({
              accountId,
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/plaid/link-tokens`) {
          if (request.method !== "POST") return secure(methodNotAllowed());
          const parsedBody = linkTokenRequestSchema.safeParse(parseJsonBody(requestBody));
          if (!parsedBody.success) {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          try {
            const linkToken = await createLinkTokenService({
              bmoInstitutionId: env.PLAID_BMO_INSTITUTION_ID,
              clientName: PRODUCT_NAME,
              database: env.DB,
              linkCustomizationName: env.PLAID_LINK_CUSTOMIZATION_NAME,
              plaid: createPlaid(env),
              rbcInstitutionId: env.PLAID_RBC_INSTITUTION_ID,
              tokenEncryptionKey: env.PLAID_TOKEN_ENCRYPTION_KEY,
              webhookUrl: env.PLAID_WEBHOOK_URL,
            }).create(parsedBody.data);
            logger.write({
              ...(parsedBody.data.mode === "UPDATE"
                ? { connectionId: parsedBody.data.connectionId }
                : {}),
              event: "API_REQUEST",
              level: "INFO",
              outcome: "SUCCESS",
              status: 200,
            });
            return secure(Response.json({ data: linkToken, meta: {} }));
          } catch (error) {
            const failure =
              error instanceof LinkTokenServiceError
                ? error
                : new LinkTokenServiceError("INTERNAL_ERROR");
            const response = linkTokenDenied(failure);
            logger.write({
              ...(parsedBody.data.mode === "UPDATE"
                ? { connectionId: parsedBody.data.connectionId }
                : {}),
              errorCode: failure.code,
              event: "API_REQUEST",
              level: failure.code === "ADDITIONAL_ITEM_CONFIRMATION_REQUIRED" ? "WARN" : "ERROR",
              outcome: "FAILED",
              status: response.status,
            });
            return secure(response);
          }
        }
        if (url.pathname === `${API_PREFIX}/plaid/items`) {
          if (request.method !== "POST") return secure(methodNotAllowed());
          const parsedBody = publicTokenExchangeRequestSchema.safeParse(parseJsonBody(requestBody));
          const parsedIdempotencyKey = idempotencyKeySchema.safeParse(
            request.headers.get("Idempotency-Key"),
          );
          if (!parsedBody.success || !parsedIdempotencyKey.success) {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          try {
            const result = await createConnectionCreationService({
              bmoInstitutionId: env.PLAID_BMO_INSTITUTION_ID,
              database: env.DB,
              plaid: createPlaid(env),
              rbcInstitutionId: env.PLAID_RBC_INSTITUTION_ID,
              tokenEncryptionKey: env.PLAID_TOKEN_ENCRYPTION_KEY,
            }).create({
              idempotencyKey: parsedIdempotencyKey.data,
              publicToken: parsedBody.data.publicToken,
            });
            logger.write({
              connectionId: result.connection.id,
              event: "API_REQUEST",
              level: "INFO",
              outcome: "SUCCESS",
              status: 200,
            });
            return secure(
              Response.json({
                data: { connection: result.connection },
                meta: { replayed: result.replayed },
              }),
            );
          } catch (error) {
            const failure =
              error instanceof ConnectionCreationServiceError
                ? error
                : new ConnectionCreationServiceError("INTERNAL_ERROR");
            const response = connectionCreationDenied(failure);
            logger.write({
              errorCode: failure.code,
              event: "API_REQUEST",
              level: failure.code === "IDEMPOTENCY_CONFLICT" ? "WARN" : "ERROR",
              outcome: "FAILED",
              status: response.status,
            });
            return secure(response);
          }
        }
        return secure(
          Response.json(
            {
              error: {
                code: "APP_NOT_READY",
                message: "The protected API is not available yet.",
              },
            },
            { status: 503 },
          ),
        );
      }

      return secure(await env.ASSETS.fetch(request));
    },
  };
}

const productionLogger = createStructuredLogger({ sink: (line) => console.log(line) });

export default createAppWorker(
  createConfiguredAccessGate(),
  productionLogger,
) satisfies ExportedHandler<AppEnv>;
