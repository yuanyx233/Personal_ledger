import type { CashFlowReportSection, SpendingReportSection } from "@ledger/domain";

export interface OverviewData {
  currentPeriod: string;
  currentSections: CashFlowReportSection[];
  spendingSections: SpendingReportSection[];
}
