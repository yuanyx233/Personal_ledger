import { beforeAll, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const env = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
} as unknown as AppEnv;
const worker = createAppWorker(() => Promise.resolve(IDENTITY));

let validCsrfToken: string;

beforeAll(async () => {
  validCsrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

function apiRequest(
  method: string,
  headers: Record<string, string> = {},
  path = "/transactions",
): Promise<Response> {
  const init: RequestInit = { headers, method };

  if (method !== "GET" && method !== "HEAD") {
    init.body = "{}";
  }

  return worker.fetch(new Request(`https://ledger.example/api/v1${path}`, init), env);
}

function validWriteHeaders(token = validCsrfToken): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    Origin: "https://ledger.example",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": token,
  };
}

async function expectDenied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  await expect(response.json()).resolves.toEqual({
    error: { code, message: "Request denied." },
  });
}

describe("same-origin browser API guard", () => {
  it("denies cross-origin safe requests without CORS opt-in", async () => {
    await expectDenied(
      await apiRequest("GET", {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      }),
      403,
      "ORIGIN_DENIED",
    );
  });

  it("allows a same-origin safe request without a CSRF token", async () => {
    const response = await apiRequest(
      "GET",
      {
        Origin: "https://ledger.example",
        "Sec-Fetch-Site": "same-origin",
      },
      "/reports/trends",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("requires an exact Origin on every write", async () => {
    const missingOrigin = validWriteHeaders();
    delete missingOrigin.Origin;
    await expectDenied(await apiRequest("POST", missingOrigin), 403, "ORIGIN_DENIED");
    await expectDenied(
      await apiRequest("POST", { ...validWriteHeaders(), Origin: "https://evil.example" }),
      403,
      "ORIGIN_DENIED",
    );
  });

  it("requires same-origin Fetch Metadata on every write", async () => {
    const missingMetadata = validWriteHeaders();
    delete missingMetadata["Sec-Fetch-Site"];
    await expectDenied(await apiRequest("POST", missingMetadata), 403, "FETCH_METADATA_DENIED");
    await expectDenied(
      await apiRequest("POST", {
        ...validWriteHeaders(),
        "Sec-Fetch-Site": "cross-site",
      }),
      403,
      "FETCH_METADATA_DENIED",
    );
  });

  it("requires JSON on every write", async () => {
    const missingContentType = validWriteHeaders();
    delete missingContentType["Content-Type"];
    await expectDenied(await apiRequest("POST", missingContentType), 415, "UNSUPPORTED_MEDIA_TYPE");
    await expectDenied(
      await apiRequest("POST", { ...validWriteHeaders(), "Content-Type": "text/plain" }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  it("rejects missing, tampered, expired, and other-session CSRF tokens", async () => {
    const missingToken = validWriteHeaders();
    delete missingToken["X-CSRF-Token"];
    await expectDenied(await apiRequest("POST", missingToken), 403, "CSRF_INVALID");
    const tamperedToken = `${validCsrfToken[0] === "a" ? "b" : "a"}${validCsrfToken.slice(1)}`;
    await expectDenied(
      await apiRequest("POST", validWriteHeaders(tamperedToken)),
      403,
      "CSRF_INVALID",
    );

    const expiredToken = await issueCsrfToken(IDENTITY, CSRF_KEY, {
      nowSeconds: 1,
      ttlSeconds: 60,
    });
    await expectDenied(
      await apiRequest("POST", validWriteHeaders(expiredToken)),
      403,
      "CSRF_INVALID",
    );

    const otherSessionToken = await issueCsrfToken(
      { ...IDENTITY, sessionBinding: "access-session-2" },
      CSRF_KEY,
    );
    await expectDenied(
      await apiRequest("POST", validWriteHeaders(otherSessionToken)),
      403,
      "CSRF_INVALID",
    );
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "allows a fully guarded %s through to routing",
    async (method) => {
      const response = await apiRequest(method, validWriteHeaders());

      expect(response.status).toBe(method === "POST" ? 422 : 405);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: method === "POST" ? "VALIDATION_ERROR" : "METHOD_NOT_ALLOWED" },
      });
    },
  );
});
