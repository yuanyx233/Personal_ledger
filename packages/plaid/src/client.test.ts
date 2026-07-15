import { describe, expect, it, vi } from "vitest";

import { PlaidAdapterError, createPlaidClient } from "./client";

const LINK_INPUT = {
  clientName: "Personal Ledger",
  clientUserId: "owner",
  language: "en" as const,
  linkCustomizationName: "personal-ledger-account-select",
  webhookUrl: "https://sync.example.invalid/webhooks/plaid",
};

describe("Plaid HTTP adapter", () => {
  it("creates an initial Link token through the sandbox endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        expiration: "2026-07-15T12:30:00Z",
        link_token: "link-sandbox-token",
        request_id: "plaid-request-id",
      }),
    );
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(client.createInitialLinkToken(LINK_INPUT)).resolves.toEqual({
      expiresAt: "2026-07-15T12:30:00Z",
      linkToken: "link-sandbox-token",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://sandbox.plaid.com/link/token/create");
    expect(init).toMatchObject({ method: "POST" });
    expect(new Headers(init?.headers).get("PLAID-CLIENT-ID")).toBe("client-id-private");
    expect(new Headers(init?.headers).get("PLAID-SECRET")).toBe("secret-private");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toStrictEqual({
      account_filters: {
        credit: { account_subtypes: ["credit card"] },
        depository: { account_subtypes: ["checking"] },
      },
      client_name: "Personal Ledger",
      country_codes: ["CA"],
      language: "en",
      link_customization_name: "personal-ledger-account-select",
      products: ["transactions"],
      transactions: { days_requested: 730 },
      user: { client_user_id: "owner" },
      webhook: "https://sync.example.invalid/webhooks/plaid",
    });
  });

  it("uses the production allowlisted origin when configured", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        expiration: "2026-07-15T12:30:00Z",
        link_token: "link-production-token",
        request_id: "plaid-request-id",
      }),
    );
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "production",
      fetcher,
      secret: "secret-private",
    });

    await client.createInitialLinkToken(LINK_INPUT);

    expect(fetcher.mock.calls[0]?.[0]).toBe("https://production.plaid.com/link/token/create");
  });

  it("creates an account-selection update Link token without exchanging the Item", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        expiration: "2026-07-15T12:30:00Z",
        link_token: "link-update-token",
        request_id: "plaid-request-id",
      }),
    );
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(
      client.createUpdateLinkToken({
        ...LINK_INPUT,
        accessToken: "access-sandbox-private-token",
        reason: "ACCOUNT_SELECTION",
      }),
    ).resolves.toEqual({
      expiresAt: "2026-07-15T12:30:00Z",
      linkToken: "link-update-token",
    });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://sandbox.plaid.com/link/token/create");
    const body: unknown = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      access_token: "access-sandbox-private-token",
      update: { account_selection_enabled: true },
    });
    expect(body).not.toHaveProperty("products");
    expect(body).not.toHaveProperty("transactions");
  });

  it("exchanges a public token without putting Plaid credentials in the body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "access-sandbox-private-token",
        item_id: "item-rbc-1",
        request_id: "plaid-request-id",
      }),
    );
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(client.exchangePublicToken("public-sandbox-token")).resolves.toEqual({
      accessToken: "access-sandbox-private-token",
      itemId: "item-rbc-1",
    });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://sandbox.plaid.com/item/public_token/exchange");
    expect(JSON.parse(init?.body as string)).toEqual({ public_token: "public-sandbox-token" });
    expect(init?.body).not.toContain("client-id-private");
    expect(init?.body).not.toContain("secret-private");
  });

  it("loads Item identity and account metadata with the access token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        accounts: [
          {
            account_id: "plaid-account-checking-1",
            balances: { iso_currency_code: "CAD" },
            mask: "1234",
            name: "Day to Day Banking",
            subtype: "checking",
            type: "depository",
          },
          {
            account_id: "plaid-account-savings-1",
            balances: { iso_currency_code: "CAD" },
            mask: "5678",
            name: "Savings",
            subtype: "savings",
            type: "depository",
          },
        ],
        item: {
          institution_id: "ins-rbc",
          institution_name: "Royal Bank of Canada",
          item_id: "item-rbc-1",
        },
        request_id: "plaid-request-id",
      }),
    );
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(client.getItemAccounts("access-sandbox-private-token")).resolves.toEqual({
      accounts: [
        {
          id: "plaid-account-checking-1",
          isoCurrencyCode: "CAD",
          mask: "1234",
          name: "Day to Day Banking",
          subtype: "checking",
          type: "depository",
        },
        {
          id: "plaid-account-savings-1",
          isoCurrencyCode: "CAD",
          mask: "5678",
          name: "Savings",
          subtype: "savings",
          type: "depository",
        },
      ],
      institutionId: "ins-rbc",
      institutionName: "Royal Bank of Canada",
      itemId: "item-rbc-1",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://sandbox.plaid.com/accounts/get");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      access_token: "access-sandbox-private-token",
    });
  });

  it("loads an exact ES256 webhook verification key without credentials in the body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        key: {
          alg: "ES256",
          created_at: 1_700_000_000,
          crv: "P-256",
          expired_at: null,
          kid: "verification-key-1",
          kty: "EC",
          use: "sig",
          x: "A".repeat(43),
          y: "B".repeat(43),
        },
        request_id: "plaid-request-id",
      }),
    );
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(client.getWebhookVerificationKey("verification-key-1")).resolves.toEqual({
      createdAt: 1_700_000_000,
      expiredAt: null,
      jwk: {
        alg: "ES256",
        crv: "P-256",
        kid: "verification-key-1",
        kty: "EC",
        use: "sig",
        x: "A".repeat(43),
        y: "B".repeat(43),
      },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://sandbox.plaid.com/webhook_verification_key/get",
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      key_id: "verification-key-1",
    });
  });

  it.each([
    { keyId: "", payload: {} },
    { keyId: "verification-key-1", payload: null },
    { keyId: "verification-key-1", payload: { key: null, request_id: "request" } },
    {
      keyId: "verification-key-1",
      payload: {
        key: {
          alg: "RS256",
          created_at: 1,
          crv: "P-256",
          expired_at: null,
          kid: "verification-key-1",
          kty: "EC",
          use: "sig",
          x: "A".repeat(43),
          y: "B".repeat(43),
        },
        request_id: "request",
      },
    },
  ])(
    "rejects malformed webhook verification key input or output %#",
    async ({ keyId, payload }) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
      const client = createPlaidClient({
        clientId: "client-id-private",
        environment: "sandbox",
        fetcher,
        secret: "secret-private",
      });

      await expect(client.getWebhookVerificationKey(keyId)).rejects.toBeInstanceOf(
        PlaidAdapterError,
      );
      if (keyId.length === 0) expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("requests and allowlist-parses one transactions sync page", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        added: [
          {
            account_id: "plaid-account-1",
            amount: -123.45,
            authorized_date: "2026-07-14",
            date: "2026-07-15",
            ignored_sensitive_field: "must-not-cross-the-adapter",
            iso_currency_code: "CAD",
            merchant_name: "Fixture Employer",
            name: "Payroll",
            payment_meta: {
              payee: null,
              payer: "Fixture Employer",
              payment_method: "ACH",
              reference_number: "reference-1",
            },
            pending: false,
            pending_transaction_id: null,
            transaction_id: "plaid-transaction-1",
          },
        ],
        has_more: false,
        modified: [],
        next_cursor: "cursor-next",
        removed: [],
        request_id: "plaid-request-id",
      }),
    );
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    const result = await client.syncTransactions({
      accessToken: "access-token-private",
      cursor: null,
    });
    expect(result).toMatchObject({
      hasMore: false,
      modified: [],
      nextCursor: "cursor-next",
      removed: [],
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      accountId: "plaid-account-1",
      amount: -123.45,
      transactionId: "plaid-transaction-1",
    });
    expect(result.added[0]?.paymentMetadata.payer).toBe("Fixture Employer");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://sandbox.plaid.com/transactions/sync");
    expect(JSON.parse(init?.body as string)).toEqual({
      access_token: "access-token-private",
      count: 500,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-cross");
  });

  it("maps Plaid's pagination mutation error without exposing its response", async () => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
            error_message: "private upstream detail",
            request_id: "plaid-request-id",
          },
          { status: 400 },
        ),
      ),
      secret: "secret-private",
    });

    const operation = client.syncTransactions({
      accessToken: "access-token-private",
      cursor: "cursor-previous",
    });

    await expect(operation).rejects.toEqual(
      new PlaidAdapterError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"),
    );
    await expect(operation).rejects.not.toThrow(/private upstream detail/);
  });

  it("maps ITEM_LOGIN_REQUIRED to the stable update-mode signal", async () => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error_code: "ITEM_LOGIN_REQUIRED",
            error_message: "private upstream detail",
            error_type: "ITEM_ERROR",
            request_id: "plaid-request-id",
          },
          { status: 400 },
        ),
      ),
      secret: "secret-private",
    });

    const operation = client.syncTransactions({
      accessToken: "access-token-private",
      cursor: "cursor-previous",
    });

    await expect(operation).rejects.toEqual(new PlaidAdapterError("ITEM_LOGIN_REQUIRED"));
    await expect(operation).rejects.not.toThrow(/private upstream detail/);
  });

  it.each([
    { accessToken: "", cursor: null },
    { accessToken: "access-token-private", cursor: "" },
    { accessToken: "access-token-private", cursor: "x".repeat(257) },
  ])("rejects invalid transactions sync input before fetching", async (input) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(client.syncTransactions(input)).rejects.toEqual(
      new PlaidAdapterError("INVALID_CONFIGURATION"),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    Response.json(
      { error_code: "ANOTHER_ERROR", error_message: "private detail" },
      { status: 400 },
    ),
    Response.json({ added: [], request_id: "malformed-page" }),
  ])("sanitizes non-restartable sync failures", async (response) => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
      secret: "secret-private",
    });

    await expect(
      client.syncTransactions({ accessToken: "access-token-private", cursor: null }),
    ).rejects.toEqual(new PlaidAdapterError("UPSTREAM_UNAVAILABLE"));
  });

  it.each([
    new Response("private upstream failure", { status: 500 }),
    Response.json({ link_token: "missing-expiration", request_id: "request" }),
  ])("maps upstream failures to a sanitized stable error", async (upstreamResponse) => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse),
      secret: "secret-private",
    });

    const operation = client.createInitialLinkToken(LINK_INPUT);

    await expect(operation).rejects.toEqual(new PlaidAdapterError("UPSTREAM_UNAVAILABLE"));
    await expect(operation).rejects.not.toThrow(/private|client-id|secret|missing-expiration/);
  });

  it.each([
    { clientId: "", environment: "sandbox" as const, secret: "secret-private" },
    { clientId: "client-id-private", environment: "sandbox" as const, secret: "" },
    {
      clientId: "client-id-private",
      environment: "development" as "sandbox",
      secret: "secret-private",
    },
  ])("rejects invalid client configuration", (config) => {
    expect(() => createPlaidClient(config)).toThrow(new PlaidAdapterError("INVALID_CONFIGURATION"));
  });

  it("rejects invalid operation inputs before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(client.createInitialLinkToken({ ...LINK_INPUT, clientName: "" })).rejects.toEqual(
      new PlaidAdapterError("INVALID_CONFIGURATION"),
    );
    await expect(
      client.createInitialLinkToken({ ...LINK_INPUT, webhookUrl: "not-a-url" }),
    ).rejects.toEqual(new PlaidAdapterError("INVALID_CONFIGURATION"));
    await expect(client.exchangePublicToken("")).rejects.toEqual(
      new PlaidAdapterError("INVALID_CONFIGURATION"),
    );
    await expect(client.getItemAccounts("")).rejects.toEqual(
      new PlaidAdapterError("INVALID_CONFIGURATION"),
    );
    await expect(
      client.createUpdateLinkToken({
        ...LINK_INPUT,
        accessToken: "",
        reason: "LOGIN_REQUIRED",
      }),
    ).rejects.toEqual(new PlaidAdapterError("INVALID_CONFIGURATION"));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    {
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("private network failure")),
      name: "network rejection",
    },
    {
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}", { headers: { "Content-Length": "65537" } })),
      name: "declared oversized response",
    },
    {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(65_537))),
      name: "streamed oversized response",
    },
    {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null)),
      name: "empty response",
    },
  ])("sanitizes $name", async ({ fetcher }) => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher,
      secret: "secret-private",
    });

    await expect(client.exchangePublicToken("public-sandbox-token")).rejects.toEqual(
      new PlaidAdapterError("UPSTREAM_UNAVAILABLE"),
    );
  });

  it.each([
    null,
    { access_token: "missing-item", request_id: "request" },
    { access_token: "access-token", item_id: "item-1" },
  ])("rejects malformed public-token exchange responses", async (payload) => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)),
      secret: "secret-private",
    });

    await expect(client.exchangePublicToken("public-sandbox-token")).rejects.toEqual(
      new PlaidAdapterError("UPSTREAM_UNAVAILABLE"),
    );
  });

  it.each([
    null,
    { accounts: "not-an-array", item: {}, request_id: "request" },
    {
      accounts: [null],
      item: { institution_id: null, institution_name: null, item_id: "item" },
      request_id: "request",
    },
    {
      accounts: [{ balances: null }],
      item: { institution_id: null, institution_name: null, item_id: "item" },
      request_id: "request",
    },
    {
      accounts: [
        {
          account_id: "account-1",
          balances: {},
          mask: null,
          name: "Checking",
          subtype: "checking",
          type: "depository",
        },
      ],
      item: { institution_id: null, institution_name: null, item_id: "item" },
      request_id: "request",
    },
    {
      accounts: [],
      item: { institution_id: 42, institution_name: null, item_id: "item" },
      request_id: "request",
    },
  ])("rejects malformed accounts responses", async (payload) => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)),
      secret: "secret-private",
    });

    await expect(client.getItemAccounts("access-sandbox-token")).rejects.toEqual(
      new PlaidAdapterError("UPSTREAM_UNAVAILABLE"),
    );
  });

  it("accepts nullable institution, currency, and mask fields for service-level rejection", async () => {
    const client = createPlaidClient({
      clientId: "client-id-private",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          accounts: [
            {
              account_id: "account-1",
              balances: { iso_currency_code: null },
              mask: null,
              name: "Checking",
              subtype: "checking",
              type: "depository",
            },
          ],
          item: { institution_id: null, institution_name: null, item_id: "item-1" },
          request_id: "request",
        }),
      ),
      secret: "secret-private",
    });

    await expect(client.getItemAccounts("access-sandbox-token")).resolves.toMatchObject({
      accounts: [{ isoCurrencyCode: null, mask: null }],
      institutionId: null,
      institutionName: null,
    });
  });
});
