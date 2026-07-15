import { connectionCreationResponseSchema } from "@ledger/domain/api-contracts";
import { decryptPlaidAccessToken } from "@ledger/domain/token-crypto";
import type { PlaidClient, PlaidItemAccounts } from "@ledger/plaid";
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

const workerEnv = {
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

const DEFAULT_ACCOUNTS: PlaidItemAccounts = {
  accounts: [
    {
      id: "plaid-checking-1",
      isoCurrencyCode: "CAD",
      mask: "1234",
      name: "Daily Chequing",
      subtype: "checking",
      type: "depository",
    },
    {
      id: "plaid-credit-1",
      isoCurrencyCode: "CAD",
      mask: "5678",
      name: "Cashback Mastercard",
      subtype: "credit card",
      type: "credit",
    },
    {
      id: "plaid-savings-1",
      isoCurrencyCode: "CAD",
      mask: "9999",
      name: "Unsupported Savings",
      subtype: "savings",
      type: "depository",
    },
  ],
  institutionId: "ins_100001",
  institutionName: "Untrusted upstream display name",
  itemId: "item-rbc-1",
};

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

function plaidClient(accounts = DEFAULT_ACCOUNTS) {
  const exchangePublicToken = vi
    .fn<PlaidClient["exchangePublicToken"]>()
    .mockResolvedValue({ accessToken: "access-sandbox-private-token", itemId: "item-rbc-1" });
  const getItemAccounts = vi.fn<PlaidClient["getItemAccounts"]>().mockResolvedValue(accounts);
  const client: PlaidClient = {
    createInitialLinkToken: vi.fn<PlaidClient["createInitialLinkToken"]>(),
    createUpdateLinkToken: vi.fn<PlaidClient["createUpdateLinkToken"]>(),
    exchangePublicToken,
    getWebhookVerificationKey: vi.fn<PlaidClient["getWebhookVerificationKey"]>(),
    getItemAccounts,
    syncTransactions: vi.fn<PlaidClient["syncTransactions"]>(),
  };
  return { client, exchangePublicToken, getItemAccounts };
}

function request(
  publicToken = "public-sandbox-token",
  idempotencyKey = "connection-request-0001",
): Request {
  return new Request("https://ledger.example/api/v1/plaid/items", {
    body: JSON.stringify({ publicToken }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      Origin: "https://ledger.example",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrfToken,
    },
    method: "POST",
  });
}

describe("idempotent Plaid public-token exchange", () => {
  it("persists only encrypted token material and eligible RBC accounts", async () => {
    const plaid = plaidClient();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );

    const response = await worker.fetch(request(), workerEnv);
    const responseText = await response.text();
    const body = connectionCreationResponseSchema.parse(JSON.parse(responseText));

    expect(response.status).toBe(200);
    expect(body.meta).toEqual({ replayed: false });
    expect(body.data.connection).toMatchObject({
      institutionCode: "RBC",
      institutionName: "Royal Bank of Canada",
      status: "HEALTHY",
    });
    expect(body.data.connection.accounts.map(({ subtype }) => subtype).sort()).toEqual([
      "CHECKING",
      "CREDIT_CARD",
    ]);
    expect(responseText).not.toMatch(/public-sandbox|access-sandbox|1234|5678|9999|plaid-/);

    const connection = await cloudflareEnv.DB.prepare(
      `SELECT id, plaid_item_id, access_token_ciphertext, access_token_iv, token_key_version
       FROM connections`,
    ).first<{
      access_token_ciphertext: ArrayBuffer;
      access_token_iv: ArrayBuffer;
      id: string;
      plaid_item_id: string;
      token_key_version: number;
    }>();
    expect(connection).not.toBeNull();
    await expect(
      decryptPlaidAccessToken(
        {
          ciphertext: new Uint8Array(connection!.access_token_ciphertext),
          iv: new Uint8Array(connection!.access_token_iv),
          keyVersion: connection!.token_key_version,
        },
        { connectionId: connection!.id, plaidItemId: connection!.plaid_item_id },
        [{ encodedKey: TOKEN_KEY, version: 1 }],
      ),
    ).resolves.toBe("access-sandbox-private-token");

    const storedAccounts = await cloudflareEnv.DB.prepare(
      "SELECT plaid_account_id, enabled FROM accounts ORDER BY plaid_account_id",
    ).all<{ enabled: number; plaid_account_id: string }>();
    expect(storedAccounts.results).toEqual([
      { enabled: 1, plaid_account_id: "plaid-checking-1" },
      { enabled: 1, plaid_account_id: "plaid-credit-1" },
    ]);
    const requestRows = JSON.stringify(
      await cloudflareEnv.DB.prepare("SELECT * FROM connection_requests").all(),
    );
    expect(requestRows).not.toContain("public-sandbox-token");
  });

  it("replays a completed request without exchanging the token again", async () => {
    const plaid = plaidClient();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );

    const first = connectionCreationResponseSchema.parse(
      await (await worker.fetch(request(), workerEnv)).json(),
    );
    const second = connectionCreationResponseSchema.parse(
      await (await worker.fetch(request(), workerEnv)).json(),
    );

    expect(first.meta.replayed).toBe(false);
    expect(second).toEqual({ data: first.data, meta: { replayed: true } });
    expect(plaid.exchangePublicToken).toHaveBeenCalledOnce();
    expect(plaid.getItemAccounts).toHaveBeenCalledOnce();
  });

  it("rejects reuse of an idempotency key with another public token", async () => {
    const plaid = plaidClient();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );
    await worker.fetch(request(), workerEnv);

    const response = await worker.fetch(request("public-different-token"), workerEnv);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "The idempotency key is already in use.",
      },
    });
    expect(plaid.exchangePublicToken).toHaveBeenCalledOnce();
  });

  it("rejects an institution outside the configured RBC/BMO ids before persistence", async () => {
    const plaid = plaidClient({ ...DEFAULT_ACCOUNTS, institutionId: "ins-unsupported" });
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );

    const response = await worker.fetch(request(), workerEnv);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_INSTITUTION" },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM connections").first("count"),
    ).resolves.toBe(0);
  });

  it("rejects an Item with no eligible checking or credit-card account", async () => {
    const plaid = plaidClient({
      ...DEFAULT_ACCOUNTS,
      accounts: [DEFAULT_ACCOUNTS.accounts[2]!],
    });
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );

    const response = await worker.fetch(request(), workerEnv);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NO_SUPPORTED_ACCOUNTS" },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM connections").first("count"),
    ).resolves.toBe(0);
  });

  it("accepts the separately configured BMO institution id", async () => {
    const plaid = plaidClient({ ...DEFAULT_ACCOUNTS, institutionId: "ins_100002" });
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );

    const response = connectionCreationResponseSchema.parse(
      await (await worker.fetch(request(), workerEnv)).json(),
    );

    expect(response.data.connection).toMatchObject({
      institutionCode: "BMO",
      institutionName: "Bank of Montreal",
    });
  });

  it("requires a valid idempotency key and strict request body", async () => {
    const plaid = plaidClient();
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );
    const missingKey = request();
    missingKey.headers.delete("Idempotency-Key");
    const extraConfiguration = new Request("https://ledger.example/api/v1/plaid/items", {
      body: JSON.stringify({ products: ["auth"], publicToken: "public-sandbox-token" }),
      headers: request().headers,
      method: "POST",
    });

    for (const invalidRequest of [missingKey, extraConfiguration]) {
      const response = await worker.fetch(invalidRequest, workerEnv);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(plaid.exchangePublicToken).not.toHaveBeenCalled();
  });

  it("rejects mismatched Item identities across Plaid responses", async () => {
    const plaid = plaidClient({ ...DEFAULT_ACCOUNTS, itemId: "item-other" });
    const worker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      undefined,
      () => plaid.client,
    );

    const response = await worker.fetch(request(), workerEnv);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Plaid is temporarily unavailable.",
      },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM connections").first("count"),
    ).resolves.toBe(0);
  });
});
