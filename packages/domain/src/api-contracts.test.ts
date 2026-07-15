import { describe, expect, it } from "vitest";
import * as z from "zod";

import {
  API_ERROR_STATUS,
  accountEnabledUpdateRequestSchema,
  accountUpdateResponseSchema,
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
  calendarDateSchema,
  cursorPaginationMetaSchema,
  cursorPaginationQuerySchema,
  currencyCodeSchema,
  connectionCreationResponseSchema,
  connectionsResponseSchema,
  idempotencyKeySchema,
  linkTokenRequestSchema,
  linkTokenResponseSchema,
  publicTokenExchangeRequestSchema,
  moneySchema,
  optimisticVersionSchema,
  sessionResponseSchema,
} from "./api-contracts";

describe("API envelope contracts", () => {
  it("uses one strict success envelope", () => {
    const schema = apiSuccessEnvelopeSchema(z.array(z.string()), cursorPaginationMetaSchema);

    expect(
      schema.parse({
        data: ["transaction-1"],
        meta: { hasMore: false, nextCursor: null },
      }),
    ).toEqual({
      data: ["transaction-1"],
      meta: { hasMore: false, nextCursor: null },
    });
    expect(
      schema.safeParse({
        data: [],
        meta: { hasMore: false, nextCursor: null },
        status: "ok",
      }).success,
    ).toBe(false);
  });

  it("defines the protected session bootstrap response", () => {
    const response = {
      data: {
        csrfToken: "cGF5bG9hZA.c2lnbmF0dXJl",
        identity: { email: "owner@example.invalid" },
        timezone: "America/Toronto",
      },
      meta: {},
    };

    expect(sessionResponseSchema.parse(response)).toEqual(response);
    expect(
      sessionResponseSchema.safeParse({
        ...response,
        data: { ...response.data, csrfToken: "not-a-signed-token" },
      }).success,
    ).toBe(false);
  });

  it("defines the short-lived Link-token response without Plaid credentials", () => {
    const response = {
      data: {
        expiresAt: "2026-07-15T12:30:00Z",
        linkToken: "link-sandbox-token",
      },
      meta: {},
    };

    expect(linkTokenResponseSchema.parse(response)).toEqual(response);
    expect(
      linkTokenResponseSchema.safeParse({
        ...response,
        data: { ...response.data, secret: "must-not-leak" },
      }).success,
    ).toBe(false);
  });

  it("uses explicit initial and update Link-token request variants", () => {
    expect(linkTokenRequestSchema.parse({ institutionCode: "RBC", mode: "INITIAL" })).toEqual({
      institutionCode: "RBC",
      mode: "INITIAL",
    });
    expect(
      linkTokenRequestSchema.parse({
        connectionId: "connection-1",
        mode: "UPDATE",
        reason: "ACCOUNT_SELECTION",
      }),
    ).toEqual({
      connectionId: "connection-1",
      mode: "UPDATE",
      reason: "ACCOUNT_SELECTION",
    });
    expect(
      linkTokenRequestSchema.safeParse({
        connectionId: "connection-1",
        mode: "UPDATE",
        publicToken: "must-not-be-exchanged",
        reason: "LOGIN_REQUIRED",
      }).success,
    ).toBe(false);
  });

  it("keeps public-token exchange input strict and its response token-free", () => {
    expect(publicTokenExchangeRequestSchema.parse({ publicToken: "public-sandbox-token" })).toEqual(
      { publicToken: "public-sandbox-token" },
    );
    expect(
      publicTokenExchangeRequestSchema.safeParse({
        products: ["auth"],
        publicToken: "public-sandbox-token",
      }).success,
    ).toBe(false);

    const response = {
      data: {
        connection: {
          accounts: [
            {
              currency: "CAD",
              displayName: "Daily Chequing",
              enabled: true,
              id: "account-1",
              subtype: "CHECKING",
              type: "DEPOSITORY",
            },
          ],
          id: "connection-1",
          institutionCode: "RBC",
          institutionName: "Royal Bank of Canada",
          status: "HEALTHY",
        },
      },
      meta: { replayed: false },
    };
    expect(connectionCreationResponseSchema.parse(response)).toEqual(response);
    expect(
      connectionCreationResponseSchema.safeParse({
        ...response,
        data: {
          ...response.data,
          accessToken: "must-not-leak",
        },
      }).success,
    ).toBe(false);
  });

  it("uses stable sanitized error codes and field errors", () => {
    expect(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: "VERSION_CONFLICT",
          currentVersion: 7,
          fieldErrors: { version: ["The record changed on another device."] },
          message: "Refresh and try again.",
        },
      }),
    ).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        currentVersion: 7,
        fieldErrors: { version: ["The record changed on another device."] },
        message: "Refresh and try again.",
      },
    });
    expect(API_ERROR_STATUS.VERSION_CONFLICT).toBe(409);
    expect(
      apiErrorEnvelopeSchema.safeParse({
        error: {
          code: "DATABASE_EXCEPTION",
          details: "SQLITE_CONSTRAINT at repository.ts:42",
          message: "Internal failure",
        },
      }).success,
    ).toBe(false);
    expect(
      apiErrorEnvelopeSchema.safeParse({
        error: {
          code: "VERSION_CONFLICT",
          currentVersion: 0,
          message: "Refresh and try again.",
        },
      }).success,
    ).toBe(false);
  });
});

describe("pagination and concurrency contracts", () => {
  it("parses bounded cursor pagination query values", () => {
    expect(cursorPaginationQuerySchema.parse({ pageSize: "25" })).toEqual({ pageSize: 25 });
    expect(cursorPaginationQuerySchema.parse({})).toEqual({ pageSize: 50 });
    expect(cursorPaginationQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(cursorPaginationQuerySchema.safeParse({ cursor: "not+base64" }).success).toBe(false);
  });

  it("keeps hasMore and nextCursor consistent", () => {
    expect(
      cursorPaginationMetaSchema.safeParse({ hasMore: true, nextCursor: "bmV4dA" }).success,
    ).toBe(true);
    expect(cursorPaginationMetaSchema.safeParse({ hasMore: true, nextCursor: null }).success).toBe(
      false,
    );
    expect(
      cursorPaginationMetaSchema.safeParse({ hasMore: false, nextCursor: "bmV4dA" }).success,
    ).toBe(false);
  });

  it("accepts bounded idempotency keys and positive optimistic versions", () => {
    expect(idempotencyKeySchema.parse("request-20260715-0001")).toBe("request-20260715-0001");
    expect(idempotencyKeySchema.safeParse("too-short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("request key with spaces").success).toBe(false);

    expect(optimisticVersionSchema.parse(1)).toBe(1);
    expect(optimisticVersionSchema.safeParse(0).success).toBe(false);
    expect(optimisticVersionSchema.safeParse(1.5).success).toBe(false);
    expect(optimisticVersionSchema.safeParse("1").success).toBe(false);
  });

  it("keeps account enablement optimistic and the connection read model secret-free", () => {
    expect(accountEnabledUpdateRequestSchema.parse({ enabled: false, version: 2 })).toEqual({
      enabled: false,
      version: 2,
    });
    expect(
      accountEnabledUpdateRequestSchema.safeParse({
        enabled: true,
        subtype: "SAVINGS",
        version: 2,
      }).success,
    ).toBe(false);

    const account = {
      currency: "CAD",
      displayName: "Daily Chequing",
      enabled: true,
      id: "account-1",
      mask: "1234",
      subtype: "CHECKING",
      type: "DEPOSITORY",
      version: 1,
    } as const;
    expect(
      connectionsResponseSchema.parse({
        data: {
          connections: [
            {
              accounts: [account],
              consentExpiresAt: null,
              consentState: "NOT_REQUIRED",
              id: "connection-1",
              institutionCode: "RBC",
              institutionName: "Royal Bank of Canada",
              lastFailureCode: null,
              lastSuccessAt: null,
              nextActionCode: "NONE",
              status: "HEALTHY",
              version: 1,
            },
          ],
        },
        meta: {},
      }),
    ).toMatchObject({ data: { connections: [{ accounts: [account] }] } });
    expect(accountUpdateResponseSchema.parse({ data: { account }, meta: {} })).toEqual({
      data: { account },
      meta: {},
    });
  });
});

describe("ledger primitive contracts", () => {
  it("represents exact money without floating point or implicit sign", () => {
    expect(
      moneySchema.parse({ amountMinor: 12345, currency: "CAD", direction: "OUTFLOW" }),
    ).toEqual({ amountMinor: 12345, currency: "CAD", direction: "OUTFLOW" });
    expect(
      moneySchema.safeParse({ amountMinor: 12.34, currency: "CAD", direction: "OUTFLOW" }).success,
    ).toBe(false);
    expect(
      moneySchema.safeParse({ amountMinor: -1, currency: "CAD", direction: "OUTFLOW" }).success,
    ).toBe(false);
  });

  it("accepts only uppercase three-letter currency codes", () => {
    expect(currencyCodeSchema.parse("USD")).toBe("USD");
    expect(currencyCodeSchema.safeParse("cad").success).toBe(false);
    expect(currencyCodeSchema.safeParse("USDT").success).toBe(false);
  });

  it("accepts real ISO calendar dates only", () => {
    expect(calendarDateSchema.parse("2024-02-29")).toBe("2024-02-29");
    expect(calendarDateSchema.safeParse("2025-02-29").success).toBe(false);
    expect(calendarDateSchema.safeParse("2025-2-01").success).toBe(false);
  });
});
