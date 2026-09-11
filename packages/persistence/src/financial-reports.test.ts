import { describe, expect, it } from "vitest";

import { FinancialReportPersistenceError, FinancialReportRepository } from "./financial-reports";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function recordingDatabase({
  allError,
  batchResults = [],
  rows = [],
}: {
  allError?: Error;
  batchResults?: Array<{ results: unknown[] }>;
  rows?: unknown[];
} = {}) {
  const queries: RecordedQuery[] = [];
  const database = {
    batch() {
      return Promise.resolve(batchResults);
    },
    prepare(sql: string) {
      const query: RecordedQuery = { bindings: [], sql };
      queries.push(query);
      const statement = {
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return statement;
        },
        all() {
          return allError ? Promise.reject(allError) : Promise.resolve({ results: rows });
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { database, queries };
}

const ROWS = [
  {
    amount_minor: 500_000,
    category_id: "category-income",
    category_kind: "INCOME",
    currency: "CAD",
    direction: "INFLOW",
    id: "transaction-salary",
    posted_date: "2026-01-02",
  },
  {
    amount_minor: 5_000,
    category_id: "category-income",
    category_kind: "INCOME",
    currency: "CAD",
    direction: "OUTFLOW",
    id: "transaction-payroll-reversal",
    posted_date: "2026-01-03",
  },
  {
    amount_minor: 12_000,
    category_id: "category-expense",
    category_kind: "EXPENSE",
    currency: "CAD",
    direction: "OUTFLOW",
    id: "transaction-expense",
    posted_date: "2026-01-04",
  },
  {
    amount_minor: 2_000,
    category_id: "category-expense",
    category_kind: "EXPENSE",
    currency: "CAD",
    direction: "INFLOW",
    id: "transaction-refund",
    posted_date: "2026-01-05",
  },
  {
    amount_minor: 999,
    category_id: "category-unclassified",
    category_kind: "UNCLASSIFIED",
    currency: "CAD",
    direction: "OUTFLOW",
    id: "transaction-unclassified",
    posted_date: "2026-01-06",
  },
  {
    amount_minor: 25_000,
    category_id: "category-expense",
    category_kind: "EXPENSE",
    currency: "USD",
    direction: "OUTFLOW",
    id: "transaction-usd-expense",
    posted_date: "2026-01-07",
  },
];

const SPENDING_ROWS = [
  {
    account_id: "account-1",
    amount_minor: 12_000,
    category_id: "category-food",
    category_kind: "EXPENSE",
    category_name: "Food",
    currency: "CAD",
    direction: "OUTFLOW",
    id: "transaction-food",
    merchant_name: "Neighbourhood Market",
    normalized_merchant: "neighbourhood market",
    posted_date: "2026-01-04",
  },
  {
    account_id: "account-1",
    amount_minor: 2_000,
    category_id: "category-food",
    category_kind: "EXPENSE",
    category_name: "Food",
    currency: "CAD",
    direction: "INFLOW",
    id: "transaction-food-refund",
    merchant_name: "Neighbourhood Market",
    normalized_merchant: "neighbourhood market",
    posted_date: "2026-01-05",
  },
  {
    account_id: "account-1",
    amount_minor: 3_000,
    category_id: "category-transit",
    category_kind: "EXPENSE",
    category_name: "Transit",
    currency: "CAD",
    direction: "OUTFLOW",
    id: "transaction-transit",
    merchant_name: null,
    normalized_merchant: null,
    posted_date: "2026-01-06",
  },
  {
    account_id: "account-1",
    amount_minor: 500_000,
    category_id: "category-income",
    category_kind: "INCOME",
    category_name: "Salary",
    currency: "CAD",
    direction: "INFLOW",
    id: "transaction-income",
    merchant_name: "Employer",
    normalized_merchant: "employer",
    posted_date: "2026-01-02",
  },
];

describe("FinancialReportRepository", () => {
  it("combines merchant orders and branches but keeps different services separate", async () => {
    const merchants = [
      ["AMZN Mktp CA*ONE 866-216-1072", 2000, "OUTFLOW"],
      ["Amazon.ca*TWO 866-216-1072", 1500, "OUTFLOW"],
      ["AMZN Mktp CA*REFUND 866-216-1072", 500, "INFLOW"],
      ["Amazon.ca prime member amazon.ca/pri", 1000, "OUTFLOW"],
      ["T&T SUPERMARKET #038 TORONTO", 2000, "OUTFLOW"],
      ["T&T SUPERMARKET #032 TORONTO", 1000, "OUTFLOW"],
      ["UBER CANADA/UBEREATS TORONTO", 600, "OUTFLOW"],
      ["UBER CANADA/UBERTRIP TORONTO", 400, "OUTFLOW"],
      ["Amazonian Hotel", 300, "OUTFLOW"],
    ] as const;
    const recording = recordingDatabase({
      rows: merchants.map(([name, amount, direction], index) => ({
        ...SPENDING_ROWS[0],
        id: `family-${index}`,
        merchant_name: null,
        normalized_merchant: name.toLowerCase(),
        amount_minor: amount,
        direction,
      })),
    });
    const result = await new FinancialReportRepository(recording.database).spendingBreakdown({
      grain: "MONTH",
      period: "2026-01",
      merchantLimit: 20,
    });
    const section = result.sections[0]!;
    expect(section.merchantGroupCount).toBe(6);
    expect(section.merchantRanking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          merchantName: "Amazon",
          transactionCount: 3,
          netSpendingMinor: 3000,
          normalizedMerchant: null,
          merchantFamily: "amazon-shopping",
        }),
        expect.objectContaining({ merchantName: "Amazon Prime", transactionCount: 1 }),
        expect.objectContaining({
          merchantName: "T&T Supermarket",
          transactionCount: 2,
          netSpendingMinor: 3000,
        }),
        expect.objectContaining({ merchantName: "Uber Eats", transactionCount: 1 }),
        expect.objectContaining({ merchantName: "Uber", transactionCount: 1 }),
        expect.objectContaining({ normalizedMerchant: "amazonian hotel", transactionCount: 1 }),
      ]),
    );
    expect(section.merchantRanking.reduce((sum, row) => sum + row.netSpendingMinor, 0)).toBe(
      section.netSpendingMinor,
    );
  });
  it("queries one bounded eligible population and calculates currency sections", async () => {
    const recording = recordingDatabase({ rows: ROWS });
    const result = await new FinancialReportRepository(recording.database).cashFlow({
      grain: "MONTH",
      period: "2026-01",
    });

    expect(recording.queries).toHaveLength(1);
    expect(recording.queries[0]!.bindings).toEqual(["2026-01-01", "2026-01-31"]);
    expect(recording.queries[0]!.sql).toContain("transactions.status = 'POSTED'");
    expect(recording.queries[0]!.sql).toContain("transactions.posted_date BETWEEN ? AND ?");
    expect(recording.queries[0]!.sql).toContain(
      "left_match.status IN ('AUTO_CONFIRMED', 'CONFIRMED')",
    );
    expect(recording.queries[0]!.sql).toContain("left_match.left_transaction_id = transactions.id");
    expect(recording.queries[0]!.sql).toContain(
      "right_match.status IN ('AUTO_CONFIRMED', 'CONFIRMED')",
    );
    expect(recording.queries[0]!.sql).toContain(
      "right_match.right_transaction_id = transactions.id",
    );
    expect(recording.queries[0]!.sql).not.toContain("2026-01-01");
    expect(result.period).toMatchObject({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      grain: "MONTH",
      label: "2026-01",
      timeZone: "America/Toronto",
    });
    expect(result.currencies).toEqual([
      {
        currency: "CAD",
        incomeMinor: 495_000,
        netCashFlowMinor: 485_000,
        netSpendingMinor: 10_000,
        transactionIds: [
          "transaction-salary",
          "transaction-payroll-reversal",
          "transaction-expense",
          "transaction-refund",
          "transaction-unclassified",
        ],
      },
      {
        currency: "USD",
        incomeMinor: 0,
        netCashFlowMinor: -25_000,
        netSpendingMinor: 25_000,
        transactionIds: ["transaction-usd-expense"],
      },
    ]);
  });

  it("binds exact custom boundaries and rejects invalid input before preparing SQL", async () => {
    const valid = recordingDatabase();
    await new FinancialReportRepository(valid.database).cashFlow({
      dateFrom: "2026-01-01",
      dateTo: "2027-12-31",
      grain: "CUSTOM",
    });
    expect(valid.queries[0]!.bindings).toEqual(["2026-01-01", "2027-12-31"]);

    const invalid = recordingDatabase();
    await expect(
      new FinancialReportRepository(invalid.database).cashFlow({
        dateFrom: "2025-01-01",
        dateTo: "2027-01-01",
        grain: "CUSTOM",
      }),
    ).rejects.toBeInstanceOf(FinancialReportPersistenceError);
    expect(invalid.queries).toHaveLength(0);
  });

  it("maps database failures to a stable persistence error", async () => {
    const recording = recordingDatabase({ allError: new Error("database unavailable") });
    await expect(
      new FinancialReportRepository(recording.database).cashFlow({
        grain: "YEAR",
        period: "2026",
      }),
    ).rejects.toMatchObject({ code: "READ_FAILED" });
  });

  it("queries like-for-like reference periods in one batch and returns zero-baseline N/A", async () => {
    const recording = recordingDatabase({
      batchResults: [{ results: ROWS }, { results: [] }, { results: [] }],
    });
    const result = await new FinancialReportRepository(recording.database).cashFlowWithComparisons({
      grain: "MONTH",
      period: "2026-01",
    });

    expect(recording.queries.map(({ bindings }) => bindings)).toEqual([
      ["2026-01-01", "2026-01-31"],
      ["2025-12-01", "2025-12-31"],
      ["2025-01-01", "2025-01-31"],
    ]);
    expect(result.previousPeriod.period.label).toBe("2025-12");
    expect(result.previousYear.period.label).toBe("2025-01");
    expect(result.previousPeriod.comparisons).toMatchObject([
      {
        currency: "CAD",
        income: {
          absoluteChangeMinor: 495_000,
          percentageChangeBasisPoints: null,
          referenceMinor: 0,
        },
        netCashFlow: { percentageChangeBasisPoints: null },
        netSpending: { percentageChangeBasisPoints: null },
      },
      {
        currency: "USD",
        netCashFlow: {
          absoluteChangeMinor: -25_000,
          percentageChangeBasisPoints: null,
          referenceMinor: 0,
        },
      },
    ]);
  });

  it("applies identical prepared filters to current, previous-period, and previous-year queries", async () => {
    const recording = recordingDatabase({
      batchResults: [{ results: [] }, { results: [] }, { results: [] }],
    });
    const normalizedMerchant = "merchant' OR 1=1 --";
    await new FinancialReportRepository(recording.database).cashFlowWithComparisons({
      accountId: "account-1",
      categoryId: "category-food",
      currency: "USD",
      grain: "MONTH",
      normalizedMerchant,
      period: "2026-01",
    });

    expect(recording.queries).toHaveLength(3);
    expect(recording.queries.map(({ bindings }) => bindings)).toEqual([
      [
        "2026-01-01",
        "2026-01-31",
        "account-1",
        "account-1",
        "category-food",
        "USD",
        normalizedMerchant,
      ],
      [
        "2025-12-01",
        "2025-12-31",
        "account-1",
        "account-1",
        "category-food",
        "USD",
        normalizedMerchant,
      ],
      [
        "2025-01-01",
        "2025-01-31",
        "account-1",
        "account-1",
        "category-food",
        "USD",
        normalizedMerchant,
      ],
    ]);
    for (const query of recording.queries) {
      expect(query.sql).not.toContain(normalizedMerchant);
    }
  });

  it("builds reconciled category distribution, merchant ranking, and canonical drill-down keys", async () => {
    const recording = recordingDatabase({ rows: SPENDING_ROWS });
    const result = await new FinancialReportRepository(recording.database).spendingBreakdown({
      grain: "MONTH",
      merchantLimit: 2,
      period: "2026-01",
    });

    expect(result.period).toMatchObject({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      label: "2026-01",
    });
    expect(result.sections).toEqual([
      {
        categoryDistribution: [
          {
            categoryId: "category-food",
            categoryName: "Food",
            drillDown: {
              categoryId: "category-food",
              currency: "CAD",
              dateFrom: "2026-01-01",
              dateTo: "2026-01-31",
              reportMetric: "NET_SPENDING",
            },
            netSpendingMinor: 10_000,
            transactionCount: 2,
          },
          {
            categoryId: "category-transit",
            categoryName: "Transit",
            drillDown: {
              categoryId: "category-transit",
              currency: "CAD",
              dateFrom: "2026-01-01",
              dateTo: "2026-01-31",
              reportMetric: "NET_SPENDING",
            },
            netSpendingMinor: 3_000,
            transactionCount: 1,
          },
        ],
        currency: "CAD",
        merchantGroupCount: 2,
        merchantRanking: [
          {
            drillDown: {
              currency: "CAD",
              dateFrom: "2026-01-01",
              dateTo: "2026-01-31",
              normalizedMerchant: "neighbourhood market",
              reportMetric: "NET_SPENDING",
            },
            merchantName: "Neighbourhood Market",
            netSpendingMinor: 10_000,
            normalizedMerchant: "neighbourhood market",
            transactionCount: 2,
          },
          {
            drillDown: {
              currency: "CAD",
              dateFrom: "2026-01-01",
              dateTo: "2026-01-31",
              merchantMissing: true,
              reportMetric: "NET_SPENDING",
            },
            merchantName: null,
            netSpendingMinor: 3_000,
            normalizedMerchant: null,
            transactionCount: 1,
          },
        ],
        netSpendingMinor: 13_000,
      },
    ]);
    expect(
      result.sections[0]!.categoryDistribution.reduce((sum, row) => sum + row.netSpendingMinor, 0),
    ).toBe(result.sections[0]!.netSpendingMinor);
  });

  it("binds spending filters without allowing values to become SQL fragments", async () => {
    const recording = recordingDatabase();
    const normalizedMerchant = "merchant' OR 1=1 --";
    await new FinancialReportRepository(recording.database).spendingBreakdown({
      accountId: "account-1",
      categoryId: "category-food",
      currency: "CAD",
      grain: "MONTH",
      merchantLimit: 20,
      normalizedMerchant,
      period: "2026-01",
    });

    expect(recording.queries[0]!.sql).not.toContain(normalizedMerchant);
    expect(recording.queries[0]!.bindings).toEqual([
      "2026-01-01",
      "2026-01-31",
      "account-1",
      "account-1",
      "category-food",
      "CAD",
      normalizedMerchant,
    ]);
    expect(recording.queries[0]!.sql).toContain("transactions.normalized_merchant = ?");

    const invalid = recordingDatabase();
    await expect(
      new FinancialReportRepository(invalid.database).spendingBreakdown({
        grain: "MONTH",
        merchantLimit: 20,
        merchantMissing: true,
        normalizedMerchant: "acme",
        period: "2026-01",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(invalid.queries).toHaveLength(0);
  });
});
