import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "**/*.test.ts",
        "packages/persistence/src/connection-creation.ts",
        "packages/persistence/src/subscriptions.ts",
      ],
      include: ["packages/domain/src/**/*.ts", "packages/persistence/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/unit",
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    // The browser bundle now requires this value. Tests default to the owner's zone
    // and can be re-run under another to prove nothing depends on that default.
    env: { VITE_APP_TIMEZONE: process.env.VITE_APP_TIMEZONE ?? "America/Toronto" },
    include: [
      "apps/web/src/**/*.test.{ts,tsx}",
      "packages/domain/src/**/*.test.ts",
      "packages/persistence/src/**/*.test.ts",
      "tests/config/**/*.test.ts",
    ],
  },
});
