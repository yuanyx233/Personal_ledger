import { describe, expect, it } from "vitest";

import { mapConnectionHealth } from "./connection-health";

const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("connection health mapping", () => {
  it("keeps a healthy connection healthy and exposes only stable health fields", () => {
    expect(
      mapConnectionHealth(
        {
          consentExpiresAt: "2026-08-15T12:00:00.000Z",
          lastErrorCode: null,
          lastSuccessAt: "2026-07-15T11:55:00.000Z",
          status: "HEALTHY",
        },
        NOW,
      ),
    ).toEqual({
      consentExpiresAt: "2026-08-15T12:00:00.000Z",
      consentState: "CURRENT",
      lastFailureCode: null,
      lastSuccessAt: "2026-07-15T11:55:00.000Z",
      nextActionCode: "NONE",
      status: "HEALTHY",
    });
  });

  it("maps login and account-selection provider codes to owner actions", () => {
    expect(
      mapConnectionHealth(
        {
          consentExpiresAt: null,
          lastErrorCode: "ITEM_LOGIN_REQUIRED",
          lastSuccessAt: null,
          status: "SYNCING",
        },
        NOW,
      ),
    ).toMatchObject({
      lastFailureCode: "LOGIN_REQUIRED",
      nextActionCode: "REAUTHENTICATE",
      status: "ACTION_REQUIRED",
    });

    expect(
      mapConnectionHealth(
        {
          consentExpiresAt: null,
          lastErrorCode: "ACCOUNT_SELECTION_REQUIRED",
          lastSuccessAt: null,
          status: "ACTION_REQUIRED",
        },
        NOW,
      ),
    ).toMatchObject({
      lastFailureCode: "ACCOUNT_SELECTION_REQUIRED",
      nextActionCode: "MANAGE_ACCOUNTS",
      status: "ACTION_REQUIRED",
    });
  });

  it("turns expiring consent into an actionable stable state", () => {
    expect(
      mapConnectionHealth(
        {
          consentExpiresAt: "2026-07-20T12:00:00.000Z",
          lastErrorCode: null,
          lastSuccessAt: "2026-07-15T11:55:00.000Z",
          status: "HEALTHY",
        },
        NOW,
      ),
    ).toMatchObject({
      consentState: "EXPIRING_SOON",
      lastFailureCode: "CONSENT_REQUIRED",
      nextActionCode: "RENEW_CONSENT",
      status: "ACTION_REQUIRED",
    });
  });

  it("sanitizes unknown upstream failures", () => {
    const result = mapConnectionHealth(
      {
        consentExpiresAt: null,
        lastErrorCode: "PRIVATE_PROVIDER_DETAIL account-123",
        lastSuccessAt: null,
        status: "ERROR",
      },
      NOW,
    );

    expect(result).toMatchObject({
      consentState: "NOT_REQUIRED",
      lastFailureCode: "SYNC_FAILED",
      nextActionCode: "RETRY_SYNC",
      status: "ERROR",
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_DETAIL");
    expect(JSON.stringify(result)).not.toContain("account-123");
  });
});
