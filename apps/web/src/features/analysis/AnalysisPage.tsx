import { resolveReportPeriod } from "@ledger/domain";
import { useEffect, useMemo, useState, type MouseEvent } from "react";

import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { AnalysisBreakdowns } from "./AnalysisBreakdowns";
import { AnalysisControls } from "./AnalysisControls";
import { AnalysisSummary } from "./AnalysisSummary";
import { AnalysisTrend } from "./AnalysisTrend";
import { MonthlyBudgets } from "./MonthlyBudgets";
import {
  parseAnalysisQuery,
  queryPeriodInput,
  reportSearchParams,
  type AnalysisQuery,
} from "./analysis-period";
import { useAnalysisData } from "./useAnalysisData";
import { useTranslation } from "../../i18n/useTranslation";

type Navigate = (event: MouseEvent<HTMLAnchorElement>, path: string) => void;

export function AnalysisPage({
  online,
  onNavigate,
  route,
}: {
  online: boolean;
  onNavigate: Navigate;
  route: AppRoute;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(() => window.location.search);
  const [formError, setFormError] = useState<string | null>(null);
  const query = useMemo(() => parseAnalysisQuery(search), [search]);
  const { retry, state } = useAnalysisData(query);

  useEffect(() => {
    const updateSearch = () => setSearch(window.location.search);
    window.addEventListener("popstate", updateSearch);
    return () => window.removeEventListener("popstate", updateSearch);
  }, []);

  function commitQuery(next: AnalysisQuery) {
    const nextSearch = `?${reportSearchParams(next)}`;
    window.history.pushState(null, "", `/analysis${nextSearch}`);
    setFormError(null);
    setSearch(nextSearch);
  }

  function applyQuery(next: AnalysisQuery) {
    try {
      resolveReportPeriod(queryPeriodInput(next));
      commitQuery(next);
    } catch {
      setFormError("请选择有效的日期范围；自定义范围最多为 730 天。 ");
    }
  }

  function navigateSearch(event: MouseEvent<HTMLAnchorElement>, next: AnalysisQuery) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    commitQuery(next);
  }

  return (
    <div className="route-content analysis-page">
      <header className="page-header">
        <p className="page-kicker">{t("page.kicker")}</p>
        <h1>{t(route.labelKey)}</h1>
        <p className="page-description">{t(route.descriptionKey)}</p>
      </header>

      {!online ? (
        <DataState variant="offline" />
      ) : state.status === "loading" ? (
        <DataState variant="loading" />
      ) : state.status === "error" ? (
        <DataState
          action={
            <button className="primary-action" onClick={retry} type="button">
              重试
            </button>
          }
          variant="error"
        />
      ) : (
        <>
          <AnalysisControls
            accounts={state.data.accounts}
            onApply={applyQuery}
            onNavigate={navigateSearch}
            query={query}
          />
          {formError ? (
            <p className="detail-notice detail-notice--error" role="alert">
              {formError}
            </p>
          ) : null}

          {query.grain === "MONTH" ? (
            query.accountId ? (
              <p className="budget-help">查看和设置月度预算，请将账户筛选切换为全部账户。</p>
            ) : (
              <MonthlyBudgets
                key={query.period}
                month={query.period}
                sections={state.data.spending.data.sections}
              />
            )
          ) : null}

          {state.data.cashFlow.data.sections.length === 0 ? (
            <DataState title="所选周期没有可计入报表的交易" variant="empty" />
          ) : (
            <div className="analysis-results">
              {state.data.cashFlow.data.sections.map((section) => (
                <AnalysisSummary key={section.currency} section={section} />
              ))}
              {[...state.data.trend.entries()].map(([currency, points]) => (
                <AnalysisTrend currency={currency} key={currency} points={points} />
              ))}
              {state.data.spending.data.sections.length === 0 ? (
                <DataState title="所选周期没有支出类别或商户数据" variant="empty" />
              ) : (
                state.data.spending.data.sections.map((section) => (
                  <AnalysisBreakdowns
                    key={section.currency}
                    onNavigate={onNavigate}
                    section={section}
                  />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
