import { calendarDateSchema } from "./api-contracts";
import type { CanonicalImportRowCandidate, CsvImportColumnMapping } from "./csv-import";

export const DEFAULT_TEST_TIME_ZONE = "America/Toronto";
export const DEFAULT_TEST_INSTANT = "2026-02-01T05:00:00.000Z";

export interface TestClock {
  readonly timeZone: string;
  localDate(instant?: Date): string;
  now(): Date;
  nowIso(): string;
}

export interface FixedClockOptions {
  instant?: string | Date;
  timeZone?: string;
}

export function createFixedClock({
  instant = DEFAULT_TEST_INSTANT,
  timeZone = DEFAULT_TEST_TIME_ZONE,
}: FixedClockOptions = {}): TestClock {
  const fixedInstant = new Date(instant);
  if (Number.isNaN(fixedInstant.getTime())) {
    throw new RangeError("The fixed test instant must be a valid date.");
  }

  let dateFormatter: Intl.DateTimeFormat;
  try {
    dateFormatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    });
  } catch {
    throw new RangeError(`Unsupported test timezone: ${timeZone}`);
  }

  const fixedTime = fixedInstant.getTime();

  function localDate(value = new Date(fixedTime)): string {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError("The local date input must be a valid date.");
    }

    const parts = new Map(
      dateFormatter
        .formatToParts(value)
        .filter((part) => part.type === "day" || part.type === "month" || part.type === "year")
        .map((part) => [part.type, part.value]),
    );

    return calendarDateSchema.parse(
      `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
    );
  }

  return Object.freeze({
    timeZone: dateFormatter.resolvedOptions().timeZone,
    localDate,
    now: () => new Date(fixedTime),
    nowIso: () => new Date(fixedTime).toISOString(),
  });
}

export interface PlaidPaymentMetaFixture {
  by_order_of: string | null;
  payee: string | null;
  payer: string | null;
  payment_method: string | null;
  payment_processor: string | null;
  ppd_id: string | null;
  reason: string | null;
  reference_number: string | null;
}

export interface PlaidPersonalFinanceCategoryFixture {
  confidence_level: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | null;
  detailed: string;
  primary: string;
}

export interface PlaidTransactionFixture {
  account_id: string;
  amount: number;
  authorized_date: string | null;
  date: string;
  iso_currency_code: string | null;
  merchant_name: string | null;
  name: string;
  payment_meta: PlaidPaymentMetaFixture;
  personal_finance_category: PlaidPersonalFinanceCategoryFixture | null;
  pending: boolean;
  pending_transaction_id: string | null;
  transaction_id: string;
}

export type PlaidTransactionFixtureOverrides = Partial<
  Omit<PlaidTransactionFixture, "payment_meta" | "personal_finance_category">
> & {
  payment_meta?: Partial<PlaidPaymentMetaFixture>;
  personal_finance_category?: Partial<PlaidPersonalFinanceCategoryFixture> | null;
};

const PLAID_PAYMENT_META_DEFAULTS: PlaidPaymentMetaFixture = {
  by_order_of: null,
  payee: null,
  payer: null,
  payment_method: null,
  payment_processor: null,
  ppd_id: null,
  reason: null,
  reference_number: null,
};

const PLAID_PFC_DEFAULTS: PlaidPersonalFinanceCategoryFixture = {
  confidence_level: "VERY_HIGH",
  detailed: "GENERAL_MERCHANDISE_SUPERSTORES",
  primary: "GENERAL_MERCHANDISE",
};

const PLAID_TRANSACTION_DEFAULTS: PlaidTransactionFixture = {
  account_id: "plaid-account-checking-1",
  amount: 12.34,
  authorized_date: "2026-01-14",
  date: "2026-01-15",
  iso_currency_code: "CAD",
  merchant_name: "Fixture Merchant",
  name: "Fixture purchase",
  payment_meta: PLAID_PAYMENT_META_DEFAULTS,
  personal_finance_category: null,
  pending: false,
  pending_transaction_id: null,
  transaction_id: "plaid-transaction-1",
};

export function createPlaidTransactionFixture(
  overrides: PlaidTransactionFixtureOverrides = {},
): PlaidTransactionFixture {
  const { payment_meta, personal_finance_category, ...fields } = overrides;
  return {
    ...PLAID_TRANSACTION_DEFAULTS,
    ...fields,
    payment_meta: {
      ...PLAID_PAYMENT_META_DEFAULTS,
      ...payment_meta,
    },
    personal_finance_category:
      personal_finance_category === undefined
        ? PLAID_TRANSACTION_DEFAULTS.personal_finance_category
        : personal_finance_category === null
          ? null
          : { ...PLAID_PFC_DEFAULTS, ...personal_finance_category },
  };
}

export type LedgerSource = "PLAID" | "MANUAL" | "CSV";
export type LedgerStatus = "PENDING" | "POSTED" | "REMOVED";
export type LedgerDirection = "INFLOW" | "OUTFLOW";
export type CategorizationSource = "MANUAL" | "RULE" | "PLAID" | "UNCLASSIFIED";

export interface LedgerTransactionFixture {
  accountId: string;
  amountMinor: number;
  authorizedDate: string | null;
  categorizationSource: CategorizationSource;
  categoryId: string | null;
  createdAt: string;
  currency: string;
  description: string;
  direction: LedgerDirection;
  id: string;
  merchantName: string | null;
  needsReview: boolean;
  pendingPlaidTransactionId: string | null;
  plaidTransactionId: string | null;
  postedDate: string;
  source: LedgerSource;
  status: LedgerStatus;
  updatedAt: string;
  version: number;
}

const LEDGER_TRANSACTION_DEFAULTS: LedgerTransactionFixture = {
  accountId: "account-checking-1",
  amountMinor: 1234,
  authorizedDate: "2026-01-14",
  categorizationSource: "PLAID",
  categoryId: "category-shopping",
  createdAt: "2026-01-15T15:00:00.000Z",
  currency: "CAD",
  description: "Fixture purchase",
  direction: "OUTFLOW",
  id: "ledger-transaction-1",
  merchantName: "Fixture Merchant",
  needsReview: false,
  pendingPlaidTransactionId: null,
  plaidTransactionId: "plaid-transaction-1",
  postedDate: "2026-01-15",
  source: "PLAID",
  status: "POSTED",
  updatedAt: "2026-01-15T15:00:00.000Z",
  version: 1,
};

export function createLedgerTransactionFixture(
  overrides: Partial<LedgerTransactionFixture> = {},
): LedgerTransactionFixture {
  return { ...LEDGER_TRANSACTION_DEFAULTS, ...overrides };
}

export interface ImportRowInputFixture {
  account: string;
  amount: string;
  currency: string;
  date: string;
  description: string;
  direction: string;
}

export interface ImportRowFixture {
  canonicalFingerprint: string | null;
  errors: string[];
  raw: ImportRowInputFixture;
  rowNumber: number;
  status: "VALID" | "INVALID" | "DUPLICATE";
}

export type ImportRowFixtureOverrides = Partial<Omit<ImportRowFixture, "errors" | "raw">> & {
  errors?: string[];
  raw?: Partial<ImportRowInputFixture>;
};

const IMPORT_ROW_INPUT_DEFAULTS: ImportRowInputFixture = {
  account: "Daily Chequing",
  amount: "12.34",
  currency: "CAD",
  date: "2026-01-15",
  description: "Fixture transaction",
  direction: "OUTFLOW",
};

const IMPORT_ROW_DEFAULTS: ImportRowFixture = {
  canonicalFingerprint: "fixture-fingerprint-1",
  errors: [],
  raw: IMPORT_ROW_INPUT_DEFAULTS,
  rowNumber: 2,
  status: "VALID",
};

export function createImportRowFixture(
  overrides: ImportRowFixtureOverrides = {},
): ImportRowFixture {
  return {
    ...IMPORT_ROW_DEFAULTS,
    ...overrides,
    errors: [...(overrides.errors ?? IMPORT_ROW_DEFAULTS.errors)],
    raw: { ...IMPORT_ROW_INPUT_DEFAULTS, ...overrides.raw },
  };
}

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

export interface ReportFixture {
  currency: string;
  endDate: string;
  generatedAt: string;
  startDate: string;
  timeZone: string;
  transactions: LedgerTransactionFixture[];
}

const REPORT_DEFAULTS: ReportFixture = {
  currency: "CAD",
  endDate: "2026-01-31",
  generatedAt: DEFAULT_TEST_INSTANT,
  startDate: "2026-01-01",
  timeZone: DEFAULT_TEST_TIME_ZONE,
  transactions: [LEDGER_TRANSACTION_DEFAULTS],
};

export function createReportFixture(overrides: Partial<ReportFixture> = {}): ReportFixture {
  return {
    ...REPORT_DEFAULTS,
    ...overrides,
    transactions: (overrides.transactions ?? REPORT_DEFAULTS.transactions).map((transaction) => ({
      ...transaction,
    })),
  };
}

export interface ReportCategoryFixture {
  id: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER" | "UNCLASSIFIED";
  name: string;
}

export interface ReportTransferMatchFixture {
  id: string;
  leftTransactionId: string;
  rightTransactionId: string;
  status: "CONFIRMED";
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
      confirmedInternalTransfer: string[];
      pending: string[];
      removed: string[];
    };
    months: ReportPeriodExpectationFixture[];
    quarter: ReportPeriodExpectationFixture;
  };
  generatedAt: string;
  startDate: string;
  timeZone: string;
  transactions: LedgerTransactionFixture[];
  transferMatches: ReportTransferMatchFixture[];
}

const RECONCILED_REPORT_CATEGORIES: ReportCategoryFixture[] = [
  { id: "report-category-income", kind: "INCOME", name: "Report income" },
  { id: "report-category-expense", kind: "EXPENSE", name: "Report expense" },
  { id: "report-category-transfer", kind: "TRANSFER", name: "Report transfer" },
];

function reportTransaction(
  id: string,
  overrides: Partial<LedgerTransactionFixture>,
): LedgerTransactionFixture {
  return createLedgerTransactionFixture({
    authorizedDate: null,
    categorizationSource: "PLAID",
    createdAt: DEFAULT_TEST_INSTANT,
    description: id,
    id,
    merchantName: id,
    needsReview: false,
    plaidTransactionId: `plaid-${id}`,
    updatedAt: DEFAULT_TEST_INSTANT,
    ...overrides,
  });
}

const RECONCILED_REPORT_TRANSACTIONS: LedgerTransactionFixture[] = [
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
    plaidTransactionId: null,
    postedDate: "2026-01-12",
    source: "MANUAL",
  }),
  reportTransaction("report-cad-csv-income", {
    amountMinor: 4_000,
    categorizationSource: "MANUAL",
    categoryId: "report-category-income",
    direction: "INFLOW",
    plaidTransactionId: null,
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
    accountId: "account-credit-card-1",
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
    plaidTransactionId: null,
    postedDate: "2026-03-01",
    source: "MANUAL",
  }),
];

const RECONCILED_REPORT_TRANSFER_MATCHES: ReportTransferMatchFixture[] = [
  {
    id: "report-transfer-match-1",
    leftTransactionId: "report-transfer-inflow",
    rightTransactionId: "report-transfer-outflow",
    status: "CONFIRMED",
  },
];

const RECONCILED_REPORT_EXPECTED: ReconciledReportFixture["expected"] = {
  eligibleTransactionIds: [
    "report-cad-salary",
    "report-cad-payroll-reversal",
    "report-cad-groceries",
    "report-cad-expense-refund",
    "report-cad-manual-expense",
    "report-cad-csv-income",
    "report-usd-salary",
    "report-usd-expense",
    "report-usd-expense-refund",
    "report-march-manual-expense",
  ],
  excludedTransactionIds: {
    confirmedInternalTransfer: ["report-transfer-inflow", "report-transfer-outflow"],
    pending: ["report-december-pending", "report-january-pending"],
    removed: ["report-january-removed"],
  },
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
        confirmedInternalTransfer: [
          ...RECONCILED_REPORT_EXPECTED.excludedTransactionIds.confirmedInternalTransfer,
        ],
        pending: [...RECONCILED_REPORT_EXPECTED.excludedTransactionIds.pending],
        removed: [...RECONCILED_REPORT_EXPECTED.excludedTransactionIds.removed],
      },
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
    generatedAt: DEFAULT_TEST_INSTANT,
    startDate: "2025-12-01",
    timeZone: DEFAULT_TEST_TIME_ZONE,
    transactions: RECONCILED_REPORT_TRANSACTIONS.map((transaction) => ({ ...transaction })),
    transferMatches: RECONCILED_REPORT_TRANSFER_MATCHES.map((match) => ({ ...match })),
  };
}
