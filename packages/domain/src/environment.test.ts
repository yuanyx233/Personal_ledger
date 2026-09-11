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
  it("keeps browser configuration public and strict", () => {
    const values = { VITE_API_BASE_PATH: "/api/v1", VITE_APP_TIMEZONE: "America/Toronto" };
    expect(publicClientEnvSchema.parse(values)).toEqual(values);
    expect(
      publicClientEnvSchema.safeParse({ ...values, VITE_PLAID_SECRET: "not-public" }).success,
    ).toBe(false);
  });
});
