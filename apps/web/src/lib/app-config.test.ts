import { describe, expect, it } from "vitest";

import {
  TimeZoneMismatchError,
  assertTimeZoneAgreement,
  readLedgerCurrencies,
  readLedgerTimeZone,
} from "./app-config";

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

  it("accepts a Worker zone that matches the bundled one", () => {
    expect(() => assertTimeZoneAgreement("Europe/Berlin", "Europe/Berlin")).not.toThrow();
    expect(() => assertTimeZoneAgreement("america/toronto", "America/Toronto")).not.toThrow();
  });

  it("lists the currencies this deployment's accounts are denominated in", () => {
    expect(readLedgerCurrencies("CAD,USD")).toEqual(["CAD", "USD"]);
    expect(readLedgerCurrencies("EUR")).toEqual(["EUR"]);
    expect(readLedgerCurrencies(" CAD , USD ")).toEqual(["CAD", "USD"]);
  });

  it("defaults to the pair this ledger started with", () => {
    expect(readLedgerCurrencies(undefined)).toEqual(["CAD", "USD"]);
    expect(readLedgerCurrencies("")).toEqual(["CAD", "USD"]);
  });

  it("keeps the declared order and drops repeats", () => {
    expect(readLedgerCurrencies("USD,CAD,USD")).toEqual(["USD", "CAD"]);
  });

  it("refuses a list holding a currency the ledger cannot store safely", () => {
    for (const value of ["CAD,JPY", "KWD", "cad", "CANADA", "CAD,,USD"]) {
      expect(() => readLedgerCurrencies(value)).toThrow(/VITE_LEDGER_CURRENCIES/);
    }
  });

  it("blocks on disagreement and names both values", () => {
    let caught: unknown;
    try {
      assertTimeZoneAgreement("Europe/Berlin", "America/Toronto");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TimeZoneMismatchError);
    expect((caught as Error).message).toContain("Europe/Berlin");
    expect((caught as Error).message).toContain("America/Toronto");
  });
});
