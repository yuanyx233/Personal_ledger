import { describe, expect, it } from "vitest";

import { DEFAULT_QUICK_ENTRY_ACCOUNT, torontoCalendarDate } from "./quick-entry-preferences";

describe("quick-entry defaults", () => {
  it("always starts each entry with RBC Credit", () => {
    expect(DEFAULT_QUICK_ENTRY_ACCOUNT).toBe("RBC Credit");
  });

  it("uses the Toronto calendar day at the UTC date boundary", () => {
    expect(torontoCalendarDate(new Date("2026-09-01T02:30:00.000Z"))).toBe("2026-08-31");
    expect(torontoCalendarDate(new Date("2026-09-01T04:30:00.000Z"))).toBe("2026-09-01");
  });
});
