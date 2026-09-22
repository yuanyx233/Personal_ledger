import type { AccountOptionsResponse } from "@ledger/domain/api-contracts";
import type { FormEvent, MouseEvent } from "react";

import {
  grainQuery,
  periodNavigationLabel,
  queryPeriodInput,
  reportSearchParams,
  shiftedAnalysisQuery,
  type AnalysisGrain,
  type AnalysisQuery,
} from "./analysis-period";
import { resolveReportPeriod } from "@ledger/domain";

import { LEDGER_TIME_ZONE } from "../../lib/app-config";

type Account = AccountOptionsResponse["data"]["accounts"][number];
type NavigateSearch = (event: MouseEvent<HTMLAnchorElement>, query: AnalysisQuery) => void;
type ApplyQuery = (query: AnalysisQuery) => void;

const GRAINS: readonly [AnalysisGrain, string][] = [
  ["MONTH", "月"],
  ["QUARTER", "季度"],
  ["YEAR", "年"],
  ["CUSTOM", "自定义"],
];

function href(query: AnalysisQuery) {
  return `/analysis?${reportSearchParams(query)}`;
}

export function AnalysisControls({
  accounts,
  onApply,
  onNavigate,
  query,
}: {
  accounts: Account[];
  onApply: ApplyQuery;
  onNavigate: NavigateSearch;
  query: AnalysisQuery;
}) {
  const period = resolveReportPeriod(queryPeriodInput(query));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const accountValue = data.get("accountId");
    const accountId = typeof accountValue === "string" ? accountValue : "";
    if (query.grain === "CUSTOM") {
      const fromValue = data.get("dateFrom");
      const toValue = data.get("dateTo");
      onApply({
        ...(accountId ? { accountId } : {}),
        dateFrom: typeof fromValue === "string" ? fromValue : "",
        dateTo: typeof toValue === "string" ? toValue : "",
        grain: "CUSTOM",
      });
      return;
    }
    const periodValue = data.get("period");
    onApply({
      ...(accountId ? { accountId } : {}),
      grain: query.grain,
      period:
        query.grain === "MONTH" && typeof periodValue === "string" ? periodValue : query.period,
    });
  }

  return (
    <section aria-labelledby="analysis-controls-title" className="analysis-controls">
      <div className="analysis-grains" role="navigation" aria-label="分析周期粒度">
        {GRAINS.map(([grain, label]) => {
          const next = grainQuery(grain, query);
          return (
            <a
              aria-current={query.grain === grain ? "page" : undefined}
              href={href(next)}
              key={grain}
              onClick={(event) => onNavigate(event, next)}
            >
              {label}
            </a>
          );
        })}
      </div>

      <div className="analysis-period-heading">
        <div>
          <p id="analysis-controls-title">{LEDGER_TIME_ZONE} 日历</p>
          <strong>{period.label}</strong>
        </div>
        {query.grain === "CUSTOM" ? null : (
          <nav aria-label="周期导航">
            {(["previous", "next"] as const).map((direction) => {
              const next = shiftedAnalysisQuery(query, direction === "previous" ? -1 : 1);
              return (
                <a href={href(next)} key={direction} onClick={(event) => onNavigate(event, next)}>
                  {periodNavigationLabel(query.grain, direction)}
                </a>
              );
            })}
          </nav>
        )}
      </div>

      <form key={href(query)} onSubmit={submit}>
        {query.grain === "MONTH" ? (
          <label>
            月份
            <input defaultValue={query.period} name="period" required type="month" />
          </label>
        ) : null}
        <label>
          账户
          <select defaultValue={query.accountId ?? ""} name="accountId">
            <option value="">全部已启用账户</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName}
              </option>
            ))}
          </select>
        </label>
        {query.grain === "CUSTOM" ? (
          <>
            <label>
              开始日期
              <input defaultValue={query.dateFrom} name="dateFrom" required type="date" />
            </label>
            <label>
              结束日期
              <input defaultValue={query.dateTo} name="dateTo" required type="date" />
            </label>
          </>
        ) : null}
        <button className="primary-action" type="submit">
          应用筛选
        </button>
      </form>
    </section>
  );
}
