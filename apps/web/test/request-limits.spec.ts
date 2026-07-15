import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const CSRF_HMAC_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const rateLimitKeys: string[] = [];
let rateLimitSuccess = true;
const env = {
  API_RATE_LIMITER: {
    limit: ({ key }: { key: string }) => {
      rateLimitKeys.push(key);
      return Promise.resolve({ success: rateLimitSuccess });
    },
  },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY,
} as unknown as AppEnv;
const worker = createAppWorker(() => Promise.resolve(IDENTITY));

let csrfToken: string;

beforeAll(async () => {
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_HMAC_KEY);
});

beforeEach(() => {
  rateLimitKeys.length = 0;
  rateLimitSuccess = true;
});

function writeHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Origin: "https://ledger.example",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": csrfToken,
  };
}

async function expectLimitError(
  response: Response,
  status: number,
  code: string,
  message: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ error: { code, message } });
}

describe("application request resource limits", () => {
  it("returns a stable 413 before an oversized JSON body reaches a handler", async () => {
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/transactions", {
        body: "x".repeat(65_537),
        headers: writeHeaders(),
        method: "POST",
      }),
      env,
    );

    await expectLimitError(response, 413, "PAYLOAD_TOO_LARGE", "Request payload is too large.");
  });

  it("returns stable 422 responses for page and date range violations", async () => {
    for (const query of ["pageSize=101", "dateFrom=2025-01-01&dateTo=2027-01-01"]) {
      const response = await worker.fetch(
        new Request(`https://ledger.example/api/v1/transactions?${query}`),
        env,
      );
      await expectLimitError(response, 422, "VALIDATION_ERROR", "Request parameters are invalid.");
    }
  });

  it("uses a stable session-and-route limiter key and returns 429 with retry guidance", async () => {
    rateLimitSuccess = false;
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/transactions"),
      env,
    );

    await expectLimitError(response, 429, "RATE_LIMITED", "Too many requests.");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(rateLimitKeys).toEqual(["access-session-1:transactions"]);
  });
});
