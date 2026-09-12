import { sessionResponseSchema } from "@ledger/domain/api-contracts";
import { createStructuredLogger } from "@ledger/domain/logging";
import { describe, expect, it } from "vitest";

import { createAppWorker, createConfiguredAccessGate, type AppEnv } from "../worker/index";
import { issueCsrfToken, verifyCsrfToken } from "../worker/security/csrf";

const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const env = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: {
    fetch: () => Promise.resolve(new Response("workspace asset")),
  },
  CSRF_HMAC_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
} as unknown as AppEnv;
const worker = createAppWorker(() => Promise.resolve(IDENTITY));

describe("authenticated app Worker routing", () => {
  it("has no bank, subscription-candidate, transfer-decision or review API", async () => {
    for (const path of [
      "/connections",
      "/sync-runs",
      "/plaid/link-tokens",
      "/subscription-candidates",
      "/review-queue",
      "/transactions/transaction-example/transfer-decision",
    ]) {
      const response = await worker.fetch(new Request(`https://ledger.example/api/v1${path}`), env);
      expect(response.status).toBe(404);
    }
    expect(worker).toHaveProperty("scheduled");
  });

  it("rejects unsupported methods on the remaining API surface", async () => {
    const token = await issueCsrfToken(IDENTITY, env.CSRF_HMAC_KEY);
    for (const [path, method] of [
      ["/accounts", "POST"],
      ["/categories", "DELETE"],
      ["/reports/spending", "POST"],
      ["/reports/cash-flow", "POST"],
      ["/exports/transactions.csv", "POST"],
      ["/exports/data.json", "POST"],
      ["/merchant-rule-previews", "POST"],
      ["/transactions/transaction-example", "PUT"],
      ["/transactions/transaction-example/merchant-rule", "POST"],
      ["/merchant-rules/example", "PUT"],
    ] as const) {
      const response = await worker.fetch(
        new Request(`https://ledger.example/api/v1${path}`, {
          method,
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://ledger.example",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "X-CSRF-Token": token,
          },
        }),
        env,
      );
      expect(response.status, path).toBe(405);
    }
    const response = await worker.fetch(new Request("https://ledger.example/api/v1/accounts"), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });

  it("returns the identity, timezone, and a session-bound CSRF token", async () => {
    const response = await worker.fetch(new Request("https://ledger.example/api/v1/session"), env);

    expect(response.status).toBe(200);
    const rawBody: unknown = await response.json();
    const body = sessionResponseSchema.parse(rawBody);
    expect(body).toMatchObject({
      data: {
        identity: { email: IDENTITY.email },
        timezone: "America/Toronto",
      },
      meta: {},
    });
    await expect(verifyCsrfToken(body.data.csrfToken, IDENTITY, env.CSRF_HMAC_KEY)).resolves.toBe(
      true,
    );
    await expect(
      verifyCsrfToken(
        body.data.csrfToken,
        { ...IDENTITY, sessionBinding: "access-session-2" },
        env.CSRF_HMAC_KEY,
      ),
    ).resolves.toBe(false);
  });

  it("fails closed for removed API routes after authentication", async () => {
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/reports/trends"),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("validates report queries and sanitizes unexpected report persistence failures", async () => {
    const invalid = await worker.fetch(
      new Request("https://ledger.example/api/v1/reports/cash-flow?grain=MONTH&period=invalid"),
      env,
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    for (const route of ["cash-flow", "spending"]) {
      const response = await worker.fetch(
        new Request(`https://ledger.example/api/v1/reports/${route}?grain=MONTH&period=2026-01`),
        env,
      );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
        },
      });
    }
  });

  it("delegates authenticated non-API requests to the static asset binding", async () => {
    const response = await worker.fetch(new Request("https://ledger.example/"), env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("workspace asset");
  });

  it("sanitizes unexpected verifier failures", async () => {
    const sensitiveDetail =
      'access-sandbox-secret | 9876543210123456 | Private Merchant | =HYPERLINK("x") | {"item_id":"private"}';
    const logLines: string[] = [];
    const logger = createStructuredLogger({
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      sink: (line) => logLines.push(line),
    });
    const failingWorker = createAppWorker(() => Promise.reject(new Error(sensitiveDetail)), logger);
    const response = await failingWorker.fetch(new Request("https://ledger.example/"), env);

    expect(response.status).toBe(403);
    const responseText = await response.text();
    expect(responseText).not.toContain(sensitiveDetail);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "ACCESS_ASSERTION_INVALID",
        message: "Access denied.",
      },
    });
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain('"errorCode":"ACCESS_ASSERTION_INVALID"');
    expect(logLines[0]).not.toContain(sensitiveDetail);
  });

  it("caches the configured verifier and refreshes it only when auth config changes", async () => {
    const configurations: Array<{ audience: string; ownerEmail: string; teamDomain: string }> = [];
    const gate = createConfiguredAccessGate((config) => {
      configurations.push(config);
      return () =>
        Promise.resolve({
          email: config.ownerEmail,
          sessionBinding: `session:${config.ownerEmail}`,
          subject: null,
        });
    });
    const configuredWorker = createAppWorker(gate);
    const configuredEnv = {
      ...env,
      ACCESS_AUD: "audience-1",
      ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
      OWNER_EMAIL: "owner@example.invalid",
    };

    await configuredWorker.fetch(new Request("https://ledger.example/"), configuredEnv);
    await configuredWorker.fetch(new Request("https://ledger.example/"), configuredEnv);
    await configuredWorker.fetch(new Request("https://ledger.example/"), {
      ...configuredEnv,
      OWNER_EMAIL: "new-owner@example.invalid",
    });

    expect(configurations).toEqual([
      {
        audience: "audience-1",
        ownerEmail: "owner@example.invalid",
        teamDomain: "https://example.cloudflareaccess.com",
      },
      {
        audience: "audience-1",
        ownerEmail: "new-owner@example.invalid",
        teamDomain: "https://example.cloudflareaccess.com",
      },
    ]);
  });
});
