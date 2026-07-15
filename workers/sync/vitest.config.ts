import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          PLAID_CLIENT_ID: "test-client-id",
          PLAID_SECRET: "test-client-secret",
          PLAID_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
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
