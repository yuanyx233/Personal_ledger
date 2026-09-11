import type { CashFlowReportSection } from "@ledger/domain";

import { formatMoney } from "./analysis-data";

const METRICS = [
  ["income", "收入", "incomeMinor"],
  ["netSpending", "净支出", "netSpendingMinor"],
  ["netCashFlow", "净现金流", "netCashFlowMinor"],
] as const;

function formatPercentage(value: number | null) {
  if (value === null) return "N/A";
  const percentage = value / 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  })}%`;
}

function ComparisonValue({
  absoluteChangeMinor,
  currency,
  percentageChangeBasisPoints,
}: {
  absoluteChangeMinor: number;
  currency: string;
  percentageChangeBasisPoints: number | null;
}) {
  const sign = absoluteChangeMinor > 0 ? "+" : "";
  return (
    <>
      {sign}
      {formatMoney(absoluteChangeMinor, currency)} ·{" "}
      <span>{formatPercentage(percentageChangeBasisPoints)}</span>
    </>
  );
}

export function AnalysisSummary({ section }: { section: CashFlowReportSection }) {
  return (
    <section className="analysis-block analysis-summary" data-analysis-currency={section.currency}>
      <div className="analysis-block-heading">
        <div>
          <p>金额单位 · {section.currency}</p>
          <h2>{section.currency} 指标</h2>
        </div>
      </div>

      <dl className="analysis-metric-strip">
        {METRICS.map(([, label, currentKey]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatMoney(section.current[currentKey], section.currency)}</dd>
          </div>
        ))}
      </dl>

      <div className="analysis-table-wrap">
        <table aria-label={`${section.currency} 指标比较`}>
          <thead>
            <tr>
              <th scope="col">指标</th>
              <th scope="col">当前</th>
              <th scope="col">较上一周期</th>
              <th scope="col">较去年同期</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map(([comparisonKey, label, currentKey]) => {
              const previous = section.previousPeriod[comparisonKey];
              const previousYear = section.previousYear[comparisonKey];
              return (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{formatMoney(section.current[currentKey], section.currency)}</td>
                  <td>
                    <ComparisonValue
                      absoluteChangeMinor={previous.absoluteChangeMinor}
                      currency={section.currency}
                      percentageChangeBasisPoints={previous.percentageChangeBasisPoints}
                    />
                  </td>
                  <td>
                    <ComparisonValue
                      absoluteChangeMinor={previousYear.absoluteChangeMinor}
                      currency={section.currency}
                      percentageChangeBasisPoints={previousYear.percentageChangeBasisPoints}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
