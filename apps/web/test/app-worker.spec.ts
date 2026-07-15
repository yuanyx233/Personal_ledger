import { sessionResponseSchema } from "@ledger/domain/api-contracts";
import { createStructuredLogger } from "@ledger/domain/logging";
import { describe, expect, it } from "vitest";

import { createAppWorker, createConfiguredAccessGate, type AppEnv } from "../worker/index";
import { verifyCsrfToken } from "../worker/security/csrf";

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

  it("fails closed for unfinished API routes after authentication", async () => {
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/transactions"),
      env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "APP_NOT_READY" } });
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
