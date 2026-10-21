import type { SpendingReportDrillDown, SpendingReportSection } from "@ledger/domain";
import type { MouseEvent } from "react";

import { formatMoney } from "./analysis-data";
import { useTranslation } from "../../i18n/useTranslation";

type Navigate = (event: MouseEvent<HTMLAnchorElement>, path: string) => void;

function drillDownHref(drillDown: SpendingReportDrillDown) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(drillDown).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    params.set(key, String(value));
  }
  return `/transactions?${params}`;
}

function proportion(value: number, maximum: number) {
  return maximum === 0 ? 0 : Math.max(2, Math.round((Math.abs(value) / maximum) * 100));
}

export function AnalysisBreakdowns({
  onNavigate,
  section,
}: {
  onNavigate: Navigate;
  section: SpendingReportSection;
}) {
  const { t } = useTranslation();
  const categoryMaximum = Math.max(
    0,
    ...section.categoryDistribution.map(({ netSpendingMinor }) => Math.abs(netSpendingMinor)),
  );
  const positiveSpending = section.categoryDistribution.reduce(
    (sum, row) => sum + Math.max(0, row.netSpendingMinor),
    0,
  );
  const merchantMaximum = Math.max(
    0,
    ...section.merchantRanking.map(({ netSpendingMinor }) => Math.abs(netSpendingMinor)),
  );
  return (
    <div className="analysis-breakdowns">
      <section className="analysis-block">
        <div className="analysis-block-heading">
          <div>
            <p>{t("an.breakdownKicker", { currency: section.currency })}</p>
            <h2>{t("an.breakdownTitle", { currency: section.currency })}</h2>
            <p>{t("an.breakdownNote")}</p>
          </div>
        </div>
        <div className="analysis-table-wrap">
          <table aria-label={t("an.breakdownTable", { currency: section.currency })}>
            <thead>
              <tr>
                <th scope="col">{t("an.column.category")}</th>
                <th scope="col">{t("an.column.count")}</th>
                <th scope="col">{t("an.metric.netSpending")}</th>
                <th scope="col">{t("an.column.share")}</th>
              </tr>
            </thead>
            <tbody>
              {section.categoryDistribution.map((row) => {
                const href = drillDownHref(row.drillDown);
                return (
                  <tr key={row.categoryId}>
                    <th scope="row">
                      <a href={href} onClick={(event) => onNavigate(event, href)}>
                        {t("an.viewCategory", { category: row.categoryName })}
                      </a>
                      <span aria-hidden="true" className="breakdown-bar">
                        <span
                          style={{ width: `${proportion(row.netSpendingMinor, categoryMaximum)}%` }}
                        />
                      </span>
                    </th>
                    <td>{row.transactionCount}</td>
                    <td>
                      {formatMoney(row.netSpendingMinor, section.currency)}（
                      {row.netSpendingMinor < 0 ? t("an.refundNegative") : t("an.spending")}）
                    </td>
                    <td>
                      {row.netSpendingMinor < 0
                        ? t("an.netRefund")
                        : positiveSpending === 0
                          ? "—"
                          : `${((row.netSpendingMinor / positiveSpending) * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="analysis-block">
        <div className="analysis-block-heading">
          <div>
            <p>
              {t("an.merchantCount", {
                shown: section.merchantRanking.length,
                total: section.merchantGroupCount,
              })}{" "}
              {section.currency}
            </p>
            <h2>{t("an.merchantTitle", { currency: section.currency })}</h2>
          </div>
        </div>
        <div className="analysis-table-wrap">
          <table aria-label={t("an.merchantTable", { currency: section.currency })}>
            <thead>
              <tr>
                <th scope="col">{t("an.column.merchant")}</th>
                <th scope="col">{t("an.column.count")}</th>
                <th scope="col">{t("an.metric.netSpending")}</th>
              </tr>
            </thead>
            <tbody>
              {section.merchantRanking.map((row, index) => {
                const merchantName =
                  row.merchantName ?? row.normalizedMerchant ?? t("an.noMerchant");
                const href = drillDownHref(row.drillDown);
                return (
                  <tr key={row.merchantFamily ?? row.normalizedMerchant ?? `missing-${index}`}>
                    <th scope="row">
                      <a href={href} onClick={(event) => onNavigate(event, href)}>
                        {merchantName}
                      </a>
                      <span aria-hidden="true" className="breakdown-bar">
                        <span
                          style={{ width: `${proportion(row.netSpendingMinor, merchantMaximum)}%` }}
                        />
                      </span>
                    </th>
                    <td>{row.transactionCount}</td>
                    <td>{formatMoney(row.netSpendingMinor, section.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
