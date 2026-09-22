import { describe, expect, it } from "vitest";

import {
  currentPeriod,
  parseAnalysisQuery,
  shiftedAnalysisQuery,
  trendPeriodInputs,
} from "./analysis-period";

describe("analysis period navigation", () => {
  it("uses the Toronto calendar at UTC day boundaries", () => {
    const now = new Date("2026-01-01T02:00:00.000Z");
    expect(currentPeriod("MONTH", now)).toBe("2025-12");
    expect(currentPeriod("QUARTER", now)).toBe("2025-Q4");
    expect(currentPeriod("YEAR", now)).toBe("2025");
  });

  it("follows the configured zone instead of a built-in one", () => {
    const now = new Date("2026-01-01T02:00:00.000Z");
    expect(currentPeriod("MONTH", now, "America/Toronto")).toBe("2025-12");
    expect(currentPeriod("MONTH", now, "Europe/Berlin")).toBe("2026-01");
    expect(currentPeriod("YEAR", now, "Europe/Berlin")).toBe("2026");
    expect(currentPeriod("QUARTER", now, "Europe/Berlin")).toBe("2026-Q1");
  });

  it("safely falls back from invalid or overlong custom ranges", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    expect(parseAnalysisQuery("?grain=MONTH&period=not-a-month", now)).toEqual({
      grain: "MONTH",
      period: "2026-07",
    });
    expect(parseAnalysisQuery("?grain=CUSTOM&dateFrom=2020-01-01&dateTo=2026-01-01", now)).toEqual({
      grain: "MONTH",
      period: "2026-07",
    });
  });

  it("navigates natural periods across calendar boundaries", () => {
    expect(shiftedAnalysisQuery({ grain: "MONTH", period: "2026-01" }, -1)).toEqual({
      grain: "MONTH",
      period: "2025-12",
    });
    expect(shiftedAnalysisQuery({ grain: "QUARTER", period: "2026-Q1" }, -1)).toEqual({
      grain: "QUARTER",
      period: "2025-Q4",
    });
    expect(shiftedAnalysisQuery({ grain: "YEAR", period: "2026" }, 1)).toEqual({
      grain: "YEAR",
      period: "2027",
    });
  });

  it("requests six paired month reports to reconstruct a twelve-month year trend", () => {
    expect(trendPeriodInputs({ grain: "YEAR", period: "2026" })).toEqual(
      [2, 4, 6, 8, 10, 12].map((month) => ({
        grain: "MONTH",
        period: `2026-${String(month).padStart(2, "0")}`,
      })),
    );
  });
});
