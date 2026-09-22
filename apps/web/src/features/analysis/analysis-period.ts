import { resolveReportPeriod } from "@ledger/domain";

import { LEDGER_TIME_ZONE } from "../../lib/app-config";

export type AnalysisGrain = "CUSTOM" | "MONTH" | "QUARTER" | "YEAR";

type AccountFilter = {
  accountId?: string;
};

export type AnalysisQuery = AccountFilter &
  (
    | { dateFrom: string; dateTo: string; grain: "CUSTOM" }
    | { grain: "MONTH" | "QUARTER" | "YEAR"; period: string }
  );

export type AnalysisPeriodInput =
  | { dateFrom: string; dateTo: string; grain: "CUSTOM" }
  | { grain: "MONTH" | "QUARTER" | "YEAR"; period: string };

function calendarParts(now = new Date(), timeZone = LEDGER_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function currentPeriod(
  grain: Exclude<AnalysisGrain, "CUSTOM">,
  now = new Date(),
  timeZone = LEDGER_TIME_ZONE,
) {
  const parts = calendarParts(now, timeZone);
  if (grain === "YEAR") return parts.year!;
  if (grain === "QUARTER") return `${parts.year}-Q${Math.ceil(Number(parts.month) / 3)}`;
  return `${parts.year}-${parts.month}`;
}

function isSafeIdentifier(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 160;
}

function validPeriod(input: AnalysisPeriodInput): boolean {
  try {
    resolveReportPeriod(input);
    return true;
  } catch {
    return false;
  }
}

export function parseAnalysisQuery(search: string, now = new Date()): AnalysisQuery {
  const params = new URLSearchParams(search);
  const rawGrain = params.get("grain");
  const grain: AnalysisGrain = ["MONTH", "QUARTER", "YEAR", "CUSTOM"].includes(rawGrain ?? "")
    ? (rawGrain as AnalysisGrain)
    : "MONTH";
  const accountId = params.get("accountId");
  const common = isSafeIdentifier(accountId) ? { accountId } : {};

  if (grain === "CUSTOM") {
    const dateFrom = params.get("dateFrom") ?? "";
    const dateTo = params.get("dateTo") ?? "";
    if (validPeriod({ dateFrom, dateTo, grain })) return { ...common, dateFrom, dateTo, grain };
  } else {
    const period = params.get("period") ?? currentPeriod(grain, now);
    if (validPeriod({ grain, period })) {
      return { ...common, grain, period };
    }
  }

  return { ...common, grain: "MONTH", period: currentPeriod("MONTH", now) };
}

export function queryPeriodInput(query: AnalysisQuery): AnalysisPeriodInput {
  return query.grain === "CUSTOM"
    ? { dateFrom: query.dateFrom, dateTo: query.dateTo, grain: "CUSTOM" }
    : { grain: query.grain, period: query.period };
}

export function reportSearchParams(query: AnalysisQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grain", query.grain);
  if (query.grain === "CUSTOM") {
    params.set("dateFrom", query.dateFrom);
    params.set("dateTo", query.dateTo);
  } else {
    params.set("period", query.period);
  }
  if (query.accountId) params.set("accountId", query.accountId);
  return params;
}

function shiftMonth(period: string, offset: number): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftQuarter(period: string, offset: number): string {
  const [yearText, quarterText] = period.split("-Q") as [string, string];
  const index = Number(yearText) * 4 + Number(quarterText) - 1 + offset;
  const year = Math.floor(index / 4);
  return `${year}-Q${(index % 4) + 1}`;
}

export function shiftedAnalysisQuery(query: AnalysisQuery, offset: number): AnalysisQuery {
  if (query.grain === "CUSTOM") return query;
  const period =
    query.grain === "MONTH"
      ? shiftMonth(query.period, offset)
      : query.grain === "QUARTER"
        ? shiftQuarter(query.period, offset)
        : String(Number(query.period) + offset);
  return { ...query, period };
}

export function grainQuery(grain: AnalysisGrain, query: AnalysisQuery, now = new Date()) {
  if (grain === "CUSTOM") {
    const parts = calendarParts(now);
    const dateTo = `${parts.year}-${parts.month}-${parts.day}`;
    const from = new Date(`${dateTo}T00:00:00.000Z`);
    from.setUTCDate(from.getUTCDate() - 29);
    const dateFrom = from.toISOString().slice(0, 10);
    return {
      ...(query.accountId ? { accountId: query.accountId } : {}),
      dateFrom,
      dateTo,
      grain,
    } satisfies AnalysisQuery;
  }
  return {
    ...(query.accountId ? { accountId: query.accountId } : {}),
    grain,
    period: currentPeriod(grain, now),
  } satisfies AnalysisQuery;
}

export function trendPeriodInputs(query: AnalysisQuery): AnalysisPeriodInput[] {
  if (query.grain === "CUSTOM") return [];
  if (query.grain === "YEAR") {
    return [2, 4, 6, 8, 10, 12].map((month) => ({
      grain: "MONTH" as const,
      period: `${query.period}-${String(month).padStart(2, "0")}`,
    }));
  }
  const offsets = query.grain === "MONTH" ? [-2, -4] : [-2];
  return offsets.map((offset) => queryPeriodInput(shiftedAnalysisQuery(query, offset)));
}

export function periodNavigationLabel(grain: AnalysisGrain, direction: "next" | "previous") {
  const unit = grain === "MONTH" ? "月" : grain === "QUARTER" ? "季度" : "年";
  return `${direction === "previous" ? "上一" : "下一"}${unit}`;
}
