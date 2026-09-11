import { describe, expect, it } from "vitest";

import {
  NETWORK_ONLY,
  SHELL_NETWORK_FIRST,
  STATIC_NETWORK_FIRST,
  isCacheableStaticResponse,
  serviceWorkerRequestStrategy,
} from "../public/service-worker-policy.js";

function request(
  path: string,
  overrides: Partial<{ destination: string; method: string; mode: string }> = {},
) {
  return {
    destination: overrides.destination ?? "",
    method: overrides.method ?? "GET",
    mode: overrides.mode ?? "cors",
    url: new URL(path, "https://ledger.example").toString(),
  };
}

describe("service worker cache policy", () => {
  it("keeps APIs, exports, writes, and cross-origin requests network-only", () => {
    for (const candidate of [
      request("/api/v1/transactions"),
      request("/api/v1/exports/full.json"),
      request("/exports/transactions.csv"),
      request("/api/v1/transactions", { method: "POST" }),
      { ...request("/asset.js"), url: "https://cdn.example/asset.js" },
    ]) {
      expect(serviceWorkerRequestStrategy(candidate, "https://ledger.example")).toBe(NETWORK_ONLY);
    }
  });

  it("allows only navigations and versioned static assets into cache strategies", () => {
    expect(
      serviceWorkerRequestStrategy(
        request("/transactions", { destination: "document", mode: "navigate" }),
        "https://ledger.example",
      ),
    ).toBe(SHELL_NETWORK_FIRST);
    expect(
      serviceWorkerRequestStrategy(
        request("/assets/index-DA8AVFnj.js", { destination: "script" }),
        "https://ledger.example",
      ),
    ).toBe(STATIC_NETWORK_FIRST);
    expect(
      serviceWorkerRequestStrategy(
        request("/assets/index.js", { destination: "script" }),
        "https://ledger.example",
      ),
    ).toBe(NETWORK_ONLY);
  });

  it("never stores failed or explicitly non-cacheable responses", () => {
    expect(isCacheableStaticResponse(new Response("ok"))).toBe(true);
    expect(
      isCacheableStaticResponse(
        new Response("private", { headers: { "Cache-Control": "private, no-store" } }),
      ),
    ).toBe(false);
    expect(isCacheableStaticResponse(new Response("failed", { status: 503 }))).toBe(false);
  });
});
