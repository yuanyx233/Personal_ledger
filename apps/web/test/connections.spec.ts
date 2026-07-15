import {
  accountUpdateResponseSchema,
  connectionsResponseSchema,
} from "@ledger/domain/api-contracts";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
  PLAID_BMO_INSTITUTION_ID: "ins_100002",
  PLAID_RBC_INSTITUTION_ID: "ins_100001",
} as unknown as AppEnv;
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  undefined,
  () => new Date("2026-07-15T12:00:00.000Z"),
);

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
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO connections (
        id, institution_id, institution_name, plaid_item_id,
        access_token_ciphertext, access_token_iv, token_key_version,
        status, last_success_at, consent_expires_at, created_at, updated_at, version
      ) VALUES (
        'connection-rbc-1', 'ins_100001', 'Royal Bank of Canada', 'plaid-item-private',
        X'0102030405060708091011121314151617', X'010203040506070809101112', 1,
        'HEALTHY', '2026-07-15T11:55:00.000Z', '2026-08-15T12:00:00.000Z',
        '2026-07-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z', 1
      )`,
    ),
    cloudflareEnv.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-checking-1', 'connection-rbc-1', 'plaid-account-private-1',
        'Daily Chequing', '1234', 'DEPOSITORY', 'CHECKING', 'CAD', 1,
        '2026-07-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z', 1
      )`,
    ),
    cloudflareEnv.DB.prepare(
      `INSERT INTO accounts (
        id, connection_id, plaid_account_id, display_name, mask, type, subtype,
        currency, enabled, created_at, updated_at, version
      ) VALUES (
        'account-credit-1', 'connection-rbc-1', 'plaid-account-private-2',
        'Cashback Mastercard', '5678', 'CREDIT', 'CREDIT_CARD', 'CAD', 0,
        '2026-07-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z', 1
      )`,
    ),
  ]);
});

function patchAccount(accountId: string, body: Record<string, unknown>): Promise<Response> {
  return worker.fetch(
    new Request(`https://ledger.example/api/v1/accounts/${accountId}`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ledger.example",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrfToken,
      },
      method: "PATCH",
    }),
    workerEnv,
  );
}

describe("connection and eligible-account controls", () => {
  it("returns a secret-free connection read model with enabled and disabled accounts", async () => {
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/connections"),
      workerEnv,
    );
    const responseText = await response.text();
    const body = connectionsResponseSchema.parse(JSON.parse(responseText));

    expect(response.status).toBe(200);
    expect(body.data.connections).toHaveLength(1);
    expect(body.data.connections[0]).toMatchObject({
      consentExpiresAt: "2026-08-15T12:00:00.000Z",
      consentState: "CURRENT",
      id: "connection-rbc-1",
      institutionCode: "RBC",
      lastFailureCode: null,
      lastSuccessAt: "2026-07-15T11:55:00.000Z",
      nextActionCode: "NONE",
      status: "HEALTHY",
    });
    expect(body.data.connections[0]!.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          id: "account-checking-1",
          subtype: "CHECKING",
        }),
        expect.objectContaining({
          enabled: false,
          id: "account-credit-1",
          subtype: "CREDIT_CARD",
        }),
      ]),
    );
    expect(responseText).not.toMatch(/access_token|01020304|plaid-item|plaid-account/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("updates only enabled state and advances the optimistic version", async () => {
    const response = await patchAccount("account-credit-1", { enabled: true, version: 1 });
    const body = accountUpdateResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.account).toMatchObject({
      enabled: true,
      id: "account-credit-1",
      subtype: "CREDIT_CARD",
      version: 2,
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT enabled, version FROM accounts WHERE id = ?")
        .bind("account-credit-1")
        .first(),
    ).resolves.toEqual({ enabled: 1, version: 2 });
  });

  it("returns the current version for a stale update", async () => {
    await patchAccount("account-checking-1", { enabled: false, version: 1 });

    const response = await patchAccount("account-checking-1", { enabled: true, version: 1 });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VERSION_CONFLICT",
        currentVersion: 2,
        message: "The account changed. Refresh and try again.",
      },
    });
  });

  it("rejects unknown accounts and client-supplied account type changes", async () => {
    const missing = await patchAccount("account-missing", { enabled: true, version: 1 });
    expect(missing.status).toBe(404);

    const forged = await patchAccount("account-checking-1", {
      enabled: true,
      subtype: "SAVINGS",
      version: 1,
    });
    expect(forged.status).toBe(422);
    await expect(forged.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT subtype, version FROM accounts WHERE id = ?")
        .bind("account-checking-1")
        .first(),
    ).resolves.toEqual({ subtype: "CHECKING", version: 1 });
  });

  it("fails closed for an unconfigured stored institution", async () => {
    await cloudflareEnv.DB.prepare(
      "UPDATE connections SET institution_id = 'ins_unsupported' WHERE id = ?",
    )
      .bind("connection-rbc-1")
      .run();

    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/connections"),
      workerEnv,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    });
  });

  it("returns sanitized repair actions without exposing Plaid error details", async () => {
    await cloudflareEnv.DB.prepare(
      `UPDATE connections
       SET status = 'ERROR', last_error_code = 'ITEM_LOGIN_REQUIRED', consent_expires_at = NULL
       WHERE id = ?`,
    )
      .bind("connection-rbc-1")
      .run();

    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/connections"),
      workerEnv,
    );
    const responseText = await response.text();
    const body = connectionsResponseSchema.parse(JSON.parse(responseText));

    expect(body.data.connections[0]).toMatchObject({
      consentState: "NOT_REQUIRED",
      lastFailureCode: "LOGIN_REQUIRED",
      nextActionCode: "REAUTHENTICATE",
      status: "ACTION_REQUIRED",
    });
    expect(responseText).not.toContain("ITEM_LOGIN_REQUIRED");
  });

  it("rejects unsupported methods on both control routes", async () => {
    const connectionResponse = await worker.fetch(
      new Request("https://ledger.example/api/v1/connections", {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://ledger.example",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      }),
      workerEnv,
    );
    const accountResponse = await worker.fetch(
      new Request("https://ledger.example/api/v1/accounts/account-checking-1"),
      workerEnv,
    );

    expect(connectionResponse.status).toBe(405);
    expect(accountResponse.status).toBe(405);
  });
});
