import type { SpendingReportSection } from "@ledger/domain";
import { useId, type MouseEvent } from "react";

import { formatMoney } from "./overview-data";

const COLORS = [
  "#657e69",
  "#a97855",
  "#5e839b",
  "#a18c48",
  "#8c7296",
  "#ab6863",
  "#64938e",
  "#827963",
  "#6d73a0",
  "#ad8091",
];
const CATEGORY_ORDER = [
  "food",
  "shopping",
  "bills",
  "housing",
  "entertainment",
  "healthcare",
  "transportation",
  "other",
  "travel",
  "tuition",
];

function categoryColor(categoryId: string) {
  const known = CATEGORY_ORDER.indexOf(categoryId.replace("category-expense-", ""));
  const index =
    known >= 0
      ? known
      : [...categoryId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLORS.length;
  return COLORS[index]!;
}

function wedgePath(start: number, share: number) {
  const point = (fraction: number) => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;
    return `${150 + Math.cos(angle) * 140} ${150 + Math.sin(angle) * 140}`;
  };
  return `M 150 150 L ${point(start)} A 140 140 0 ${share > 0.5 ? 1 : 0} 1 ${point(start + share)} Z`;
}

export function OverviewSpendingPie({
  section,
  onNavigate,
}: {
  section: SpendingReportSection;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
}) {
  const titleId = useId();
  const rows = [...section.categoryDistribution].sort(
    (a, b) => b.netSpendingMinor - a.netSpendingMinor || a.categoryId.localeCompare(b.categoryId),
  );
  const positiveTotal = rows.reduce((sum, row) => sum + Math.max(0, row.netSpendingMinor), 0);
  let offset = 0;
  const slices = [];
  for (const row of rows) {
    if (row.netSpendingMinor <= 0) continue;
    const share = row.netSpendingMinor / positiveTotal;
    slices.push({ ...row, share, start: offset });
    offset += share;
  }
  return (
    <section className="overview-spending-currency" aria-label={`${section.currency} 分类支出`}>
      <div className="overview-spending-total">
        <h3>{section.currency}</h3>
        <p>
          净支出 <strong>{formatMoney(section.netSpendingMinor, section.currency)}</strong>
        </p>
      </div>
      <div className="overview-pie-layout">
        {positiveTotal > 0 ? (
          <svg className="overview-pie" viewBox="0 0 300 300" role="img" aria-labelledby={titleId}>
            <title id={titleId}>{section.currency} 分类支出饼图，金额和占比见旁边的类别明细</title>
            {slices.map((slice) => {
              const title = `${slice.categoryName}：${formatMoney(slice.netSpendingMinor, section.currency)}，${(slice.share * 100).toFixed(1)}%`;
              return slice.share === 1 ? (
                <circle
                  key={slice.categoryId}
                  cx="150"
                  cy="150"
                  r="140"
                  fill={categoryColor(slice.categoryId)}
                >
                  <title>{title}</title>
                </circle>
              ) : (
                <path
                  key={slice.categoryId}
                  d={wedgePath(slice.start, slice.share)}
                  fill={categoryColor(slice.categoryId)}
                  stroke="var(--surface)"
                  strokeWidth="2"
                >
                  <title>{title}</title>
                </path>
              );
            })}
          </svg>
        ) : (
          <p className="overview-pie-empty">暂无正净支出可绘制饼图</p>
        )}
        <div className="overview-pie-details">
          <table aria-label={`${section.currency} 分类支出明细`}>
            <thead>
              <tr>
                <th scope="col">类别</th>
                <th scope="col">净支出</th>
                <th scope="col">占比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const params = new URLSearchParams();
                for (const [key, value] of Object.entries(row.drillDown))
                  params.set(key, String(value));
                const href = `/transactions?${params}`;
                return (
                  <tr key={row.categoryId}>
                    <th scope="row">
                      <a href={href} onClick={(event) => onNavigate(event, href)}>
                        <span
                          className="overview-pie-swatch"
                          style={{ backgroundColor: categoryColor(row.categoryId) }}
                          aria-hidden="true"
                        />
                        {row.categoryName}
                      </a>
                    </th>
                    <td>{formatMoney(row.netSpendingMinor, section.currency)}</td>
                    <td>
                      {row.netSpendingMinor < 0
                        ? "净退款"
                        : positiveTotal === 0
                          ? "—"
                          : `${((row.netSpendingMinor / positiveTotal) * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="overview-pie-note">
            已扣除退款和报销抵扣，不含转账。饼图占比按各类别正净支出计算；点击类别查看明细。
          </p>
        </div>
      </div>
    </section>
  );
}
