import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["**/*.test.ts", "packages/persistence/src/connection-creation.ts"],
      include: [
        "packages/domain/src/**/*.ts",
        "packages/persistence/src/**/*.ts",
        "packages/plaid/src/**/*.ts",
      ],
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
    include: [
      "packages/domain/src/**/*.test.ts",
      "packages/persistence/src/**/*.test.ts",
      "packages/plaid/src/**/*.test.ts",
      "tests/config/**/*.test.ts",
    ],
  },
});
