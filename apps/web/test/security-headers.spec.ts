import { describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";

const env = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: {
    fetch: () =>
      Promise.resolve(
        new Response("workspace asset", {
          headers: {
            "Cache-Control": "public, max-age=3600",
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      ),
  },
  CSRF_HMAC_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
} as unknown as AppEnv;

const worker = createAppWorker(() =>
  Promise.resolve({
    email: "owner@example.invalid",
    sessionBinding: "access-session-1",
    subject: "owner-subject",
  }),
);

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; " +
      "form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; " +
      "script-src 'self'; style-src 'self'",
  );
  expect(response.headers.get("Strict-Transport-Security")).toBe(
    "max-age=31536000; includeSubDomains",
  );
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

describe("protected application response headers", () => {
  it("adds browser security headers to authenticated static assets", async () => {
    const response = await worker.fetch(new Request("https://ledger.example/"), env);

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("marks authenticated API and future export responses no-store", async () => {
    for (const path of ["/api/v1/session", "/api/v1/exports/json"]) {
      const response = await worker.fetch(new Request(`https://ledger.example${path}`), env);

      expectSecurityHeaders(response);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("keeps rejected API requests no-store and free of CORS opt-in", async () => {
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/transactions", {
        headers: {
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
      env,
    );

    expect(response.status).toBe(403);
    expectSecurityHeaders(response);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});
