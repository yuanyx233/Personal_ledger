import {
  REQUEST_LIMITS,
  RequestLimitError,
  enforceRequestLimits,
} from "@ledger/domain/request-limits";

const PLAID_WEBHOOK_PATH = "/webhooks/plaid";

export interface SyncEnv {
  WEBHOOK_RATE_LIMITER: RateLimit;
}

function rateLimited(): Response {
  const response = Response.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests." } },
    { status: 429 },
  );
  response.headers.set("Retry-After", "60");
  return response;
}

function syncNotReady(): Response {
  return Response.json(
    {
      error: {
        code: "SYNC_NOT_READY",
        message: "Webhook intake is not available yet.",
      },
    },
    { status: 503 },
  );
}

export function createSyncWorker() {
  return {
    async fetch(request: Request, env: SyncEnv): Promise<Response> {
      const url = new URL(request.url);

      if (request.method !== "POST" || url.pathname !== PLAID_WEBHOOK_PATH) {
        return new Response(null, { status: 404 });
      }

      try {
        const rateLimit = await env.WEBHOOK_RATE_LIMITER.limit({ key: "plaid-webhook" });
        if (!rateLimit.success) return rateLimited();
        await enforceRequestLimits(request, {
          bodyBytes: REQUEST_LIMITS.PLAID_WEBHOOK_BYTES,
          routeId: "plaid-webhook",
        });
      } catch (error) {
        if (error instanceof RequestLimitError && error.code === "PAYLOAD_TOO_LARGE") {
          return Response.json(
            {
              error: {
                code: error.code,
                message: "Request payload is too large.",
              },
            },
            { status: error.status },
          );
        }
        return syncNotReady();
      }

      return syncNotReady();
    },
  };
}

export default createSyncWorker() satisfies ExportedHandler<SyncEnv>;
