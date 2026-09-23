import { defineConfig, devices } from "@playwright/test";

// Playwright starts a client-only Vite server; Worker auth has separate workerd integration tests.
// Source: https://playwright.dev/docs/test-webserver
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
  reporter: process.env.CI ? "github" : "list",
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:5173",
    // The interface follows the viewer's browser language, so the locale is pinned
    // here: otherwise these expectations would depend on the machine running them.
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:browser-test --workspace @ledger/web -- --host 127.0.0.1",
    reuseExistingServer: !process.env.CI,
    stderr: "pipe",
    stdout: "ignore",
    timeout: 60_000,
    url: "http://127.0.0.1:5173",
  },
});
