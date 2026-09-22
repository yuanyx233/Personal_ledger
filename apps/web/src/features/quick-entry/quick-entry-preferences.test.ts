import { describe, expect, it } from "vitest";

import { DEFAULT_QUICK_ENTRY_ACCOUNT, ledgerCalendarDate } from "./quick-entry-preferences";

describe("quick-entry defaults", () => {
  it("always starts each entry with RBC Credit", () => {
    expect(DEFAULT_QUICK_ENTRY_ACCOUNT).toBe("RBC Credit");
  });

  it("uses the Toronto calendar day at the UTC date boundary", () => {
    expect(ledgerCalendarDate(new Date("2026-09-01T02:30:00.000Z"), "America/Toronto")).toBe(
      "2026-08-31",
    );
    expect(ledgerCalendarDate(new Date("2026-09-01T04:30:00.000Z"), "America/Toronto")).toBe(
      "2026-09-01",
    );
  });

  it("follows the configured zone instead of a built-in one", () => {
    const instant = new Date("2026-09-01T02:30:00.000Z");
    expect(ledgerCalendarDate(instant, "America/Toronto")).toBe("2026-08-31");
    expect(ledgerCalendarDate(instant, "Europe/Berlin")).toBe("2026-09-01");
    expect(ledgerCalendarDate(instant, "UTC")).toBe("2026-09-01");
  });
});
