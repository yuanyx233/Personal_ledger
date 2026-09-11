import {
  calculateCashFlowReport,
  cashFlowReportPeriodInput,
  cashFlowReportQuerySchema,
  compareCashFlowCurrencies,
  reportMerchantFamily,
  type MerchantFamily,
  resolveReportComparisonPeriods,
  resolveReportPeriod,
  spendingReportPeriodInput,
  spendingReportQuerySchema,
  type CashFlowCurrencyComparisonResult,
  type CashFlowCurrencyResult,
  type CashFlowReportQuery,
  type ReportCategoryKind,
  type ReportPeriodInput,
  type ResolvedReportPeriod,
  type SpendingReportDrillDown,
  type SpendingReportQuery,
  type SpendingReportSection,
} from "@ledger/domain";
import { calendarDateSchema, currencyCodeSchema } from "@ledger/domain/api-contracts";

interface FinancialReportRow {
  account_id: string;
  amount_minor: number;
  category_id: string | null;
  category_kind: ReportCategoryKind | null;
  category_name: string | null;
  currency: string;
  direction: "INFLOW" | "OUTFLOW";
  id: string;
  merchant_name: string | null;
  normalized_merchant: string | null;
  posted_date: string;
}

interface FinancialReportFilters {
  accountId?: string | undefined;
  categoryId?: string | undefined;
  currency?: string | undefined;
  merchantMissing?: true | undefined;
  normalizedMerchant?: string | undefined;
}

export interface FinancialCashFlowResult {
  currencies: CashFlowCurrencyResult[];
  eligibleTransactionIds: string[];
  period: ResolvedReportPeriod;
}

export interface FinancialCashFlowReferenceResult extends FinancialCashFlowResult {
  comparisons: CashFlowCurrencyComparisonResult[];
}

export interface FinancialCashFlowWithComparisonsResult {
  current: FinancialCashFlowResult;
  previousPeriod: FinancialCashFlowReferenceResult;
  previousYear: FinancialCashFlowReferenceResult;
}

export interface FinancialSpendingReportResult {
  period: ResolvedReportPeriod;
  sections: SpendingReportSection[];
}

export type FinancialReportPersistenceErrorCode = "INVALID_INPUT" | "READ_FAILED";

export class FinancialReportPersistenceError extends Error {
  constructor(readonly code: FinancialReportPersistenceErrorCode) {
    super(code);
    this.name = "FinancialReportPersistenceError";
  }
}

export class FinancialReportRepository {
  constructor(private readonly database: D1Database) {}

  private queryStatement(
    period: ResolvedReportPeriod,
    filters: FinancialReportFilters = {},
  ): D1PreparedStatement {
    const conditions = [
      "transactions.status = 'POSTED'",
      "transactions.posted_date BETWEEN ? AND ?",
      `NOT EXISTS (
        SELECT 1 FROM transfer_matches AS left_match
        WHERE left_match.status IN ('AUTO_CONFIRMED', 'CONFIRMED')
          AND left_match.left_transaction_id = transactions.id
      )`,
      `NOT EXISTS (
        SELECT 1 FROM transfer_matches AS right_match
        WHERE right_match.status IN ('AUTO_CONFIRMED', 'CONFIRMED')
          AND right_match.right_transaction_id = transactions.id
      )`,
    ];
    const bindings: string[] = [period.dateFrom, period.dateTo];
    const addFilter = (condition: string, ...values: string[]) => {
      conditions.push(condition);
      bindings.push(...values);
    };
    if (filters.accountId)
      addFilter(
        "(transactions.account_id = ? OR transactions.account_label = ?)",
        filters.accountId,
        filters.accountId,
      );
    if (filters.categoryId) addFilter("transactions.category_id = ?", filters.categoryId);
    if (filters.currency) addFilter("transactions.currency = ?", filters.currency);
    if (filters.normalizedMerchant) {
      addFilter("transactions.normalized_merchant = ?", filters.normalizedMerchant);
    }
    if (filters.merchantMissing) conditions.push("transactions.normalized_merchant IS NULL");

    return this.database
      .prepare(
        `SELECT
           transactions.id,
           transactions.account_id,
           transactions.posted_date,
           transactions.amount_minor - transactions.reimbursement_minor AS amount_minor,
           transactions.direction,
           transactions.currency,
           transactions.category_id,
           transactions.merchant_name,
           transactions.normalized_merchant,
           categories.kind AS category_kind,
           categories.name AS category_name
         FROM transactions
         LEFT JOIN categories ON categories.id = transactions.category_id
         WHERE ${conditions.join("\n           AND ")}
         ORDER BY transactions.posted_date, transactions.id`,
      )
      .bind(...bindings);
  }

  private spendingSections(
    period: ResolvedReportPeriod,
    query: SpendingReportQuery,
    rows: FinancialReportRow[],
  ): SpendingReportSection[] {
    interface MutableGroup {
      netSpendingMinor: number;
      transactionCount: number;
    }
    interface MutableCategory extends MutableGroup {
      categoryId: string;
      categoryName: string;
    }
    interface MutableMerchant extends MutableGroup {
      merchantFamily?: MerchantFamily;
      merchantName: string | null;
      normalizedMerchant: string | null;
    }
    interface MutableSection {
      categories: Map<string, MutableCategory>;
      merchants: Map<string, MutableMerchant>;
      netSpendingMinor: number;
    }

    const checkedAdd = (current: number, delta: number): number => {
      const result = current + delta;
      if (!Number.isSafeInteger(result))
        throw new RangeError("Report total exceeds safe integers.");
      return result;
    };
    const drillDown = (currency: string): SpendingReportDrillDown => {
      const keys: SpendingReportDrillDown = {
        currency: currencyCodeSchema.parse(currency),
        dateFrom: calendarDateSchema.parse(period.dateFrom),
        dateTo: calendarDateSchema.parse(period.dateTo),
        reportMetric: "NET_SPENDING",
      };
      if (query.accountId) keys.accountId = query.accountId;
      if (query.categoryId) keys.categoryId = query.categoryId;
      if (query.normalizedMerchant) keys.normalizedMerchant = query.normalizedMerchant;
      if (query.merchantMissing) keys.merchantMissing = true;
      return keys;
    };

    const sections = new Map<string, MutableSection>();
    for (const row of rows) {
      if (row.category_kind !== "EXPENSE") continue;
      if (
        row.category_id === null ||
        row.category_name === null ||
        !Number.isSafeInteger(row.amount_minor) ||
        row.amount_minor < 0
      ) {
        throw new RangeError("Invalid spending report row.");
      }
      const delta = row.direction === "OUTFLOW" ? row.amount_minor : -row.amount_minor;
      const section = sections.get(row.currency) ?? {
        categories: new Map<string, MutableCategory>(),
        merchants: new Map<string, MutableMerchant>(),
        netSpendingMinor: 0,
      };
      section.netSpendingMinor = checkedAdd(section.netSpendingMinor, delta);

      const category = section.categories.get(row.category_id) ?? {
        categoryId: row.category_id,
        categoryName: row.category_name,
        netSpendingMinor: 0,
        transactionCount: 0,
      };
      category.netSpendingMinor = checkedAdd(category.netSpendingMinor, delta);
      category.transactionCount += 1;
      section.categories.set(row.category_id, category);

      const family = query.normalizedMerchant
        ? null
        : reportMerchantFamily(row.normalized_merchant);
      const merchantKey = family
        ? `\u0000family:${family.key}`
        : (row.normalized_merchant ?? "\u0000missing");
      const merchant = section.merchants.get(merchantKey) ?? {
        ...(family ? { merchantFamily: family.key } : {}),
        merchantName: family?.displayName ?? row.merchant_name,
        netSpendingMinor: 0,
        normalizedMerchant: family ? null : row.normalized_merchant,
        transactionCount: 0,
      };
      if (
        !family &&
        row.merchant_name !== null &&
        (merchant.merchantName === null ||
          row.merchant_name.localeCompare(merchant.merchantName) < 0)
      ) {
        merchant.merchantName = row.merchant_name;
      }
      merchant.netSpendingMinor = checkedAdd(merchant.netSpendingMinor, delta);
      merchant.transactionCount += 1;
      section.merchants.set(merchantKey, merchant);
      sections.set(row.currency, section);
    }

    const byAmountThenKey =
      <T extends MutableGroup>(key: (value: T) => string): ((left: T, right: T) => number) =>
      (left, right) => {
        if (left.netSpendingMinor !== right.netSpendingMinor) {
          return left.netSpendingMinor > right.netSpendingMinor ? -1 : 1;
        }
        return key(left).localeCompare(key(right));
      };

    return [...sections.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, section]) => {
        const categoryDistribution = [...section.categories.values()]
          .sort(byAmountThenKey((category) => category.categoryId))
          .map((category) => ({
            ...category,
            drillDown: { ...drillDown(currency), categoryId: category.categoryId },
          }));
        const merchantGroups = [...section.merchants.values()].sort(
          byAmountThenKey(
            (merchant) => merchant.merchantFamily ?? merchant.normalizedMerchant ?? "\uffff",
          ),
        );
        const merchantRanking = merchantGroups.slice(0, query.merchantLimit).map((merchant) => {
          const keys = drillDown(currency);
          delete keys.merchantMissing;
          delete keys.normalizedMerchant;
          if (merchant.merchantFamily) keys.merchantFamily = merchant.merchantFamily;
          else if (merchant.normalizedMerchant === null) keys.merchantMissing = true;
          else keys.normalizedMerchant = merchant.normalizedMerchant;
          return { ...merchant, drillDown: keys };
        });
        return {
          categoryDistribution,
          currency: currencyCodeSchema.parse(currency),
          merchantGroupCount: merchantGroups.length,
          merchantRanking,
          netSpendingMinor: section.netSpendingMinor,
        };
      });
  }

  private reportFromRows(
    period: ResolvedReportPeriod,
    rows: FinancialReportRow[],
  ): FinancialCashFlowResult {
    const categories = new Map<string, ReportCategoryKind>();
    for (const row of rows) {
      if (row.category_id !== null && row.category_kind !== null) {
        categories.set(row.category_id, row.category_kind);
      }
    }
    const report = calculateCashFlowReport({
      categories: [...categories].map(([id, kind]) => ({ id, kind })),
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      transactions: rows.map((row) => ({
        amountMinor: row.amount_minor,
        categoryId: row.category_id,
        currency: row.currency,
        direction: row.direction,
        id: row.id,
        postedDate: row.posted_date,
        status: "POSTED" as const,
      })),
      transferMatches: [],
    });
    return { ...report, period };
  }

  async cashFlow(input: unknown): Promise<FinancialCashFlowResult> {
    let query: CashFlowReportQuery;
    let period: ResolvedReportPeriod;
    try {
      query = cashFlowReportQuerySchema.parse(input);
      period = resolveReportPeriod(cashFlowReportPeriodInput(query));
    } catch {
      throw new FinancialReportPersistenceError("INVALID_INPUT");
    }

    try {
      const result = await this.queryStatement(period, query).all<FinancialReportRow>();
      return this.reportFromRows(period, result.results);
    } catch (error) {
      if (error instanceof FinancialReportPersistenceError) throw error;
      throw new FinancialReportPersistenceError("READ_FAILED");
    }
  }

  async cashFlowWithComparisons(input: unknown): Promise<FinancialCashFlowWithComparisonsResult> {
    let query: CashFlowReportQuery;
    let currentPeriod: ResolvedReportPeriod;
    let comparisonPeriods: ReturnType<typeof resolveReportComparisonPeriods>;
    try {
      query = cashFlowReportQuerySchema.parse(input);
      currentPeriod = resolveReportPeriod(cashFlowReportPeriodInput(query));
      comparisonPeriods = resolveReportComparisonPeriods(currentPeriod);
    } catch {
      throw new FinancialReportPersistenceError("INVALID_INPUT");
    }

    try {
      const results = await this.database.batch<FinancialReportRow>([
        this.queryStatement(currentPeriod, query),
        this.queryStatement(comparisonPeriods.previousPeriod, query),
        this.queryStatement(comparisonPeriods.previousYear, query),
      ]);
      const currentResult = results[0];
      const previousPeriodResult = results[1];
      const previousYearResult = results[2];
      if (!currentResult || !previousPeriodResult || !previousYearResult) {
        throw new FinancialReportPersistenceError("READ_FAILED");
      }
      const current = this.reportFromRows(currentPeriod, currentResult.results);
      const previousPeriod = this.reportFromRows(
        comparisonPeriods.previousPeriod,
        previousPeriodResult.results,
      );
      const previousYear = this.reportFromRows(
        comparisonPeriods.previousYear,
        previousYearResult.results,
      );
      return {
        current,
        previousPeriod: {
          ...previousPeriod,
          comparisons: compareCashFlowCurrencies(current.currencies, previousPeriod.currencies),
        },
        previousYear: {
          ...previousYear,
          comparisons: compareCashFlowCurrencies(current.currencies, previousYear.currencies),
        },
      };
    } catch (error) {
      if (error instanceof FinancialReportPersistenceError) throw error;
      throw new FinancialReportPersistenceError("READ_FAILED");
    }
  }

  async spendingBreakdown(input: unknown): Promise<FinancialSpendingReportResult> {
    let query: SpendingReportQuery;
    let period: ResolvedReportPeriod;
    try {
      query = spendingReportQuerySchema.parse(input);
      period = resolveReportPeriod(spendingReportPeriodInput(query));
    } catch {
      throw new FinancialReportPersistenceError("INVALID_INPUT");
    }

    try {
      const result = await this.queryStatement(period, query).all<FinancialReportRow>();
      return { period, sections: this.spendingSections(period, query, result.results) };
    } catch (error) {
      if (error instanceof FinancialReportPersistenceError) throw error;
      throw new FinancialReportPersistenceError("READ_FAILED");
    }
  }
}

export type { ReportPeriodInput };
