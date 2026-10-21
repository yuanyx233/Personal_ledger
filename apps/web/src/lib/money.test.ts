import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";

describe("money display", () => {
  it("shows the stored hundredths for every accepted currency", () => {
    // ICU renders HUF, IDR and COP with no decimals by local convention, but the
    // ledger stores them as hundredths, so hiding the fraction would make totals
    // fail to add up.
    for (const currency of ["CAD", "EUR", "HUF", "IDR", "COP"]) {
      expect(formatMoney(1234, currency, "en")).toContain("12.34");
    }
  });

  it("groups and separates according to the active language", () => {
    const german = formatMoney(123456789, "EUR", "de-DE");
    const english = formatMoney(123456789, "EUR", "en-US");
    expect(german).toContain("1.234.567,89");
    expect(english).toContain("1,234,567.89");
  });

  it("represents the same stored value in either language", () => {
    const digits = (text: string) => text.replace(/[^\d]/g, "");
    expect(digits(formatMoney(1234, "EUR", "zh-CN"))).toBe(digits(formatMoney(1234, "EUR", "en")));
  });
});
