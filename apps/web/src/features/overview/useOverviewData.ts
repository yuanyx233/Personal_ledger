import { cashFlowReportResponseSchema, spendingReportResponseSchema } from "@ledger/domain";
import { useEffect, useState } from "react";

import { currentPeriod } from "../analysis/analysis-period";
import type { OverviewData } from "./overview-data";

type OverviewLoadState =
  { status: "error" } | { status: "loading" } | { data: OverviewData; status: "ready" };

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
  if (!response.ok) throw new Error("OVERVIEW_REQUEST_FAILED");
  return schema.parse(await response.json());
}

export function useOverviewData() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OverviewLoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const period = currentPeriod("MONTH");
    void Promise.all([
      readJson(
        `/api/v1/reports/cash-flow?grain=MONTH&period=${period}`,
        cashFlowReportResponseSchema,
        controller.signal,
      ),
      readJson(
        `/api/v1/reports/spending?grain=MONTH&period=${period}`,
        spendingReportResponseSchema,
        controller.signal,
      ),
    ])
      .then(([cashFlow, spending]) => {
        if (controller.signal.aborted) return;
        setState({
          data: {
            currentPeriod: cashFlow.meta.periods.current.label,
            currentSections: cashFlow.data.sections,
            spendingSections: spending.data.sections,
          },
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [attempt]);

  return {
    retry: () => {
      setState({ status: "loading" });
      setAttempt((value) => value + 1);
    },
    state,
  };
}
