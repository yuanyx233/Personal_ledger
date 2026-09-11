import { cashFlowReportResponseSchema, spendingReportResponseSchema } from "@ledger/domain";
import { accountOptionsResponseSchema } from "@ledger/domain/api-contracts";
import { useEffect, useMemo, useState } from "react";

import { assembleAnalysisData, type AnalysisData } from "./analysis-data";
import {
  parseAnalysisQuery,
  reportSearchParams,
  trendPeriodInputs,
  type AnalysisQuery,
} from "./analysis-period";

type AnalysisLoadState =
  | { queryKey: string; status: "error" }
  | { status: "loading" }
  | { data: AnalysisData; queryKey: string; status: "ready" };

async function readJson<T>(
  path: string,
  schema: { parse(value: unknown): T },
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("ANALYSIS_REQUEST_FAILED");
  return schema.parse(await response.json());
}

function trendSearchParams(query: AnalysisQuery, grain: string, input: Record<string, string>) {
  const params = new URLSearchParams({ grain, ...input });
  if (query.accountId) params.set("accountId", query.accountId);
  return params;
}

export function useAnalysisData(query: AnalysisQuery) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AnalysisLoadState>({ status: "loading" });
  const queryKey = reportSearchParams(query).toString();
  const stableQuery = useMemo(() => parseAnalysisQuery(queryKey), [queryKey]);

  useEffect(() => {
    const controller = new AbortController();
    const reportParams = reportSearchParams(stableQuery);
    const trendRequests = trendPeriodInputs(stableQuery).map((input) => {
      const params =
        input.grain === "CUSTOM"
          ? trendSearchParams(stableQuery, input.grain, {
              dateFrom: input.dateFrom,
              dateTo: input.dateTo,
            })
          : trendSearchParams(stableQuery, input.grain, { period: input.period });
      return readJson(
        `/api/v1/reports/cash-flow?${params}`,
        cashFlowReportResponseSchema,
        controller.signal,
      );
    });
    void Promise.all([
      readJson("/api/v1/accounts", accountOptionsResponseSchema, controller.signal),
      readJson(
        `/api/v1/reports/cash-flow?${reportParams}`,
        cashFlowReportResponseSchema,
        controller.signal,
      ),
      readJson(
        `/api/v1/reports/spending?${reportParams}`,
        spendingReportResponseSchema,
        controller.signal,
      ),
      Promise.all(trendRequests),
    ])
      .then(([accounts, cashFlow, spending, trendReports]) => {
        setState({
          data: assembleAnalysisData(accounts, cashFlow, spending, trendReports, stableQuery),
          queryKey,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ queryKey, status: "error" });
        }
      });
    return () => controller.abort();
  }, [attempt, queryKey, stableQuery]);

  const visibleState: AnalysisLoadState =
    state.status !== "loading" && state.queryKey !== queryKey ? { status: "loading" } : state;
  return {
    retry: () => setAttempt((value) => value + 1),
    state: visibleState,
  };
}
