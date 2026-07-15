const MAXIMUM_PAGE_CHANGES = 500;
const MAXIMUM_AMOUNT = 90_000_000_000_000;

export interface PlaidPaymentMetadata {
  byOrderOf: string | null;
  payee: string | null;
  payer: string | null;
  paymentMethod: string | null;
  paymentProcessor: string | null;
  ppdId: string | null;
  reason: string | null;
  referenceNumber: string | null;
}

export interface PlaidTransaction {
  accountId: string;
  amount: number;
  authorizedDate: string | null;
  date: string;
  isoCurrencyCode: string;
  merchantName: string | null;
  name: string;
  paymentMetadata: PlaidPaymentMetadata;
  pending: boolean;
  pendingTransactionId: string | null;
  transactionId: string;
}

export interface PlaidRemovedTransaction {
  accountId: string;
  transactionId: string;
}

export interface PlaidTransactionSyncPage {
  added: PlaidTransaction[];
  hasMore: boolean;
  modified: PlaidTransaction[];
  nextCursor: string;
  removed: PlaidRemovedTransaction[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximumLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    ? value
    : undefined;
}

function nullableBoundedString(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  return boundedString(value, maximumLength);
}

function optionalMetadataText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.length <= 256 ? value : undefined;
}

function calendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function parsePaymentMetadata(value: unknown): PlaidPaymentMetadata | undefined {
  const metadata = value === null || value === undefined ? {} : value;
  if (!isRecord(metadata)) return undefined;

  const parsed = {
    byOrderOf: optionalMetadataText(metadata.by_order_of),
    payee: optionalMetadataText(metadata.payee),
    payer: optionalMetadataText(metadata.payer),
    paymentMethod: optionalMetadataText(metadata.payment_method),
    paymentProcessor: optionalMetadataText(metadata.payment_processor),
    ppdId: optionalMetadataText(metadata.ppd_id),
    reason: optionalMetadataText(metadata.reason),
    referenceNumber: optionalMetadataText(metadata.reference_number),
  };
  return Object.values(parsed).some((field) => field === undefined)
    ? undefined
    : (parsed as PlaidPaymentMetadata);
}

function parseTransaction(value: unknown): PlaidTransaction | undefined {
  if (!isRecord(value)) return undefined;
  const accountId = boundedString(value.account_id, 160);
  const authorizedDate =
    value.authorized_date === null || value.authorized_date === undefined
      ? null
      : calendarDate(value.authorized_date);
  const date = calendarDate(value.date);
  const isoCurrencyCode = boundedString(value.iso_currency_code, 3);
  const merchantName = nullableBoundedString(value.merchant_name, 256);
  const name = boundedString(value.name, 512);
  const paymentMetadata = parsePaymentMetadata(value.payment_meta);
  const pendingTransactionId = nullableBoundedString(value.pending_transaction_id, 160);
  const transactionId = boundedString(value.transaction_id, 160);

  if (
    !accountId ||
    authorizedDate === undefined ||
    !date ||
    !isoCurrencyCode ||
    isoCurrencyCode !== isoCurrencyCode.toUpperCase() ||
    merchantName === undefined ||
    !name ||
    !paymentMetadata ||
    pendingTransactionId === undefined ||
    !transactionId ||
    typeof value.amount !== "number" ||
    !Number.isFinite(value.amount) ||
    Math.abs(value.amount) > MAXIMUM_AMOUNT ||
    typeof value.pending !== "boolean"
  ) {
    return undefined;
  }

  return {
    accountId,
    amount: value.amount,
    authorizedDate,
    date,
    isoCurrencyCode,
    merchantName,
    name,
    paymentMetadata,
    pending: value.pending,
    pendingTransactionId,
    transactionId,
  };
}

function parseRemovedTransaction(value: unknown): PlaidRemovedTransaction | undefined {
  if (!isRecord(value)) return undefined;
  const accountId = boundedString(value.account_id, 160);
  const transactionId = boundedString(value.transaction_id, 160);
  return accountId && transactionId ? { accountId, transactionId } : undefined;
}

function parseArray<T>(value: unknown, parser: (entry: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length > MAXIMUM_PAGE_CHANGES) return undefined;
  const parsed = value.map(parser);
  return parsed.some((entry) => entry === undefined) ? undefined : (parsed as T[]);
}

export function parseTransactionSyncResponse(value: unknown): PlaidTransactionSyncPage | undefined {
  if (!isRecord(value)) return undefined;
  const added = parseArray(value.added, parseTransaction);
  const modified = parseArray(value.modified, parseTransaction);
  const removed = parseArray(value.removed, parseRemovedTransaction);
  const nextCursor =
    typeof value.next_cursor === "string" && value.next_cursor.length <= 256
      ? value.next_cursor
      : undefined;

  if (
    !added ||
    !modified ||
    !removed ||
    nextCursor === undefined ||
    typeof value.has_more !== "boolean" ||
    !boundedString(value.request_id, 256) ||
    added.length + modified.length + removed.length > MAXIMUM_PAGE_CHANGES ||
    (value.has_more && nextCursor.length === 0)
  ) {
    return undefined;
  }

  return {
    added,
    hasMore: value.has_more,
    modified,
    nextCursor,
    removed,
  };
}
