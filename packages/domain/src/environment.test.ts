import { describe, expect, it } from "vitest";

import {
  APP_WORKER_SECRET_NAMES,
  SYNC_WORKER_SECRET_NAMES,
  appWorkerEnvSchema,
  publicClientEnvSchema,
  syncWorkerEnvSchema,
} from "./environment";

const fakeSharedSecrets = {
  PLAID_CLIENT_ID: "test-client-id",
  PLAID_SECRET: "test-client-secret",
  PLAID_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};

const fakeSyncLimits = {
  SCHEDULED_SYNC_MAX_ITEMS: "2",
  SCHEDULED_SYNC_MAX_PAGES: "20",
  SCHEDULED_SYNC_MAX_RUNTIME_MS: "20000",
  SYNC_STALE_AFTER_MINUTES: "60",
};

describe("environment boundaries", () => {
  it("accepts only the checked-in public client configuration", () => {
    expect(
      publicClientEnvSchema.parse({
        VITE_API_BASE_PATH: "/api/v1",
        VITE_APP_TIMEZONE: "America/Toronto",
      }),
    ).toEqual({
      VITE_API_BASE_PATH: "/api/v1",
      VITE_APP_TIMEZONE: "America/Toronto",
    });

    expect(
      publicClientEnvSchema.safeParse({
        VITE_API_BASE_PATH: "/api/v1",
        VITE_APP_TIMEZONE: "America/Toronto",
        VITE_PLAID_SECRET: "must-never-reach-the-browser",
      }).success,
    ).toBe(false);
  });

  it("validates the protected app Worker configuration", () => {
    expect(
      appWorkerEnvSchema.safeParse({
        ...fakeSharedSecrets,
        ACCESS_AUD: "test-access-audience",
        ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
        APP_TIMEZONE: "America/Toronto",
        CSRF_HMAC_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        OWNER_EMAIL: "owner@example.invalid",
        PLAID_BMO_INSTITUTION_ID: "ins_100002",
        PLAID_ENV: "sandbox",
        PLAID_LINK_CUSTOMIZATION_NAME: "personal-ledger-account-select",
        PLAID_RBC_INSTITUTION_ID: "ins_100001",
        PLAID_WEBHOOK_URL: "https://sync.example.invalid/webhooks/plaid",
      }).success,
    ).toBe(true);
  });

  it("validates the public sync Worker configuration", () => {
    expect(
      syncWorkerEnvSchema.safeParse({
        ...fakeSharedSecrets,
        ...fakeSyncLimits,
        APP_TIMEZONE: "America/Toronto",
        PLAID_ENV: "sandbox",
      }).success,
    ).toBe(true);
  });

  it("rejects unfilled secret placeholders", () => {
    expect(
      syncWorkerEnvSchema.safeParse({
        ...fakeSharedSecrets,
        ...fakeSyncLimits,
        APP_TIMEZONE: "America/Toronto",
        PLAID_ENV: "sandbox",
        PLAID_SECRET: "REPLACE_ME_PLAID_SECRET",
      }).success,
    ).toBe(false);
  });

  it("normalizes bounded public scheduled-sync work caps", () => {
    expect(
      syncWorkerEnvSchema.parse({
        ...fakeSharedSecrets,
        ...fakeSyncLimits,
        APP_TIMEZONE: "America/Toronto",
        PLAID_ENV: "sandbox",
      }),
    ).toMatchObject({
      SCHEDULED_SYNC_MAX_ITEMS: 2,
      SCHEDULED_SYNC_MAX_PAGES: 20,
      SCHEDULED_SYNC_MAX_RUNTIME_MS: 20_000,
      SYNC_STALE_AFTER_MINUTES: 60,
    });
    expect(
      syncWorkerEnvSchema.safeParse({
        ...fakeSharedSecrets,
        ...fakeSyncLimits,
        APP_TIMEZONE: "America/Toronto",
        PLAID_ENV: "sandbox",
        SYNC_STALE_AFTER_MINUTES: "59",
      }).success,
    ).toBe(false);
    expect(
      syncWorkerEnvSchema.safeParse({
        ...fakeSharedSecrets,
        ...fakeSyncLimits,
        APP_TIMEZONE: "America/Toronto",
        PLAID_ENV: "sandbox",
        SCHEDULED_SYNC_MAX_ITEMS: "3",
      }).success,
    ).toBe(false);
  });

  it("exports stable required-secret names for both Worker boundaries", () => {
    expect(APP_WORKER_SECRET_NAMES).toEqual([
      "ACCESS_AUD",
      "ACCESS_TEAM_DOMAIN",
      "CSRF_HMAC_KEY",
      "OWNER_EMAIL",
      "PLAID_CLIENT_ID",
      "PLAID_SECRET",
      "PLAID_TOKEN_ENCRYPTION_KEY",
    ]);
    expect(SYNC_WORKER_SECRET_NAMES).toEqual([
      "PLAID_CLIENT_ID",
      "PLAID_SECRET",
      "PLAID_TOKEN_ENCRYPTION_KEY",
    ]);
  });
});
