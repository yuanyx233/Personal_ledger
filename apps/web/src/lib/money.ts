// Amounts are stored as integer minor units at a fixed ratio of 1/100, guarded by
// the currency validator. ICU hides the hundredths for some currencies (HUF, IDR,
// COP) by local convention, which would make displayed totals fail to add up, so
// both fraction digits are always shown.
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amountMinor / 100);
}
