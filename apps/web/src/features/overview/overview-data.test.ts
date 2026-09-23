import { describe, expect, it } from "vitest";
import { currentPeriod } from "../analysis/analysis-period";
import { formatMoney } from "./overview-data";

describe("overview report month", () => {
  it("uses the Toronto calendar month for both cash flow and spending", () => {
    const toronto = "America/Toronto";
    expect(currentPeriod("MONTH", new Date("2026-07-17T12:00:00.000Z"), toronto)).toBe("2026-07");
    expect(currentPeriod("MONTH", new Date("2026-01-01T02:00:00.000Z"), toronto)).toBe("2025-12");
  });
});

describe("money display", () => {
  it("shows the stored hundredths for every accepted currency", () => {
    // ICU renders HUF, IDR and COP with no decimals by local convention, but the
    // ledger stores them as hundredths, so dropping the fraction would make
    // displayed amounts fail to add up. Both minor units must always be shown.
    expect(formatMoney(1234, "CAD")).toContain("12.34");
    expect(formatMoney(1234, "EUR")).toContain("12.34");
    expect(formatMoney(1234, "HUF")).toContain("12.34");
    expect(formatMoney(1234, "IDR")).toContain("12.34");
    expect(formatMoney(1234, "COP")).toContain("12.34");
  });
});
