import { describe, expect, it } from "vitest";
import { APP_WORKER_SECRET_NAMES, appWorkerEnvSchema, publicClientEnvSchema } from "./environment";

describe("environment boundaries", () => {
  const configuration = {
    ACCESS_AUD: "test-access-audience",
    ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    APP_TIMEZONE: "America/Toronto",
    CSRF_HMAC_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    OWNER_EMAIL: "owner@example.invalid",
  };
  it("accepts the single protected app without banking credentials", () => {
    expect(appWorkerEnvSchema.safeParse(configuration).success).toBe(true);
    expect(APP_WORKER_SECRET_NAMES).toEqual([
      "ACCESS_AUD",
      "ACCESS_TEAM_DOMAIN",
      "CSRF_HMAC_KEY",
      "OWNER_EMAIL",
    ]);
  });
  it("rejects placeholders and invalid access configuration", () => {
    expect(
      appWorkerEnvSchema.safeParse({ ...configuration, CSRF_HMAC_KEY: "REPLACE_ME_KEY" }).success,
    ).toBe(false);
    expect(
      appWorkerEnvSchema.safeParse({
        ...configuration,
        ACCESS_TEAM_DOMAIN: "http://untrusted.invalid",
      }).success,
    ).toBe(false);
  });
  it("accepts any named IANA zone so the ledger can be deployed outside Toronto", () => {
    expect(
      appWorkerEnvSchema.parse({ ...configuration, APP_TIMEZONE: "Europe/Berlin" }).APP_TIMEZONE,
    ).toBe("Europe/Berlin");
    expect(
      publicClientEnvSchema.parse({
        VITE_API_BASE_PATH: "/api/v1",
        VITE_APP_TIMEZONE: "Asia/Shanghai",
      }).VITE_APP_TIMEZONE,
    ).toBe("Asia/Shanghai");
  });

  it("fails loudly instead of falling back when the configured zone is unusable", () => {
    for (const APP_TIMEZONE of ["", "Not/AZone", "+05:00"]) {
      expect(appWorkerEnvSchema.safeParse({ ...configuration, APP_TIMEZONE }).success).toBe(false);
    }
    expect(
      publicClientEnvSchema.safeParse({ VITE_API_BASE_PATH: "/api/v1", VITE_APP_TIMEZONE: "" })
        .success,
    ).toBe(false);
  });

  it("canonicalises the configured zone so both halves compare equal", () => {
    expect(
      appWorkerEnvSchema.parse({ ...configuration, APP_TIMEZONE: "america/toronto" }).APP_TIMEZONE,
    ).toBe("America/Toronto");
  });

  it("keeps browser configuration public and strict", () => {
    const values = { VITE_API_BASE_PATH: "/api/v1", VITE_APP_TIMEZONE: "America/Toronto" };
    expect(publicClientEnvSchema.parse(values)).toEqual(values);
    expect(
      publicClientEnvSchema.safeParse({ ...values, VITE_PLAID_SECRET: "not-public" }).success,
    ).toBe(false);
  });
});
