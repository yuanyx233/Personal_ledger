import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createSyncWorker } from "../src/index";

describe("sync Worker scaffold", () => {
  it("returns 404 for every path outside the Plaid webhook", async () => {
    const response = await exports.default.fetch("https://sync.example/unknown");

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
  });

  it("fails closed while Plaid webhook verification is unfinished", async () => {
    const response = await exports.default.fetch("https://sync.example/webhooks/plaid", {
      method: "POST",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SYNC_NOT_READY",
        message: "Webhook intake is not available yet.",
      },
    });
  });

  it("returns stable 429 responses from the dedicated webhook limiter", async () => {
    const worker = createSyncWorker();
    const response = await worker.fetch(
      new Request("https://sync.example/webhooks/plaid", { method: "POST" }),
      {
        WEBHOOK_RATE_LIMITER: { limit: () => Promise.resolve({ success: false }) },
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests." },
    });
  });

  it("returns a stable 413 before buffering an oversized webhook", async () => {
    const worker = createSyncWorker();
    const response = await worker.fetch(
      new Request("https://sync.example/webhooks/plaid", {
        body: "x".repeat(256 * 1024 + 1),
        method: "POST",
      }),
      {
        WEBHOOK_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
      },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large." },
    });
  });
});
