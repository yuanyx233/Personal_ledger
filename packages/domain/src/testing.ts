import { calendarDateSchema } from "./api-contracts";

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

export interface PlaidTransactionFixture {
  account_id: string;
  amount: number;
  authorized_date: string | null;
  date: string;
  iso_currency_code: string | null;
  merchant_name: string | null;
  name: string;
  payment_meta: PlaidPaymentMetaFixture;
  pending: boolean;
  pending_transaction_id: string | null;
  transaction_id: string;
}

export type PlaidTransactionFixtureOverrides = Partial<
  Omit<PlaidTransactionFixture, "payment_meta">
> & {
  payment_meta?: Partial<PlaidPaymentMetaFixture>;
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

const PLAID_TRANSACTION_DEFAULTS: PlaidTransactionFixture = {
  account_id: "plaid-account-checking-1",
  amount: 12.34,
  authorized_date: "2026-01-14",
  date: "2026-01-15",
  iso_currency_code: "CAD",
  merchant_name: "Fixture Merchant",
  name: "Fixture purchase",
  payment_meta: PLAID_PAYMENT_META_DEFAULTS,
  pending: false,
  pending_transaction_id: null,
  transaction_id: "plaid-transaction-1",
};

export function createPlaidTransactionFixture(
  overrides: PlaidTransactionFixtureOverrides = {},
): PlaidTransactionFixture {
  return {
    ...PLAID_TRANSACTION_DEFAULTS,
    ...overrides,
    payment_meta: {
      ...PLAID_PAYMENT_META_DEFAULTS,
      ...overrides.payment_meta,
    },
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
