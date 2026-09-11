import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

// Run integration tests inside workerd rather than a Node.js approximation.
// Source: https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker/index.ts",
      miniflare: {
        bindings: {
          ACCESS_AUD: "test-access-audience",
          ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
          CSRF_HMAC_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
          OWNER_EMAIL: "owner@example.invalid",
          TEST_MIGRATIONS: migrations,
        },
        compatibilityDate: "2026-07-15",
        d1Databases: ["DB"],
        serviceBindings: {
          ASSETS() {
            return new Response("workspace asset");
          },
        },
      },
    }),
  ],
  test: {
    coverage: {
      exclude: ["**/*.spec.ts"],
      include: ["worker/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      reportsDirectory: "../../coverage/app-worker",
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
