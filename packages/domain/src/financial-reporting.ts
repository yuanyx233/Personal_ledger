import * as z from "zod";
import { merchantFamilySchema } from "./import-categorization";

import { calendarDateSchema, currencyCodeSchema } from "./api-contracts";

export const REPORT_TIME_ZONE = "America/Toronto" as const;
export const MAX_CUSTOM_REPORT_DAYS = 730;

const yearSchema = z.string().regex(/^(?:19|[2-9][0-9])[0-9]{2}$/);
const monthPeriodSchema = z.string().regex(/^(?:19|[2-9][0-9])[0-9]{2}-(?:0[1-9]|1[0-2])$/);
const quarterPeriodSchema = z.string().regex(/^(?:19|[2-9][0-9])[0-9]{2}-Q[1-4]$/);

const reportPeriodInputSchema = z.discriminatedUnion("grain", [
  z.strictObject({ grain: z.literal("MONTH"), period: monthPeriodSchema }),
  z.strictObject({ grain: z.literal("QUARTER"), period: quarterPeriodSchema }),
  z.strictObject({ grain: z.literal("YEAR"), period: yearSchema }),
  z.strictObject({
    dateFrom: calendarDateSchema,
    dateTo: calendarDateSchema,
    grain: z.literal("CUSTOM"),
  }),
]);

export type ReportPeriodInput = z.infer<typeof reportPeriodInputSchema>;

const reportIdentifierSchema = z.string().min(1).max(160);
const reportFilterFields = {
  accountId: reportIdentifierSchema.optional(),
  categoryId: reportIdentifierSchema.optional(),
  currency: currencyCodeSchema.optional(),
  merchantMissing: z.literal(true).optional(),
  normalizedMerchant: z.string().min(1).max(256).optional(),
} as const;
const spendingReportFilterFields = {
  ...reportFilterFields,
  merchantLimit: z.int().min(1).max(100).default(20),
} as const;

export const cashFlowReportQuerySchema = z
  .discriminatedUnion("grain", [
    z.strictObject({
      ...reportFilterFields,
      grain: z.literal("MONTH"),
      period: monthPeriodSchema,
    }),
    z.strictObject({
      ...reportFilterFields,
      grain: z.literal("QUARTER"),
      period: quarterPeriodSchema,
    }),
    z.strictObject({
      ...reportFilterFields,
      grain: z.literal("YEAR"),
      period: yearSchema,
    }),
    z.strictObject({
      ...reportFilterFields,
      dateFrom: calendarDateSchema,
      dateTo: calendarDateSchema,
      grain: z.literal("CUSTOM"),
    }),
  ])
  .refine((query) => !query.merchantMissing || !query.normalizedMerchant, {
    message: "merchantMissing and normalizedMerchant are mutually exclusive.",
    path: ["merchantMissing"],
  });

export type CashFlowReportQuery = z.infer<typeof cashFlowReportQuerySchema>;

export const spendingReportQuerySchema = z
  .discriminatedUnion("grain", [
    z.strictObject({
      ...spendingReportFilterFields,
      grain: z.literal("MONTH"),
      period: monthPeriodSchema,
    }),
    z.strictObject({
      ...spendingReportFilterFields,
      grain: z.literal("QUARTER"),
      period: quarterPeriodSchema,
    }),
    z.strictObject({
      ...spendingReportFilterFields,
      grain: z.literal("YEAR"),
      period: yearSchema,
    }),
    z.strictObject({
      ...spendingReportFilterFields,
      dateFrom: calendarDateSchema,
      dateTo: calendarDateSchema,
      grain: z.literal("CUSTOM"),
    }),
  ])
  .refine((query) => !query.merchantMissing || !query.normalizedMerchant, {
    message: "merchantMissing and normalizedMerchant are mutually exclusive.",
    path: ["merchantMissing"],
  });

export type SpendingReportQuery = z.infer<typeof spendingReportQuerySchema>;

function parseReportSearchParams(searchParams: URLSearchParams, resource: string) {
  const input: Record<string, unknown> = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(input, key)) throw new TypeError(`Repeated ${resource} key: ${key}`);
    input[key] = value;
  }
  if (input.merchantMissing !== undefined) {
    if (input.merchantMissing !== "true") throw new TypeError("Invalid merchantMissing.");
    input.merchantMissing = true;
  }
  return input;
}

export function parseCashFlowReportQuery(searchParams: URLSearchParams): CashFlowReportQuery {
  const query = cashFlowReportQuerySchema.parse(
    parseReportSearchParams(searchParams, "cash-flow report"),
  );
  resolveReportPeriod(cashFlowReportPeriodInput(query));
  return query;
}

export function parseSpendingReportQuery(searchParams: URLSearchParams): SpendingReportQuery {
  const input = parseReportSearchParams(searchParams, "spending report");
  if (input.merchantLimit !== undefined) {
    if (typeof input.merchantLimit !== "string" || !/^[1-9][0-9]{0,2}$/.test(input.merchantLimit)) {
      throw new TypeError("Invalid merchantLimit.");
    }
    input.merchantLimit = Number(input.merchantLimit);
  }
  const query = spendingReportQuerySchema.parse(input);
  resolveReportPeriod(spendingReportPeriodInput(query));
  return query;
}

export function cashFlowReportPeriodInput(query: CashFlowReportQuery): ReportPeriodInput {
  return query.grain === "CUSTOM"
    ? { dateFrom: query.dateFrom, dateTo: query.dateTo, grain: query.grain }
    : { grain: query.grain, period: query.period };
}

export function spendingReportPeriodInput(query: SpendingReportQuery): ReportPeriodInput {
  return query.grain === "CUSTOM"
    ? { dateFrom: query.dateFrom, dateTo: query.dateTo, grain: query.grain }
    : { grain: query.grain, period: query.period };
}

export interface ResolvedReportPeriod {
  dateFrom: string;
  dateTo: string;
  grain: ReportPeriodInput["grain"];
  label: string;
  timeZone: typeof REPORT_TIME_ZONE;
}

export const spendingReportDrillDownSchema = z
  .strictObject({
    merchantFamily: merchantFamilySchema.optional(),
    accountId: reportIdentifierSchema.optional(),
    categoryId: reportIdentifierSchema.optional(),
    currency: currencyCodeSchema,
    dateFrom: calendarDateSchema,
    dateTo: calendarDateSchema,
    merchantMissing: z.literal(true).optional(),
    normalizedMerchant: z.string().min(1).max(256).optional(),
    reportMetric: z.literal("NET_SPENDING"),
  })
  .refine(
    (query) => !query.merchantFamily || (!query.merchantMissing && !query.normalizedMerchant),
    {
      message: "merchantFamily cannot be combined with another merchant filter.",
      path: ["merchantFamily"],
    },
  )
  .refine((query) => !query.merchantMissing || !query.normalizedMerchant, {
    message: "merchantMissing and normalizedMerchant are mutually exclusive.",
    path: ["merchantMissing"],
  });

export type SpendingReportDrillDown = z.infer<typeof spendingReportDrillDownSchema>;

const resolvedReportPeriodSchema = z.strictObject({
  dateFrom: calendarDateSchema,
  dateTo: calendarDateSchema,
  grain: z.enum(["MONTH", "QUARTER", "YEAR", "CUSTOM"]),
  label: z.string().min(1).max(64),
  timeZone: z.literal(REPORT_TIME_ZONE),
});

export const reportFreshnessSchema = z.object({ generatedAt: z.iso.datetime({ offset: true }) });

const categoryDistributionRowSchema = z.strictObject({
  categoryId: reportIdentifierSchema,
  categoryName: z.string().min(1).max(256),
  drillDown: spendingReportDrillDownSchema,
  netSpendingMinor: z.int(),
  transactionCount: z.int().positive(),
});

const merchantRankingRowSchema = z.strictObject({
  merchantFamily: merchantFamilySchema.optional(),
  drillDown: spendingReportDrillDownSchema,
  merchantName: z.string().min(1).max(512).nullable(),
  netSpendingMinor: z.int(),
  normalizedMerchant: z.string().min(1).max(256).nullable(),
  transactionCount: z.int().positive(),
});

export const spendingReportSectionSchema = z.strictObject({
  categoryDistribution: z.array(categoryDistributionRowSchema),
  currency: currencyCodeSchema,
  merchantGroupCount: z.int().nonnegative(),
  merchantRanking: z.array(merchantRankingRowSchema).max(100),
  netSpendingMinor: z.int(),
});

export type SpendingReportSection = z.infer<typeof spendingReportSectionSchema>;

export const spendingReportResponseSchema = z.strictObject({
  data: z.strictObject({ sections: z.array(spendingReportSectionSchema) }),
  meta: z.strictObject({
    freshness: reportFreshnessSchema,
    period: resolvedReportPeriodSchema,
    query: spendingReportQuerySchema,
  }),
});

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inclusiveCalendarDays(dateFrom: string, dateTo: string): number {
  const fromTime = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const toTime = Date.parse(`${dateTo}T00:00:00.000Z`);
  return Math.floor((toTime - fromTime) / 86_400_000) + 1;
}

export function resolveReportPeriod(input: unknown): ResolvedReportPeriod {
  const period = reportPeriodInputSchema.parse(input);
  if (period.grain === "CUSTOM") {
    const days = inclusiveCalendarDays(period.dateFrom, period.dateTo);
    if (days < 1 || days > MAX_CUSTOM_REPORT_DAYS) {
      throw new RangeError(`Custom report ranges must contain 1-${MAX_CUSTOM_REPORT_DAYS} days.`);
    }
    return {
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      grain: period.grain,
      label: `${period.dateFrom}/${period.dateTo}`,
      timeZone: REPORT_TIME_ZONE,
    };
  }

  const year = Number(period.period.slice(0, 4));
  if (period.grain === "YEAR") {
    return {
      dateFrom: `${period.period}-01-01`,
      dateTo: `${period.period}-12-31`,
      grain: period.grain,
      label: period.period,
      timeZone: REPORT_TIME_ZONE,
    };
  }
  if (period.grain === "QUARTER") {
    const quarter = Number(period.period.at(-1));
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      dateFrom: `${String(year).padStart(4, "0")}-${String(startMonth).padStart(2, "0")}-01`,
      dateTo: `${String(year).padStart(4, "0")}-${String(endMonth).padStart(2, "0")}-${lastDayOfMonth(year, endMonth)}`,
      grain: period.grain,
      label: period.period,
      timeZone: REPORT_TIME_ZONE,
    };
  }

  const month = Number(period.period.slice(5, 7));
  return {
    dateFrom: `${period.period}-01`,
    dateTo: `${period.period}-${lastDayOfMonth(year, month)}`,
    grain: period.grain,
    label: period.period,
    timeZone: REPORT_TIME_ZONE,
  };
}

function formatUtcDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function shiftCalendarYear(value: string, years: number): string {
  const source = new Date(`${value}T00:00:00.000Z`);
  const targetYear = source.getUTCFullYear() + years;
  const targetMonth = source.getUTCMonth() + 1;
  const targetDay = Math.min(source.getUTCDate(), lastDayOfMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(
    2,
    "0",
  )}-${String(targetDay).padStart(2, "0")}`;
}

export interface ReportComparisonPeriods {
  previousPeriod: ResolvedReportPeriod;
  previousYear: ResolvedReportPeriod;
}

export function resolveReportComparisonPeriods(
  current: ResolvedReportPeriod,
): ReportComparisonPeriods {
  if (current.grain === "MONTH") {
    const year = Number(current.label.slice(0, 4));
    const month = Number(current.label.slice(5, 7));
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousMonthYear = month === 1 ? year - 1 : year;
    return {
      previousPeriod: resolveReportPeriod({
        grain: "MONTH",
        period: `${String(previousMonthYear).padStart(4, "0")}-${String(previousMonth).padStart(
          2,
          "0",
        )}`,
      }),
      previousYear: resolveReportPeriod({
        grain: "MONTH",
        period: `${String(year - 1).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
      }),
    };
  }
  if (current.grain === "QUARTER") {
    const year = Number(current.label.slice(0, 4));
    const quarter = Number(current.label.at(-1));
    const previousQuarter = quarter === 1 ? 4 : quarter - 1;
    const previousQuarterYear = quarter === 1 ? year - 1 : year;
    return {
      previousPeriod: resolveReportPeriod({
        grain: "QUARTER",
        period: `${String(previousQuarterYear).padStart(4, "0")}-Q${previousQuarter}`,
      }),
      previousYear: resolveReportPeriod({
        grain: "QUARTER",
        period: `${String(year - 1).padStart(4, "0")}-Q${quarter}`,
      }),
    };
  }
  if (current.grain === "YEAR") {
    const previousYear = String(Number(current.label) - 1).padStart(4, "0");
    const previous = resolveReportPeriod({ grain: "YEAR", period: previousYear });
    return { previousPeriod: previous, previousYear: { ...previous } };
  }

  const days = inclusiveCalendarDays(current.dateFrom, current.dateTo);
  return {
    previousPeriod: resolveReportPeriod({
      dateFrom: addCalendarDays(current.dateFrom, -days),
      dateTo: addCalendarDays(current.dateFrom, -1),
      grain: "CUSTOM",
    }),
    previousYear: resolveReportPeriod({
      dateFrom: shiftCalendarYear(current.dateFrom, -1),
      dateTo: shiftCalendarYear(current.dateTo, -1),
      grain: "CUSTOM",
    }),
  };
}

export type ReportCategoryKind = "EXPENSE" | "INCOME" | "TRANSFER" | "UNCLASSIFIED";

export interface CashFlowCategoryInput {
  id: string;
  kind: ReportCategoryKind;
}

export interface CashFlowTransactionInput {
  amountMinor: number;
  categoryId: string | null;
  currency: string;
  direction: "INFLOW" | "OUTFLOW";
  id: string;
  postedDate: string;
  status: "PENDING" | "POSTED" | "REMOVED";
}

export interface CashFlowTransferMatchInput {
  leftTransactionId: string;
  rightTransactionId: string;
  status: "AUTO_CONFIRMED" | "BROKEN" | "CONFIRMED" | "IGNORED" | "PENDING_REVIEW";
}

export interface CalculateCashFlowInput {
  categories: CashFlowCategoryInput[];
  dateFrom: string;
  dateTo: string;
  transactions: CashFlowTransactionInput[];
  transferMatches: CashFlowTransferMatchInput[];
}

export interface CashFlowCurrencyResult {
  currency: string;
  incomeMinor: number;
  netCashFlowMinor: number;
  netSpendingMinor: number;
  transactionIds: string[];
}

export interface CashFlowReportResult {
  currencies: CashFlowCurrencyResult[];
  eligibleTransactionIds: string[];
}

export interface MetricComparisonResult {
  absoluteChangeMinor: number;
  currentMinor: number;
  percentageChangeBasisPoints: number | null;
  referenceMinor: number;
}

export interface CashFlowCurrencyComparisonResult {
  currency: string;
  income: MetricComparisonResult;
  netCashFlow: MetricComparisonResult;
  netSpending: MetricComparisonResult;
}

const metricComparisonSchema = z.strictObject({
  absoluteChangeMinor: z.int(),
  currentMinor: z.int(),
  percentageChangeBasisPoints: z.int().nullable(),
  referenceMinor: z.int(),
});

const cashFlowMetricsSchema = z.strictObject({
  incomeMinor: z.int(),
  netCashFlowMinor: z.int(),
  netSpendingMinor: z.int(),
});

const cashFlowComparisonSchema = z.strictObject({
  income: metricComparisonSchema,
  netCashFlow: metricComparisonSchema,
  netSpending: metricComparisonSchema,
});

export const cashFlowReportSectionSchema = z.strictObject({
  currency: currencyCodeSchema,
  current: cashFlowMetricsSchema,
  previousPeriod: cashFlowComparisonSchema,
  previousYear: cashFlowComparisonSchema,
});

export type CashFlowReportSection = z.infer<typeof cashFlowReportSectionSchema>;

export const cashFlowReportResponseSchema = z.strictObject({
  data: z.strictObject({ sections: z.array(cashFlowReportSectionSchema) }),
  meta: z.strictObject({
    freshness: reportFreshnessSchema,
    periods: z.strictObject({
      current: resolvedReportPeriodSchema,
      previousPeriod: resolvedReportPeriodSchema,
      previousYear: resolvedReportPeriodSchema,
    }),
    query: cashFlowReportQuerySchema,
  }),
});

function checkedAdd(current: number, delta: number): number {
  const result = current + delta;
  if (!Number.isSafeInteger(result)) throw new RangeError("Cash-flow total exceeds safe integers.");
  return result;
}

function roundedPercentageBasisPoints(delta: number, reference: number): number | null {
  if (reference === 0) return null;
  const numerator = BigInt(delta) * 10_000n;
  const denominator = BigInt(Math.abs(reference));
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= denominator) {
    quotient += numerator < 0n ? -1n : 1n;
  }
  const result = Number(quotient);
  if (!Number.isSafeInteger(result))
    throw new RangeError("Percentage change exceeds safe integers.");
  return result;
}

function compareMetric(current: number, reference: number): MetricComparisonResult {
  const absoluteChangeMinor = checkedAdd(current, -reference);
  return {
    absoluteChangeMinor,
    currentMinor: current,
    percentageChangeBasisPoints: roundedPercentageBasisPoints(absoluteChangeMinor, reference),
    referenceMinor: reference,
  };
}

export function compareCashFlowCurrencies(
  current: CashFlowCurrencyResult[],
  reference: CashFlowCurrencyResult[],
): CashFlowCurrencyComparisonResult[] {
  const currentByCurrency = new Map(current.map((section) => [section.currency, section]));
  const referenceByCurrency = new Map(reference.map((section) => [section.currency, section]));
  const currencies = [
    ...new Set([...currentByCurrency.keys(), ...referenceByCurrency.keys()]),
  ].sort((left, right) => left.localeCompare(right));
  return currencies.map((currency) => {
    const currentSection = currentByCurrency.get(currency);
    const referenceSection = referenceByCurrency.get(currency);
    return {
      currency,
      income: compareMetric(currentSection?.incomeMinor ?? 0, referenceSection?.incomeMinor ?? 0),
      netCashFlow: compareMetric(
        currentSection?.netCashFlowMinor ?? 0,
        referenceSection?.netCashFlowMinor ?? 0,
      ),
      netSpending: compareMetric(
        currentSection?.netSpendingMinor ?? 0,
        referenceSection?.netSpendingMinor ?? 0,
      ),
    };
  });
}

export function mergeCashFlowCurrencySections(
  current: CashFlowCurrencyResult[],
  previousPeriod: CashFlowCurrencyComparisonResult[],
  previousYear: CashFlowCurrencyComparisonResult[],
): CashFlowReportSection[] {
  const currentByCurrency = new Map(current.map((section) => [section.currency, section]));
  const previousPeriodByCurrency = new Map(
    previousPeriod.map((section) => [section.currency, section]),
  );
  const previousYearByCurrency = new Map(
    previousYear.map((section) => [section.currency, section]),
  );
  const currencies = [
    ...new Set([
      ...currentByCurrency.keys(),
      ...previousPeriodByCurrency.keys(),
      ...previousYearByCurrency.keys(),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const zeroComparison = (): CashFlowCurrencyComparisonResult => ({
    currency: "",
    income: compareMetric(0, 0),
    netCashFlow: compareMetric(0, 0),
    netSpending: compareMetric(0, 0),
  });
  return currencies.map((currency) => {
    const currentSection = currentByCurrency.get(currency);
    const previousPeriodSection = previousPeriodByCurrency.get(currency) ?? zeroComparison();
    const previousYearSection = previousYearByCurrency.get(currency) ?? zeroComparison();
    return {
      currency: currencyCodeSchema.parse(currency),
      current: {
        incomeMinor: currentSection?.incomeMinor ?? 0,
        netCashFlowMinor: currentSection?.netCashFlowMinor ?? 0,
        netSpendingMinor: currentSection?.netSpendingMinor ?? 0,
      },
      previousPeriod: {
        income: previousPeriodSection.income,
        netCashFlow: previousPeriodSection.netCashFlow,
        netSpending: previousPeriodSection.netSpending,
      },
      previousYear: {
        income: previousYearSection.income,
        netCashFlow: previousYearSection.netCashFlow,
        netSpending: previousYearSection.netSpending,
      },
    };
  });
}

export function calculateCashFlowReport(input: CalculateCashFlowInput): CashFlowReportResult {
  const dateFrom = calendarDateSchema.parse(input.dateFrom);
  const dateTo = calendarDateSchema.parse(input.dateTo);
  if (dateFrom > dateTo) throw new RangeError("dateFrom must not be after dateTo.");

  const categoryKinds = new Map(input.categories.map((category) => [category.id, category.kind]));
  const confirmedInternalTransactionIds = new Set<string>();
  for (const match of input.transferMatches) {
    if (match.status === "AUTO_CONFIRMED" || match.status === "CONFIRMED") {
      confirmedInternalTransactionIds.add(match.leftTransactionId);
      confirmedInternalTransactionIds.add(match.rightTransactionId);
    }
  }

  const eligibleTransactions = input.transactions.filter(
    (transaction) =>
      transaction.status === "POSTED" &&
      transaction.postedDate >= dateFrom &&
      transaction.postedDate <= dateTo &&
      !confirmedInternalTransactionIds.has(transaction.id),
  );
  const currencies = new Map<string, CashFlowCurrencyResult>();
  for (const transaction of eligibleTransactions) {
    if (!Number.isSafeInteger(transaction.amountMinor) || transaction.amountMinor < 0) {
      throw new RangeError("Report amounts must be non-negative safe integers.");
    }
    const section = currencies.get(transaction.currency) ?? {
      currency: transaction.currency,
      incomeMinor: 0,
      netCashFlowMinor: 0,
      netSpendingMinor: 0,
      transactionIds: [],
    };
    section.transactionIds.push(transaction.id);
    const categoryKind = transaction.categoryId
      ? categoryKinds.get(transaction.categoryId)
      : undefined;
    if (categoryKind === "INCOME") {
      section.incomeMinor = checkedAdd(
        section.incomeMinor,
        transaction.direction === "INFLOW" ? transaction.amountMinor : -transaction.amountMinor,
      );
    }
    if (categoryKind === "EXPENSE") {
      section.netSpendingMinor = checkedAdd(
        section.netSpendingMinor,
        transaction.direction === "OUTFLOW" ? transaction.amountMinor : -transaction.amountMinor,
      );
    }
    section.netCashFlowMinor = checkedAdd(section.incomeMinor, -section.netSpendingMinor);
    currencies.set(transaction.currency, section);
  }

  return {
    currencies: [...currencies.values()].sort((left, right) =>
      left.currency.localeCompare(right.currency),
    ),
    eligibleTransactionIds: eligibleTransactions.map(({ id }) => id),
  };
}
