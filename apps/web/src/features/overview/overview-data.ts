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
    style: "currency",
  }).format(amountMinor / 100);
}
