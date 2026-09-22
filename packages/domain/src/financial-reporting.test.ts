import { describe, expect, it } from "vitest";

import {
  cashFlowReportResponseSchema,
  calculateCashFlowReport,
  compareCashFlowCurrencies,
  mergeCashFlowCurrencySections,
  parseCashFlowReportQuery,
  parseSpendingReportQuery,
  resolveReportComparisonPeriods,
  resolveReportPeriod,
  spendingReportResponseSchema,
} from "./financial-reporting";
import { createReconciledReportFixture } from "./testing";

describe("cash-flow reporting semantics", () => {
  it("uses one posted eligible population and lets transfer categories contribute nothing", () => {
    const fixture = createReconciledReportFixture();
    const report = calculateCashFlowReport({
      categories: fixture.categories,
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
      transactions: fixture.transactions,
    });

    expect(report.eligibleTransactionIds).toEqual(fixture.expected.eligibleTransactionIds);
    const excluded = fixture.expected.excludedTransactionIds;
    for (const id of [...excluded.pending, ...excluded.removed]) {
      expect(report.eligibleTransactionIds).not.toContain(id);
    }
    for (const id of fixture.expected.internalTransferTransactionIds) {
      expect(report.eligibleTransactionIds).toContain(id);
    }
  });

  it("calculates exact income, net spending, and net cash flow independently by currency", () => {
    const fixture = createReconciledReportFixture();
    const report = calculateCashFlowReport({
      categories: fixture.categories,
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      transactions: fixture.transactions,
    });
    const expectedJanuary = fixture.expected.months.find(({ period }) => period === "2026-01")!;

    expect(report.currencies).toEqual(expectedJanuary.currencies);
    for (const currency of report.currencies) {
      expect(currency.netCashFlowMinor).toBe(currency.incomeMinor - currency.netSpendingMinor);
    }
    expect(report.currencies.find(({ currency }) => currency === "CAD")).toMatchObject({
      incomeMinor: 500_000 - 5_000 + 4_000,
      netSpendingMinor: 12_000 - 2_000 + 3_000,
    });
    expect(report.currencies.find(({ currency }) => currency === "USD")).toMatchObject({
      incomeMinor: 100_000,
      netSpendingMinor: 25_000 - 5_000,
    });
  });

  it("returns an empty population for an empty calendar month", () => {
    const fixture = createReconciledReportFixture();

    expect(
      calculateCashFlowReport({
        categories: fixture.categories,
        dateFrom: "2026-02-01",
        dateTo: "2026-02-28",
        transactions: fixture.transactions,
      }),
    ).toEqual({ currencies: [], eligibleTransactionIds: [] });
  });
});

describe("Toronto report period boundaries", () => {
  it.each([
    [
      { grain: "MONTH", period: "2024-02" },
      { dateFrom: "2024-02-01", dateTo: "2024-02-29", label: "2024-02" },
    ],
    [
      { grain: "QUARTER", period: "2026-Q4" },
      { dateFrom: "2026-10-01", dateTo: "2026-12-31", label: "2026-Q4" },
    ],
    [
      { grain: "YEAR", period: "2026" },
      { dateFrom: "2026-01-01", dateTo: "2026-12-31", label: "2026" },
    ],
    [
      { dateFrom: "2026-01-01", dateTo: "2027-12-31", grain: "CUSTOM" },
      { dateFrom: "2026-01-01", dateTo: "2027-12-31", label: "2026-01-01/2027-12-31" },
    ],
  ] as const)("resolves %o to inclusive date-only boundaries", (input, expected) => {
    expect(resolveReportPeriod(input)).toMatchObject({
      ...expected,
      grain: input.grain,
    });
  });

  it.each([
    { grain: "MONTH", period: "2026-13" },
    { grain: "QUARTER", period: "2026-Q5" },
    { grain: "YEAR", period: "26" },
    { dateFrom: "2026-02-01", dateTo: "2026-01-31", grain: "CUSTOM" },
    { dateFrom: "2025-01-01", dateTo: "2027-01-01", grain: "CUSTOM" },
    { dateFrom: "2026-01-01", dateTo: "2026-01-31", grain: "MONTH" },
  ])("rejects unsafe or mismatched period input %#", (input) => {
    expect(() => resolveReportPeriod(input)).toThrow();
  });

  it("resolves previous-period and previous-year ranges without UTC clock dependence", () => {
    const january = resolveReportPeriod({ grain: "MONTH", period: "2026-01" });
    expect(resolveReportComparisonPeriods(january)).toEqual({
      previousPeriod: {
        dateFrom: "2025-12-01",
        dateTo: "2025-12-31",
        grain: "MONTH",
        label: "2025-12",
      },
      previousYear: {
        dateFrom: "2025-01-01",
        dateTo: "2025-01-31",
        grain: "MONTH",
        label: "2025-01",
      },
    });

    const custom = resolveReportPeriod({
      dateFrom: "2024-02-29",
      dateTo: "2024-03-02",
      grain: "CUSTOM",
    });
    expect(resolveReportComparisonPeriods(custom)).toMatchObject({
      previousPeriod: { dateFrom: "2024-02-26", dateTo: "2024-02-28" },
      previousYear: { dateFrom: "2023-02-28", dateTo: "2023-03-02" },
    });
  });

  it("carries no time zone, because period resolution is pure calendar arithmetic", () => {
    const period = resolveReportPeriod({ grain: "MONTH", period: "2026-01" });
    expect(period).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      grain: "MONTH",
      label: "2026-01",
    });
    expect(Object.keys(period)).not.toContain("timeZone");
  });
});

describe("cash-flow comparisons", () => {
  it("returns exact absolute changes and integer basis points across currency unions", () => {
    const comparisons = compareCashFlowCurrencies(
      [
        {
          currency: "CAD",
          incomeMinor: 150,
          netCashFlowMinor: 100,
          netSpendingMinor: 50,
          transactionIds: [],
        },
        {
          currency: "USD",
          incomeMinor: 0,
          netCashFlowMinor: -25,
          netSpendingMinor: 25,
          transactionIds: [],
        },
      ],
      [
        {
          currency: "CAD",
          incomeMinor: 100,
          netCashFlowMinor: 50,
          netSpendingMinor: 50,
          transactionIds: [],
        },
        {
          currency: "EUR",
          incomeMinor: 20,
          netCashFlowMinor: 20,
          netSpendingMinor: 0,
          transactionIds: [],
        },
      ],
    );

    expect(comparisons).toEqual([
      {
        currency: "CAD",
        income: {
          absoluteChangeMinor: 50,
          currentMinor: 150,
          percentageChangeBasisPoints: 5_000,
          referenceMinor: 100,
        },
        netCashFlow: {
          absoluteChangeMinor: 50,
          currentMinor: 100,
          percentageChangeBasisPoints: 10_000,
          referenceMinor: 50,
        },
        netSpending: {
          absoluteChangeMinor: 0,
          currentMinor: 50,
          percentageChangeBasisPoints: 0,
          referenceMinor: 50,
        },
      },
      {
        currency: "EUR",
        income: {
          absoluteChangeMinor: -20,
          currentMinor: 0,
          percentageChangeBasisPoints: -10_000,
          referenceMinor: 20,
        },
        netCashFlow: {
          absoluteChangeMinor: -20,
          currentMinor: 0,
          percentageChangeBasisPoints: -10_000,
          referenceMinor: 20,
        },
        netSpending: {
          absoluteChangeMinor: 0,
          currentMinor: 0,
          percentageChangeBasisPoints: null,
          referenceMinor: 0,
        },
      },
      {
        currency: "USD",
        income: {
          absoluteChangeMinor: 0,
          currentMinor: 0,
          percentageChangeBasisPoints: null,
          referenceMinor: 0,
        },
        netCashFlow: {
          absoluteChangeMinor: -25,
          currentMinor: -25,
          percentageChangeBasisPoints: null,
          referenceMinor: 0,
        },
        netSpending: {
          absoluteChangeMinor: 25,
          currentMinor: 25,
          percentageChangeBasisPoints: null,
          referenceMinor: 0,
        },
      },
    ]);
  });

  it("uses the absolute signed baseline and rounds percentage basis points", () => {
    expect(
      compareCashFlowCurrencies(
        [
          {
            currency: "CAD",
            incomeMinor: 0,
            netCashFlowMinor: 1,
            netSpendingMinor: -2,
            transactionIds: [],
          },
        ],
        [
          {
            currency: "CAD",
            incomeMinor: 0,
            netCashFlowMinor: -3,
            netSpendingMinor: -3,
            transactionIds: [],
          },
        ],
      )[0],
    ).toMatchObject({
      income: { percentageChangeBasisPoints: null },
      netCashFlow: {
        absoluteChangeMinor: 4,
        percentageChangeBasisPoints: 13_333,
        referenceMinor: -3,
      },
      netSpending: {
        absoluteChangeMinor: 1,
        percentageChangeBasisPoints: 3_333,
        referenceMinor: -3,
      },
    });
  });
});

describe("spending report API contract", () => {
  it("parses one strict natural-period query with bounded filters", () => {
    expect(
      parseSpendingReportQuery(
        new URLSearchParams(
          "grain=MONTH&period=2026-01&accountId=account-1&categoryId=category-food&currency=CAD&normalizedMerchant=neighbourhood+market&merchantLimit=25",
        ),
      ),
    ).toEqual({
      accountId: "account-1",
      categoryId: "category-food",
      currency: "CAD",
      grain: "MONTH",
      merchantLimit: 25,
      normalizedMerchant: "neighbourhood market",
      period: "2026-01",
    });
    expect(
      parseSpendingReportQuery(
        new URLSearchParams(
          "grain=CUSTOM&dateFrom=2026-01-01&dateTo=2026-01-31&merchantMissing=true",
        ),
      ),
    ).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      grain: "CUSTOM",
      merchantLimit: 20,
      merchantMissing: true,
    });
  });

  it.each([
    "grain=MONTH&period=2026-01&dateFrom=2026-01-01",
    "grain=CUSTOM&dateFrom=2026-01-01&dateTo=2028-01-01",
    "grain=MONTH&period=2026-01&merchantLimit=101",
    "grain=MONTH&period=2026-01&merchantMissing=false",
    "grain=MONTH&period=2026-01&merchantMissing=true&normalizedMerchant=acme",
    "grain=MONTH&period=2026-01&currency=cad",
    "grain=MONTH&period=2026-01&merchantLimit=2&merchantLimit=3",
    "grain=MONTH&period=2026-01&unsafeWhere=1%3D1",
  ])("rejects unsafe or ambiguous spending query %#", (query) => {
    expect(() => parseSpendingReportQuery(new URLSearchParams(query))).toThrow();
  });

  it("validates signed minor-unit rows and canonical drill-down keys", () => {
    const drillDown = {
      accountId: "account-1",
      categoryId: "category-food",
      currency: "CAD",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      reportMetric: "NET_SPENDING",
    } as const;
    const response = {
      data: {
        sections: [
          {
            categoryDistribution: [
              {
                categoryId: "category-food",
                categoryName: "Food",
                drillDown,
                netSpendingMinor: -200,
                transactionCount: 2,
              },
            ],
            currency: "CAD",
            merchantGroupCount: 1,
            merchantRanking: [
              {
                drillDown: { ...drillDown, normalizedMerchant: "neighbourhood market" },
                merchantName: "Neighbourhood Market",
                netSpendingMinor: -200,
                normalizedMerchant: "neighbourhood market",
                transactionCount: 2,
              },
            ],
            netSpendingMinor: -200,
          },
        ],
      },
      meta: {
        freshness: {
          generatedAt: "2026-01-31T12:00:00.000Z",
        },
        period: {
          dateFrom: "2026-01-01",
          dateTo: "2026-01-31",
          grain: "MONTH",
          label: "2026-01",
        },
        query: { grain: "MONTH", merchantLimit: 20, period: "2026-01" },
      },
    } as const;

    expect(spendingReportResponseSchema.parse(response)).toEqual(response);
    expect(
      spendingReportResponseSchema.safeParse({
        ...response,
        data: {
          sections: [
            {
              ...response.data.sections[0],
              merchantRanking: [
                { ...response.data.sections[0].merchantRanking[0], reportTotal: "forged" },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});

describe("cash-flow report API contract", () => {
  it("parses the same strict period and report filters without a ranking limit", () => {
    expect(
      parseCashFlowReportQuery(
        new URLSearchParams(
          "grain=QUARTER&period=2026-Q1&accountId=account-1&categoryId=category-food&currency=USD&normalizedMerchant=usd+store",
        ),
      ),
    ).toEqual({
      accountId: "account-1",
      categoryId: "category-food",
      currency: "USD",
      grain: "QUARTER",
      normalizedMerchant: "usd store",
      period: "2026-Q1",
    });
    for (const query of [
      "grain=MONTH&period=2026-01&merchantLimit=20",
      "grain=YEAR&period=2026&period=2025",
      "grain=CUSTOM&dateFrom=2026-01-01&dateTo=2028-01-01",
      "grain=MONTH&period=2026-01&merchantMissing=true&normalizedMerchant=acme",
    ]) {
      expect(() => parseCashFlowReportQuery(new URLSearchParams(query))).toThrow();
    }
  });

  it("merges currency unions into explicit sections without a cross-currency total", () => {
    const current = [
      {
        currency: "CAD",
        incomeMinor: 100,
        netCashFlowMinor: 60,
        netSpendingMinor: 40,
        transactionIds: ["cad-current"],
      },
      {
        currency: "USD",
        incomeMinor: 50,
        netCashFlowMinor: 30,
        netSpendingMinor: 20,
        transactionIds: ["usd-current"],
      },
    ];
    const previousPeriod = compareCashFlowCurrencies(current, []);
    const previousYear = compareCashFlowCurrencies(current, [
      {
        currency: "EUR",
        incomeMinor: 10,
        netCashFlowMinor: 10,
        netSpendingMinor: 0,
        transactionIds: ["eur-reference"],
      },
    ]);

    const sections = mergeCashFlowCurrencySections(current, previousPeriod, previousYear);
    expect(sections.map(({ currency }) => currency)).toEqual(["CAD", "EUR", "USD"]);
    expect(sections.find(({ currency }) => currency === "CAD")).toMatchObject({
      current: { incomeMinor: 100, netCashFlowMinor: 60, netSpendingMinor: 40 },
      previousPeriod: { income: { referenceMinor: 0 } },
    });
    expect(sections.find(({ currency }) => currency === "EUR")).toMatchObject({
      current: { incomeMinor: 0, netCashFlowMinor: 0, netSpendingMinor: 0 },
      previousYear: { income: { currentMinor: 0, referenceMinor: 10 } },
    });
    expect(JSON.stringify(sections)).not.toContain("grandTotal");
    expect(JSON.stringify(sections)).not.toContain("combinedTotal");
  });

  it("validates a section-only cash-flow response envelope", () => {
    const currentPeriod = {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      grain: "MONTH",
      label: "2026-01",
    } as const;
    const comparison = {
      absoluteChangeMinor: 100,
      currentMinor: 100,
      percentageChangeBasisPoints: null,
      referenceMinor: 0,
    };
    const response = {
      data: {
        sections: [
          {
            currency: "CAD",
            current: { incomeMinor: 100, netCashFlowMinor: 60, netSpendingMinor: 40 },
            previousPeriod: {
              income: comparison,
              netCashFlow: { ...comparison, absoluteChangeMinor: 60, currentMinor: 60 },
              netSpending: { ...comparison, absoluteChangeMinor: 40, currentMinor: 40 },
            },
            previousYear: {
              income: comparison,
              netCashFlow: { ...comparison, absoluteChangeMinor: 60, currentMinor: 60 },
              netSpending: { ...comparison, absoluteChangeMinor: 40, currentMinor: 40 },
            },
          },
        ],
      },
      meta: {
        freshness: {
          generatedAt: "2026-01-31T12:00:00.000Z",
        },
        periods: {
          current: currentPeriod,
          previousPeriod: {
            ...currentPeriod,
            dateFrom: "2025-12-01",
            dateTo: "2025-12-31",
            label: "2025-12",
          },
          previousYear: {
            ...currentPeriod,
            dateFrom: "2025-01-01",
            dateTo: "2025-01-31",
            label: "2025-01",
          },
        },
        query: { grain: "MONTH", period: "2026-01" },
      },
    } as const;

    expect(cashFlowReportResponseSchema.parse(response)).toEqual(response);
    expect(
      cashFlowReportResponseSchema.safeParse({
        ...response,
        data: { ...response.data, grandTotalMinor: 160 },
      }).success,
    ).toBe(false);
  });
});
