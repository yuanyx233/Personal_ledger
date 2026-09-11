import type { SpendingReportDrillDown, SpendingReportSection } from "@ledger/domain";
import type { MouseEvent } from "react";

import { formatMoney } from "./analysis-data";

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
            <p>净支出 · {section.currency}</p>
            <h2>{section.currency} 类别分布</h2>
            <p>占比按各类别正净支出合计计算。</p>
          </div>
        </div>
        <div className="analysis-table-wrap">
          <table aria-label={`${section.currency} 类别分布`}>
            <thead>
              <tr>
                <th scope="col">类别</th>
                <th scope="col">交易数</th>
                <th scope="col">净支出</th>
                <th scope="col">支出占比</th>
              </tr>
            </thead>
            <tbody>
              {section.categoryDistribution.map((row) => {
                const href = drillDownHref(row.drillDown);
                return (
                  <tr key={row.categoryId}>
                    <th scope="row">
                      <a href={href} onClick={(event) => onNavigate(event, href)}>
                        查看{row.categoryName}交易
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
                      {row.netSpendingMinor < 0 ? "退款后为负" : "支出"}）
                    </td>
                    <td>
                      {row.netSpendingMinor < 0
                        ? "净退款"
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
              前 {section.merchantRanking.length} / {section.merchantGroupCount} 组 ·{" "}
              {section.currency}
            </p>
            <h2>{section.currency} 商户排行</h2>
          </div>
        </div>
        <div className="analysis-table-wrap">
          <table aria-label={`${section.currency} 商户排行`}>
            <thead>
              <tr>
                <th scope="col">商户</th>
                <th scope="col">交易数</th>
                <th scope="col">净支出</th>
              </tr>
            </thead>
            <tbody>
              {section.merchantRanking.map((row, index) => {
                const merchantName = row.merchantName ?? row.normalizedMerchant ?? "未提供商户";
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
