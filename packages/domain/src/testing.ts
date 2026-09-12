import type { CanonicalImportRowCandidate, CsvImportColumnMapping } from "./csv-import";

const TEST_TIME_ZONE = "America/Toronto";
const TEST_INSTANT = "2026-02-01T05:00:00.000Z";

export interface HostileCsvFixtures {
  exactRepeats: Uint8Array;
  formulas: Uint8Array;
  invalidUtf8: Uint8Array;
  invalidValues: Uint8Array;
  mapping: CsvImportColumnMapping;
  oversizedColumns: Uint8Array;
  oversizedFile: Uint8Array;
  oversizedRows: Uint8Array;
  quotedDelimiter: Uint8Array;
  suspectedDuplicate: {
    csv: Uint8Array;
    existing: CanonicalImportRowCandidate;
  };
  utf8Bom: Uint8Array;
}

const CSV_FIXTURE_HEADER = "Date,Description,Amount,Direction,Currency,Account,Merchant,Category";

function encodeCsvFixture(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatenateBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function createHostileCsvFixtures(): HostileCsvFixtures {
  const validRow = "2026-01-15,Fixture transaction,12.34,OUTFLOW,CAD,Daily Chequing,,";
  const mapping: CsvImportColumnMapping = {
    accountLabel: "Account",
    amount: "Amount",
    category: "Category",
    currency: "Currency",
    description: "Description",
    direction: "Direction",
    merchant: "Merchant",
    postedDate: "Date",
  };

  return {
    exactRepeats: encodeCsvFixture(
      `${CSV_FIXTURE_HEADER}\n2026-01-15,Repeat purchase,12.34,OUTFLOW,CAD,Daily Chequing,,\n2026-01-15,Repeat purchase,12.34,OUTFLOW,CAD,Daily Chequing,,`,
    ),
    formulas: encodeCsvFixture(
      `${CSV_FIXTURE_HEADER}\n2026-01-15,"=HYPERLINK(""https://evil.invalid"",""click"")",12.34,OUTFLOW,CAD,Daily Chequing,,\n2026-01-16,"+SUM(1,1)",12.34,OUTFLOW,CAD,Daily Chequing,,\n2026-01-17,"@SUM(1,1)",12.34,OUTFLOW,CAD,Daily Chequing,,`,
    ),
    invalidUtf8: concatenateBytes(
      encodeCsvFixture(`${CSV_FIXTURE_HEADER}\n2026-01-15,`),
      new Uint8Array([0xc3, 0x28]),
      encodeCsvFixture(",12.34,OUTFLOW,CAD,Daily Chequing,,"),
    ),
    invalidValues: encodeCsvFixture(
      `${CSV_FIXTURE_HEADER}\n2026-02-29,Bad date,12.34,OUTFLOW,CAD,Daily Chequing,,\n2026-01-15,Bad amount,12.345,OUTFLOW,CAD,Daily Chequing,,\n2026-01-15,Bad currency,12.34,OUTFLOW,EUR,Daily Chequing,,`,
    ),
    mapping,
    oversizedColumns: encodeCsvFixture(
      `${Array.from({ length: 33 }, (_, index) => `Column${index + 1}`).join(",")}\n${Array.from({ length: 33 }, () => "value").join(",")}`,
    ),
    oversizedFile: new Uint8Array(5 * 1024 * 1024 + 1).fill(0x78),
    oversizedRows: encodeCsvFixture(
      `${CSV_FIXTURE_HEADER}\n${Array.from({ length: 4_001 }, () => validRow).join("\n")}`,
    ),
    quotedDelimiter: encodeCsvFixture(
      `${CSV_FIXTURE_HEADER}\n2026-01-15,"Neighbourhood, Market",12.34,OUTFLOW,CAD,Daily Chequing,,`,
    ),
    suspectedDuplicate: {
      csv: encodeCsvFixture(`${CSV_FIXTURE_HEADER}\n${validRow}`),
      existing: {
        accountLabel: "Daily Chequing",
        amountMinor: 1234,
        currency: "CAD",
        description: "Fixture transaction",
        direction: "OUTFLOW",
        postedDate: "2026-01-15",
      },
    },
    utf8Bom: concatenateBytes(
      new Uint8Array([0xef, 0xbb, 0xbf]),
      encodeCsvFixture(`${CSV_FIXTURE_HEADER}\n${validRow}`),
    ),
  };
}

export interface ReportCategoryFixture {
  id: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER" | "UNCLASSIFIED";
  name: string;
}

export interface ReportTransactionFixture {
  amountMinor: number;
  categorizationSource: "MANUAL" | "RULE" | "PLAID" | "UNCLASSIFIED";
  categoryId: string | null;
  createdAt: string;
  currency: string;
  description: string;
  direction: "INFLOW" | "OUTFLOW";
  id: string;
  merchantName: string | null;
  needsReview: boolean;
  postedDate: string;
  source: "PLAID" | "MANUAL" | "CSV";
  status: "PENDING" | "POSTED" | "REMOVED";
  updatedAt: string;
  version: number;
}

export interface ReportCurrencyMetricsFixture {
  currency: string;
  incomeMinor: number;
  netCashFlowMinor: number;
  netSpendingMinor: number;
  transactionIds: string[];
}

export interface ReportPeriodExpectationFixture {
  currencies: ReportCurrencyMetricsFixture[];
  period: string;
}

export interface ReconciledReportFixture {
  categories: ReportCategoryFixture[];
  endDate: string;
  expected: {
    eligibleTransactionIds: string[];
    excludedTransactionIds: {
      pending: string[];
      removed: string[];
    };
    // Present in the population but contributing nothing, because their category kind is TRANSFER.
    internalTransferTransactionIds: string[];
    months: ReportPeriodExpectationFixture[];
    quarter: ReportPeriodExpectationFixture;
  };
  generatedAt: string;
  startDate: string;
  timeZone: string;
  transactions: ReportTransactionFixture[];
}

const RECONCILED_REPORT_CATEGORIES: ReportCategoryFixture[] = [
  { id: "report-category-income", kind: "INCOME", name: "Report income" },
  { id: "report-category-expense", kind: "EXPENSE", name: "Report expense" },
  { id: "report-category-transfer", kind: "TRANSFER", name: "Report transfer" },
];

function reportTransaction(
  id: string,
  overrides: Partial<ReportTransactionFixture>,
): ReportTransactionFixture {
  return {
    amountMinor: 1234,
    categorizationSource: "RULE",
    categoryId: "report-category-expense",
    createdAt: TEST_INSTANT,
    currency: "CAD",
    description: id,
    direction: "OUTFLOW",
    id,
    merchantName: id,
    needsReview: false,
    postedDate: "2026-01-15",
    source: "CSV",
    status: "POSTED",
    updatedAt: TEST_INSTANT,
    version: 1,
    ...overrides,
  };
}

const RECONCILED_REPORT_TRANSACTIONS: ReportTransactionFixture[] = [
  reportTransaction("report-december-pending", {
    amountMinor: 7_000,
    categoryId: "report-category-expense",
    direction: "OUTFLOW",
    postedDate: "2025-12-20",
    status: "PENDING",
  }),
  reportTransaction("report-cad-salary", {
    amountMinor: 500_000,
    categoryId: "report-category-income",
    direction: "INFLOW",
    postedDate: "2026-01-02",
  }),
  reportTransaction("report-cad-payroll-reversal", {
    amountMinor: 5_000,
    categoryId: "report-category-income",
    direction: "OUTFLOW",
    postedDate: "2026-01-03",
  }),
  reportTransaction("report-cad-groceries", {
    amountMinor: 12_000,
    categoryId: "report-category-expense",
    direction: "OUTFLOW",
    postedDate: "2026-01-05",
  }),
  reportTransaction("report-cad-expense-refund", {
    amountMinor: 2_000,
    categoryId: "report-category-expense",
    direction: "INFLOW",
    postedDate: "2026-01-10",
  }),
  reportTransaction("report-cad-manual-expense", {
    amountMinor: 3_000,
    categorizationSource: "MANUAL",
    categoryId: "report-category-expense",
    direction: "OUTFLOW",
    postedDate: "2026-01-12",
    source: "MANUAL",
  }),
  reportTransaction("report-cad-csv-income", {
    amountMinor: 4_000,
    categorizationSource: "MANUAL",
    categoryId: "report-category-income",
    direction: "INFLOW",
    postedDate: "2026-01-13",
    source: "CSV",
  }),
  reportTransaction("report-transfer-outflow", {
    amountMinor: 75_000,
    categoryId: "report-category-transfer",
    direction: "OUTFLOW",
    postedDate: "2026-01-15",
  }),
  reportTransaction("report-transfer-inflow", {
    amountMinor: 75_000,
    categoryId: "report-category-transfer",
    direction: "INFLOW",
    postedDate: "2026-01-16",
  }),
  reportTransaction("report-january-pending", {
    amountMinor: 9_999,
    categoryId: "report-category-expense",
    direction: "OUTFLOW",
    postedDate: "2026-01-20",
    status: "PENDING",
  }),
  reportTransaction("report-january-removed", {
    amountMinor: 8_888,
    categoryId: "report-category-expense",
    direction: "OUTFLOW",
    postedDate: "2026-01-21",
    status: "REMOVED",
  }),
  reportTransaction("report-usd-salary", {
    amountMinor: 100_000,
    categoryId: "report-category-income",
    currency: "USD",
    direction: "INFLOW",
    postedDate: "2026-01-04",
  }),
  reportTransaction("report-usd-expense", {
    amountMinor: 25_000,
    categoryId: "report-category-expense",
    currency: "USD",
    direction: "OUTFLOW",
    postedDate: "2026-01-08",
  }),
  reportTransaction("report-usd-expense-refund", {
    amountMinor: 5_000,
    categoryId: "report-category-expense",
    currency: "USD",
    direction: "INFLOW",
    postedDate: "2026-01-09",
  }),
  reportTransaction("report-march-manual-expense", {
    amountMinor: 6_000,
    categorizationSource: "MANUAL",
    categoryId: "report-category-expense",
    direction: "OUTFLOW",
    postedDate: "2026-03-01",
    source: "MANUAL",
  }),
];

const RECONCILED_REPORT_EXPECTED: ReconciledReportFixture["expected"] = {
  eligibleTransactionIds: [
    "report-cad-salary",
    "report-cad-payroll-reversal",
    "report-cad-groceries",
    "report-cad-expense-refund",
    "report-cad-manual-expense",
    "report-cad-csv-income",
    "report-transfer-outflow",
    "report-transfer-inflow",
    "report-usd-salary",
    "report-usd-expense",
    "report-usd-expense-refund",
    "report-march-manual-expense",
  ],
  excludedTransactionIds: {
    pending: ["report-december-pending", "report-january-pending"],
    removed: ["report-january-removed"],
  },
  internalTransferTransactionIds: ["report-transfer-outflow", "report-transfer-inflow"],
  months: [
    {
      currencies: [
        {
          currency: "CAD",
          incomeMinor: 0,
          netCashFlowMinor: 0,
          netSpendingMinor: 0,
          transactionIds: [],
        },
        {
          currency: "USD",
          incomeMinor: 0,
          netCashFlowMinor: 0,
          netSpendingMinor: 0,
          transactionIds: [],
        },
      ],
      period: "2025-12",
    },
    {
      currencies: [
        {
          currency: "CAD",
          incomeMinor: 499_000,
          netCashFlowMinor: 486_000,
          netSpendingMinor: 13_000,
          transactionIds: [
            "report-cad-salary",
            "report-cad-payroll-reversal",
            "report-cad-groceries",
            "report-cad-expense-refund",
            "report-cad-manual-expense",
            "report-cad-csv-income",
            "report-transfer-outflow",
            "report-transfer-inflow",
          ],
        },
        {
          currency: "USD",
          incomeMinor: 100_000,
          netCashFlowMinor: 80_000,
          netSpendingMinor: 20_000,
          transactionIds: ["report-usd-salary", "report-usd-expense", "report-usd-expense-refund"],
        },
      ],
      period: "2026-01",
    },
    {
      currencies: [
        {
          currency: "CAD",
          incomeMinor: 0,
          netCashFlowMinor: 0,
          netSpendingMinor: 0,
          transactionIds: [],
        },
        {
          currency: "USD",
          incomeMinor: 0,
          netCashFlowMinor: 0,
          netSpendingMinor: 0,
          transactionIds: [],
        },
      ],
      period: "2026-02",
    },
    {
      currencies: [
        {
          currency: "CAD",
          incomeMinor: 0,
          netCashFlowMinor: -6_000,
          netSpendingMinor: 6_000,
          transactionIds: ["report-march-manual-expense"],
        },
        {
          currency: "USD",
          incomeMinor: 0,
          netCashFlowMinor: 0,
          netSpendingMinor: 0,
          transactionIds: [],
        },
      ],
      period: "2026-03",
    },
  ],
  quarter: {
    currencies: [
      {
        currency: "CAD",
        incomeMinor: 499_000,
        netCashFlowMinor: 480_000,
        netSpendingMinor: 19_000,
        transactionIds: [
          "report-cad-salary",
          "report-cad-payroll-reversal",
          "report-cad-groceries",
          "report-cad-expense-refund",
          "report-cad-manual-expense",
          "report-cad-csv-income",
          "report-transfer-outflow",
          "report-transfer-inflow",
          "report-march-manual-expense",
        ],
      },
      {
        currency: "USD",
        incomeMinor: 100_000,
        netCashFlowMinor: 80_000,
        netSpendingMinor: 20_000,
        transactionIds: ["report-usd-salary", "report-usd-expense", "report-usd-expense-refund"],
      },
    ],
    period: "2026-Q1",
  },
};

export function createReconciledReportFixture(): ReconciledReportFixture {
  return {
    categories: RECONCILED_REPORT_CATEGORIES.map((category) => ({ ...category })),
    endDate: "2026-03-31",
    expected: {
      eligibleTransactionIds: [...RECONCILED_REPORT_EXPECTED.eligibleTransactionIds],
      excludedTransactionIds: {
        pending: [...RECONCILED_REPORT_EXPECTED.excludedTransactionIds.pending],
        removed: [...RECONCILED_REPORT_EXPECTED.excludedTransactionIds.removed],
      },
      internalTransferTransactionIds: [
        ...RECONCILED_REPORT_EXPECTED.internalTransferTransactionIds,
      ],
      months: RECONCILED_REPORT_EXPECTED.months.map((month) => ({
        currencies: month.currencies.map((currency) => ({
          ...currency,
          transactionIds: [...currency.transactionIds],
        })),
        period: month.period,
      })),
      quarter: {
        currencies: RECONCILED_REPORT_EXPECTED.quarter.currencies.map((currency) => ({
          ...currency,
          transactionIds: [...currency.transactionIds],
        })),
        period: RECONCILED_REPORT_EXPECTED.quarter.period,
      },
    },
    generatedAt: TEST_INSTANT,
    startDate: "2025-12-01",
    timeZone: TEST_TIME_ZONE,
    transactions: RECONCILED_REPORT_TRANSACTIONS.map((transaction) => ({ ...transaction })),
  };
}
