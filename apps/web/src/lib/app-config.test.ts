import { describe, expect, it } from "vitest";

import { readLedgerTimeZone } from "./app-config";

describe("browser ledger configuration", () => {
  it("accepts a configured zone and returns its canonical form", () => {
    expect(readLedgerTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(readLedgerTimeZone("america/toronto")).toBe("America/Toronto");
  });

  it("refuses to start rather than fall back when the zone is missing or unusable", () => {
    for (const value of [undefined, "", "Not/AZone", "+05:00"]) {
      expect(() => readLedgerTimeZone(value)).toThrow(/VITE_APP_TIMEZONE/);
    }
  });
});
