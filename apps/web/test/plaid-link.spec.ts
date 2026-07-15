import { linkTokenResponseSchema } from "@ledger/domain/api-contracts";
import { encryptPlaidAccessToken } from "@ledger/domain/token-crypto";
import { PlaidAdapterError, type PlaidClient } from "@ledger/plaid";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const env = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
  PLAID_BMO_INSTITUTION_ID: "ins_100002",
  PLAID_CLIENT_ID: "private-client-id",
  PLAID_ENV: "sandbox",
  PLAID_LINK_CUSTOMIZATION_NAME: "personal-ledger-account-select",
  PLAID_RBC_INSTITUTION_ID: "ins_100001",
  PLAID_SECRET: "private-secret",
  PLAID_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  PLAID_WEBHOOK_URL: "https://sync.example.invalid/webhooks/plaid",
} as unknown as AppEnv;

let csrfToken: string;

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

beforeEach(async () => {
  await cloudflareEnv.DB.batch(
    ["accounts", "connections", "connection_requests"].map((table) =>
      cloudflareEnv.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});

function request(body = JSON.stringify({ institutionCode: "RBC", mode: "INITIAL" })): Request {
  return new Request("https://ledger.example/api/v1/plaid/link-tokens", {
    body,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://ledger.example",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrfToken,
    },
    method: "POST",
  });
}

function linkOnlyClient(
  createInitialLinkToken: PlaidClient["createInitialLinkToken"],
  createUpdateLinkToken: PlaidClient["createUpdateLinkToken"] = vi.fn<
    PlaidClient["createUpdateLinkToken"]
  >(),
): PlaidClient {
  return {
    createInitialLinkToken,
    createUpdateLinkToken,
    exchangePublicToken: vi.fn<PlaidClient["exchangePublicToken"]>(),
    getItemAccounts: vi.fn<PlaidClient["getItemAccounts"]>(),
  };
}

async function seedConnection(
  institutionId = "ins_100001",
  status: "HEALTHY" | "DISCONNECTED" = "HEALTHY",
): Promise<void> {
  const connectionId = "connection-rbc-1";
  const plaidItemId = "item-rbc-private";
  const encrypted = await encryptPlaidAccessToken(
    "access-rbc-private",
    { connectionId, plaidItemId },
    { encodedKey: TOKEN_KEY, version: 1 },
  );
  await cloudflareEnv.DB.prepare(
    `INSERT INTO connections (
      id, institution_id, institution_name, plaid_item_id,
      access_token_ciphertext, access_token_iv, token_key_version,
      status, created_at, updated_at, version
    ) VALUES (?, ?, 'Royal Bank of Canada', ?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(
      connectionId,
      institutionId,
      plaidItemId,
      encrypted.ciphertext.buffer,
      encrypted.iv.buffer,
      encrypted.keyVersion,
      status,
      "2026-07-15T12:00:00.000Z",
      "2026-07-15T12:00:00.000Z",
    )
    .run();
}

describe("protected initial Plaid Link-token endpoint", () => {
  it("creates and returns only a short-lived Link token", async () => {
    const createInitialLinkToken = vi
      .fn<PlaidClient["createInitialLinkToken"]>()
      .mockResolvedValue({
        expiresAt: "2026-07-15T12:30:00Z",
        linkToken: "link-sandbox-token",
      });
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => linkOnlyClient(createInitialLinkToken),
    );

    const response = await worker.fetch(request(), env);

    expect(response.status).toBe(200);
    const rawBody: unknown = await response.json();
    expect(linkTokenResponseSchema.parse(rawBody)).toEqual({
      data: {
        expiresAt: "2026-07-15T12:30:00Z",
        linkToken: "link-sandbox-token",
      },
      meta: {},
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(createInitialLinkToken).toHaveBeenCalledWith({
      clientName: "Personal Ledger",
      clientUserId: "owner",
      language: "en",
      linkCustomizationName: "personal-ledger-account-select",
      webhookUrl: "https://sync.example.invalid/webhooks/plaid",
    });
  });

  it("rejects request-controlled configuration before calling Plaid", async () => {
    const createInitialLinkToken = vi.fn<PlaidClient["createInitialLinkToken"]>();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => linkOnlyClient(createInitialLinkToken),
    );

    const response = await worker.fetch(
      request('{"institutionCode":"RBC","mode":"INITIAL","products":["auth"]}'),
      env,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Request parameters are invalid." },
    });
    expect(createInitialLinkToken).not.toHaveBeenCalled();
  });

  it("maps Plaid availability failures to a stable response", async () => {
    const createInitialLinkToken = vi
      .fn<PlaidClient["createInitialLinkToken"]>()
      .mockRejectedValue(new PlaidAdapterError("UPSTREAM_UNAVAILABLE"));
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => linkOnlyClient(createInitialLinkToken),
    );

    const response = await worker.fetch(request(), env);
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toEqual({
      error: { code: "UPSTREAM_UNAVAILABLE", message: "Plaid is temporarily unavailable." },
    });
  });

  it("sanitizes unexpected adapter and configuration failures", async () => {
    const sensitiveDetail = "private-client-id private-secret private-upstream-body";
    const createInitialLinkToken = vi
      .fn<PlaidClient["createInitialLinkToken"]>()
      .mockRejectedValue(new Error(sensitiveDetail));
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => linkOnlyClient(createInitialLinkToken),
    );

    const response = await worker.fetch(request(), env);
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).not.toContain(sensitiveDetail);
    expect(JSON.parse(responseText)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    });
  });

  it("rejects non-POST methods without calling Plaid", async () => {
    const createInitialLinkToken = vi.fn<PlaidClient["createInitialLinkToken"]>();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => linkOnlyClient(createInitialLinkToken),
    );

    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/plaid/link-tokens"),
      env,
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "This method is not allowed." },
    });
    expect(createInitialLinkToken).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before creating another Item for an institution", async () => {
    await seedConnection();
    const createInitialLinkToken = vi.fn<PlaidClient["createInitialLinkToken"]>();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => linkOnlyClient(createInitialLinkToken),
    );

    const denied = await worker.fetch(request(), env);
    const deniedText = await denied.text();

    expect(denied.status).toBe(409);
    expect(JSON.parse(deniedText)).toMatchObject({
      error: { code: "ADDITIONAL_ITEM_CONFIRMATION_REQUIRED" },
    });
    expect(deniedText).toContain("10");
    expect(deniedText).toContain("does not restore");
    expect(createInitialLinkToken).not.toHaveBeenCalled();

    createInitialLinkToken.mockResolvedValue({
      expiresAt: "2026-07-15T12:30:00Z",
      linkToken: "link-extra-item-token",
    });
    const confirmed = await worker.fetch(
      request(
        JSON.stringify({
          confirmAdditionalItem: true,
          institutionCode: "RBC",
          mode: "INITIAL",
        }),
      ),
      env,
    );

    expect(confirmed.status).toBe(200);
    expect(createInitialLinkToken).toHaveBeenCalledOnce();
  });

  it.each(["LOGIN_REQUIRED", "CONSENT_RENEWAL", "ACCOUNT_SELECTION"] as const)(
    "creates a %s update token from the stored encrypted token",
    async (reason) => {
      await seedConnection();
      const createUpdateLinkToken = vi
        .fn<PlaidClient["createUpdateLinkToken"]>()
        .mockResolvedValue({
          expiresAt: "2026-07-15T12:30:00Z",
          linkToken: "link-update-token",
        });
      const worker = createAppWorker(
        () => Promise.resolve(IDENTITY),
        undefined,
        () => linkOnlyClient(vi.fn(), createUpdateLinkToken),
      );

      const response = await worker.fetch(
        request(
          JSON.stringify({
            connectionId: "connection-rbc-1",
            mode: "UPDATE",
            reason,
          }),
        ),
        env,
      );
      const responseText = await response.text();

      expect(response.status).toBe(200);
      expect(linkTokenResponseSchema.parse(JSON.parse(responseText))).toMatchObject({
        data: { linkToken: "link-update-token" },
      });
      expect(createUpdateLinkToken).toHaveBeenCalledWith({
        accessToken: "access-rbc-private",
        clientName: "Personal Ledger",
        clientUserId: "owner",
        language: "en",
        linkCustomizationName: "personal-ledger-account-select",
        reason,
        webhookUrl: "https://sync.example.invalid/webhooks/plaid",
      });
      expect(responseText).not.toContain("access-rbc-private");
    },
  );

  it("does not allow update mode to recreate a disconnected Item", async () => {
    await seedConnection("ins_100001", "DISCONNECTED");
    const createUpdateLinkToken = vi.fn<PlaidClient["createUpdateLinkToken"]>();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => linkOnlyClient(vi.fn(), createUpdateLinkToken),
    );

    const response = await worker.fetch(
      request(
        JSON.stringify({
          connectionId: "connection-rbc-1",
          mode: "UPDATE",
          reason: "LOGIN_REQUIRED",
        }),
      ),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CONNECTION_NOT_REPAIRABLE" },
    });
    expect(createUpdateLinkToken).not.toHaveBeenCalled();
  });
});
