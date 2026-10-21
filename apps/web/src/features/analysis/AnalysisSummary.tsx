import type { CashFlowReportSection } from "@ledger/domain";

import { formatMoney } from "./analysis-data";
import { useTranslation } from "../../i18n/useTranslation";

const METRICS = [
  ["income", "an.metric.income", "incomeMinor"],
  ["netSpending", "an.metric.netSpending", "netSpendingMinor"],
  ["netCashFlow", "an.metric.netCashFlow", "netCashFlowMinor"],
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
  const { t } = useTranslation();
  return (
    <section className="analysis-block analysis-summary" data-analysis-currency={section.currency}>
      <div className="analysis-block-heading">
        <div>
          <p>{t("an.amountUnit", { currency: section.currency })}</p>
          <h2>{t("an.metricsTitle", { currency: section.currency })}</h2>
        </div>
      </div>

      <dl className="analysis-metric-strip">
        {METRICS.map(([, labelKey, currentKey]) => (
          <div key={labelKey}>
            <dt>{t(labelKey)}</dt>
            <dd>{formatMoney(section.current[currentKey], section.currency)}</dd>
          </div>
        ))}
      </dl>

      <div className="analysis-table-wrap">
        <table aria-label={t("an.metricsTable", { currency: section.currency })}>
          <thead>
            <tr>
              <th scope="col">{t("an.column.metric")}</th>
              <th scope="col">{t("an.column.current")}</th>
              <th scope="col">{t("an.column.vsPrevious")}</th>
              <th scope="col">{t("an.column.vsLastYear")}</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map(([comparisonKey, labelKey, currentKey]) => {
              const previous = section.previousPeriod[comparisonKey];
              const previousYear = section.previousYear[comparisonKey];
              return (
                <tr key={labelKey}>
                  <th scope="row">{t(labelKey)}</th>
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
