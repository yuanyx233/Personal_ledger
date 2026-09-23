import * as z from "zod";

// Amounts are stored as integer minor units at a fixed ratio of 1/100, so a
// currency whose ISO 4217 exponent is not 2 would be recorded at the wrong scale
// without any error: a JPY amount would read a hundred times too small.
//
// These are ISO 4217 exponents, NOT the digits Intl.NumberFormat displays. ICU
// follows local display convention and disagrees in both directions — it shows
// HUF, IDR and COP with no decimals although ISO gives them an exponent of 2,
// and shows IQD with no decimals although ISO gives it 3. Do not regenerate this
// list from Intl; currency.test.ts pins both divergences.
export const NON_CENTESIMAL_CURRENCIES: readonly string[] = [
  // Exponent 0
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  // Exponent 3
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
  // Exponent 4
  "CLF",
  "UYW",
].sort();

const rejected = new Set(NON_CENTESIMAL_CURRENCIES);

export function isCentesimalCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && !rejected.has(code);
}

// A code this list does not know is accepted: it forms its own bucket in reports,
// which the owner notices, whereas a wrongly scaled real currency is silent.
export const ledgerCurrencySchema = z
  .string()
  .refine(isCentesimalCurrency, "Expected a three-letter currency whose minor unit is 1/100");
