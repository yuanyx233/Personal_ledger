import type { CashFlowReportSection, SpendingReportSection } from "@ledger/domain";

export interface OverviewData {
  currentPeriod: string;
  currentSections: CashFlowReportSection[];
  spendingSections: SpendingReportSection[];
}

export function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    currency,
    currencyDisplay: "narrowSymbol",
    // Every accepted currency stores hundredths, but ICU hides them for some
    // (HUF, IDR, COP) by local convention, which would make totals look wrong.
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amountMinor / 100);
}
