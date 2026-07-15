import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          APP_TIMEZONE: "America/Toronto",
          PLAID_CLIENT_ID: "test-client-id",
          PLAID_ENV: "sandbox",
          PLAID_SECRET: "test-client-secret",
          PLAID_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          SCHEDULED_SYNC_MAX_ITEMS: "2",
          SCHEDULED_SYNC_MAX_PAGES: "20",
          SCHEDULED_SYNC_MAX_RUNTIME_MS: "20000",
          SYNC_STALE_AFTER_MINUTES: "60",
          TEST_MIGRATIONS: migrations,
        },
        d1Databases: ["DB"],
      },
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  ],
  test: {
    coverage: {
      exclude: ["**/*.spec.ts"],
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      reportsDirectory: "../../coverage/sync-worker",
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    include: ["test/**/*.spec.ts"],
  },
});
