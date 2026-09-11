import {
  cashFlowReportResponseSchema,
  type CashFlowReportSection,
  spendingReportResponseSchema,
} from "@ledger/domain";
import type { AccountOptionsResponse } from "@ledger/domain/api-contracts";

import { shiftedAnalysisQuery, type AnalysisQuery } from "./analysis-period";

export type CashFlowResponse = ReturnType<typeof cashFlowReportResponseSchema.parse>;
export type SpendingResponse = ReturnType<typeof spendingReportResponseSchema.parse>;

export interface AnalysisTrendPoint {
  incomeMinor: number;
  label: string;
  netCashFlowMinor: number;
  netSpendingMinor: number;
}

export interface AnalysisData {
  accounts: AccountOptionsResponse["data"]["accounts"];
  cashFlow: CashFlowResponse;
  spending: SpendingResponse;
  trend: Map<string, AnalysisTrendPoint[]>;
}

const zeroPoint = (label: string): AnalysisTrendPoint => ({
  incomeMinor: 0,
  label,
  netCashFlowMinor: 0,
  netSpendingMinor: 0,
});

function addReportPoints(
  points: Map<string, Map<string, AnalysisTrendPoint>>,
  report: CashFlowResponse,
) {
  for (const section of report.data.sections) {
    const currency = points.get(section.currency) ?? new Map<string, AnalysisTrendPoint>();
    currency.set(report.meta.periods.current.label, {
      ...section.current,
      label: report.meta.periods.current.label,
    });
    currency.set(report.meta.periods.previousPeriod.label, {
      incomeMinor: section.previousPeriod.income.referenceMinor,
      label: report.meta.periods.previousPeriod.label,
      netCashFlowMinor: section.previousPeriod.netCashFlow.referenceMinor,
      netSpendingMinor: section.previousPeriod.netSpending.referenceMinor,
    });
    points.set(section.currency, currency);
  }
}

function expectedLabels(query: AnalysisQuery): string[] {
  if (query.grain === "CUSTOM") return [];
  if (query.grain === "YEAR") {
    return Array.from(
      { length: 12 },
      (_, index) => `${query.period}-${String(index + 1).padStart(2, "0")}`,
    );
  }
  const count = query.grain === "MONTH" ? 6 : 4;
  return Array.from({ length: count }, (_, index) => {
    const shifted = shiftedAnalysisQuery(query, index - count + 1);
    return shifted.grain === "CUSTOM" ? "" : shifted.period;
  });
}

function customTrend(section: CashFlowReportSection, report: CashFlowResponse) {
  return [
    {
      incomeMinor: section.previousYear.income.referenceMinor,
      label: `去年同期 ${report.meta.periods.previousYear.label}`,
      netCashFlowMinor: section.previousYear.netCashFlow.referenceMinor,
      netSpendingMinor: section.previousYear.netSpending.referenceMinor,
    },
    {
      incomeMinor: section.previousPeriod.income.referenceMinor,
      label: `上一周期 ${report.meta.periods.previousPeriod.label}`,
      netCashFlowMinor: section.previousPeriod.netCashFlow.referenceMinor,
      netSpendingMinor: section.previousPeriod.netSpending.referenceMinor,
    },
    { ...section.current, label: `当前 ${report.meta.periods.current.label}` },
  ];
}

export function assembleAnalysisData(
  accountOptions: AccountOptionsResponse,
  cashFlow: CashFlowResponse,
  spending: SpendingResponse,
  trendReports: CashFlowResponse[],
  query: AnalysisQuery,
): AnalysisData {
  const accounts = accountOptions.data.accounts;
  if (query.grain === "CUSTOM") {
    return {
      accounts,
      cashFlow,
      spending,
      trend: new Map(
        cashFlow.data.sections.map((section) => [section.currency, customTrend(section, cashFlow)]),
      ),
    };
  }

  const points = new Map<string, Map<string, AnalysisTrendPoint>>();
  const reports = query.grain === "YEAR" ? trendReports : [cashFlow, ...trendReports];
  for (const report of reports) addReportPoints(points, report);
  const labels = expectedLabels(query);
  const currencies = new Set([
    ...cashFlow.data.sections.map(({ currency }) => currency),
    ...points.keys(),
  ]);
  const trend = new Map<string, AnalysisTrendPoint[]>();
  for (const currency of [...currencies].sort()) {
    const currencyPoints = points.get(currency) ?? new Map<string, AnalysisTrendPoint>();
    trend.set(
      currency,
      labels.map((label) => currencyPoints.get(label) ?? zeroPoint(label)),
    );
  }
  return { accounts, cashFlow, spending, trend };
}

export function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    currency,
    currencyDisplay: "narrowSymbol",
    style: "currency",
  }).format(amountMinor / 100);
}
