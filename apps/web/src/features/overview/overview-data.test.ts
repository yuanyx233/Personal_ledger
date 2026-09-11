import { describe, expect, it } from "vitest";
import { currentPeriod } from "../analysis/analysis-period";

describe("overview report month", () => {
  it("uses the Toronto calendar month for both cash flow and spending", () => {
    expect(currentPeriod("MONTH", new Date("2026-07-17T12:00:00.000Z"))).toBe("2026-07");
    expect(currentPeriod("MONTH", new Date("2026-01-01T02:00:00.000Z"))).toBe("2025-12");
  });
});
