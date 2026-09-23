import { describe, expect, it } from "vitest";
import { NON_CENTESIMAL_CURRENCIES, ledgerCurrencySchema } from "./currency";

const parses = (code: string) => ledgerCurrencySchema.safeParse(code).success;

describe("ledger currency", () => {
  it("accepts the currencies this ledger already used", () => {
    expect(parses("CAD")).toBe(true);
    expect(parses("USD")).toBe(true);
  });

  it("accepts other currencies whose minor unit is one hundredth", () => {
    for (const code of ["EUR", "GBP", "CNY", "AUD", "CHF", "SEK", "INR", "BRL", "MXN", "NZD"]) {
      expect(parses(code)).toBe(true);
    }
  });

  it("rejects currencies with no minor unit, which /100 would scale by a hundred", () => {
    for (const code of ["JPY", "KRW", "VND", "ISK", "CLP", "XAF", "XOF", "XPF", "VUV"]) {
      expect(parses(code)).toBe(false);
    }
  });

  it("rejects three- and four-decimal currencies", () => {
    for (const code of ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND", "CLF", "UYW"]) {
      expect(parses(code)).toBe(false);
    }
  });

  it("follows ISO minor units, not ICU display conventions", () => {
    // ICU shows these with no decimals by local convention, but ISO 4217 gives them
    // an exponent of 2, so storing them as hundredths is correct.
    for (const code of ["HUF", "IDR", "COP"]) {
      expect(parses(code)).toBe(true);
      expect(icuFractionDigits(code)).toBe(0);
    }
    // ICU shows IQD with no decimals; ISO gives it an exponent of 3, so it is unsafe.
    expect(parses("IQD")).toBe(false);
    expect(icuFractionDigits("IQD")).toBe(0);
  });

  it("rejects anything that is not three uppercase letters", () => {
    for (const code of ["", "US", "USDD", "usd", "US1", "U SD", " USD"]) {
      expect(parses(code)).toBe(false);
    }
  });

  it("accepts well-formed codes it does not know, which cannot cause a scale error", () => {
    // An unknown code forms its own currency bucket in reports, which the owner sees
    // immediately. That is a far milder failure than silently misscaling a real one.
    expect(parses("XYZ")).toBe(true);
  });

  it("keeps the rejection set sorted and free of duplicates", () => {
    const codes = [...NON_CENTESIMAL_CURRENCIES];
    expect(codes).toEqual([...new Set(codes)].sort());
    expect(codes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
  });
});

function icuFractionDigits(code: string): number | undefined {
  return new Intl.NumberFormat("en", { currency: code, style: "currency" }).resolvedOptions()
    .maximumFractionDigits;
}
