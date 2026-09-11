import { describe, expect, it } from "vitest";

import {
  REQUEST_LIMITS,
  RequestLimitError,
  assertImportShapeWithinLimits,
  enforceRequestLimits,
  resolveAppRequestPolicy,
} from "./request-limits";

describe("per-route request limits", () => {
  it("assigns conservative limits by stable API resource", () => {
    const importPolicy = resolveAppRequestPolicy(
      new Request("https://ledger.example/api/v1/imports/preview", { method: "POST" }),
    );
    expect(importPolicy).toMatchObject({
      bodyBytes: REQUEST_LIMITS.IMPORT_PREVIEW_BYTES,
      columnLimit: 32,
      routeId: "imports",
      rowLimit: 4_000,
    });
    expect(REQUEST_LIMITS.IMPORT_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(importPolicy.bodyBytes).toBeGreaterThan(REQUEST_LIMITS.IMPORT_FILE_BYTES);
    expect(
      resolveAppRequestPolicy(
        new Request("https://ledger.example/api/v1/imports/import-preview-fixture/commit", {
          method: "POST",
        }),
      ),
    ).toMatchObject({
      bodyBytes: REQUEST_LIMITS.IMPORT_COMMIT_BYTES,
      routeId: "imports",
    });
    expect(REQUEST_LIMITS.IMPORT_COMMIT_BYTES).toBe(512 * 1024);
    expect(
      resolveAppRequestPolicy(new Request("https://ledger.example/api/v1/transactions")),
    ).toMatchObject({
      dateRangeDays: 730,
      pageSize: 100,
      routeId: "transactions",
    });
    expect(
      resolveAppRequestPolicy(new Request("https://ledger.example/api/v1/merchant-rules")),
    ).toMatchObject({ pageSize: 100, routeId: "merchant-rules" });
    expect(
      resolveAppRequestPolicy(new Request("https://ledger.example/api/v1/review-queue")),
    ).toEqual({ routeId: "other-api" });
    expect(
      resolveAppRequestPolicy(
        new Request("https://ledger.example/api/v1/subscriptions", { method: "POST" }),
      ),
    ).toMatchObject({ bodyBytes: 65_536, routeId: "subscriptions" });
    expect(
      resolveAppRequestPolicy(new Request("https://ledger.example/api/v1/subscription-candidates")),
    ).toEqual({ routeId: "other-api" });
    expect(
      resolveAppRequestPolicy(
        new Request("https://ledger.example/api/v1/transactions", { method: "PATCH" }),
      ),
    ).toMatchObject({ bodyBytes: 65_536, routeId: "transactions" });
  });

  it("counts streamed request bytes and rejects a body above the route limit", async () => {
    const policy = { bodyBytes: 4, routeId: "test" };
    await expect(
      enforceRequestLimits(
        new Request("https://ledger.example/api/v1/test", { body: "1234", method: "POST" }),
        policy,
      ),
    ).resolves.toEqual(new TextEncoder().encode("1234"));
    await expect(
      enforceRequestLimits(
        new Request("https://ledger.example/api/v1/test", { body: "12345", method: "POST" }),
        policy,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
  });

  it("enforces page size and an inclusive 730-day date range", async () => {
    const validRequest = new Request(
      "https://ledger.example/api/v1/transactions?pageSize=100&dateFrom=2025-01-01&dateTo=2026-12-31",
    );
    await expect(
      enforceRequestLimits(validRequest, resolveAppRequestPolicy(validRequest)),
    ).resolves.toHaveLength(0);

    for (const query of [
      "pageSize=101",
      "pageSize=1.5",
      "dateFrom=2025-01-01&dateTo=2027-01-01",
      "dateFrom=2026-02-29&dateTo=2026-03-01",
      "dateFrom=2026-03-02&dateTo=2026-03-01",
    ]) {
      const request = new Request(`https://ledger.example/api/v1/transactions?${query}`);
      await expect(
        enforceRequestLimits(request, resolveAppRequestPolicy(request)),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    }
  });

  it("provides reusable import row and column guards", () => {
    const policy = resolveAppRequestPolicy(
      new Request("https://ledger.example/api/v1/imports/preview", { method: "POST" }),
    );

    expect(() => assertImportShapeWithinLimits({ columns: 32, rows: 4_000 }, policy)).not.toThrow();
    for (const shape of [
      { columns: 33, rows: 1 },
      { columns: 1, rows: 4_001 },
      { columns: 1.5, rows: 1 },
    ]) {
      expect(() => assertImportShapeWithinLimits(shape, policy)).toThrowError(RequestLimitError);
    }
  });
});
