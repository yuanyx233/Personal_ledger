export const TRANSACTION_CSV_EXPORT_LIMITS = {
  BYTES: 16 * 1024 * 1024,
  ROWS: 10_000,
} as const;

export const TRANSACTION_CSV_HEADERS = [
  "transaction_id",
  "posted_date",
  "authorized_date",
  "status",
  "direction",
  "amount_minor",
  "amount",
  "currency",
  "account_id",
  "account",
  "description",
  "merchant",
  "normalized_merchant",
  "category_id",
  "category",
  "categorization_source",
  "category_rule_id",
  "category_rule_merchant",
  "plaid_pfc_primary",
  "plaid_pfc_detailed",
  "plaid_pfc_confidence",
  "source",
  "needs_review",
  "review_reason",
  "subscription_id",
  "subscription_scheduled_date",
  "bank_confirmation",
  "import_match_count",
  "reimbursement_minor",
  "personal_amount_minor",
] as const;

export type TransactionCsvExportErrorCode = "OUTPUT_TOO_LARGE" | "ROW_LIMIT_EXCEEDED";

export class TransactionCsvExportError extends Error {
  constructor(readonly code: TransactionCsvExportErrorCode) {
    super(code);
    this.name = "TransactionCsvExportError";
  }
}

export interface TransactionCsvRow {
  accountId: string | null;
  accountLabel: string;
  amountMinor: number;
  reimbursementMinor?: number;
  authorizedDate: string | null;
  categorizationSource: "MANUAL" | "RULE" | "PLAID" | "UNCLASSIFIED";
  categoryId: string | null;
  categoryName: string | null;
  categoryRuleDisplayMerchant: string | null;
  categoryRuleId: string | null;
  currency: string;
  description: string;
  direction: "INFLOW" | "OUTFLOW";
  id: string;
  merchantName: string | null;
  needsReview: boolean;
  normalizedMerchant: string | null;
  plaidPfcConfidence: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | null;
  plaidPfcDetailed: string | null;
  plaidPfcPrimary: string | null;
  postedDate: string;
  reviewReason: string | null;
  source: "PLAID" | "MANUAL" | "CSV";
  status: "PENDING" | "POSTED" | "REMOVED";
  subscriptionId: string | null;
  subscriptionScheduledDate: string | null;
  bankConfirmation: "NONE" | "IMPORTED" | "AUTO_MERGED" | "OWNER_MERGED";
  importMatchCount: number;
}

const SPREADSHEET_FORMULA_MARKER = /^[=+\-@\t\r]/;

export function neutralizeSpreadsheetText(value: string): string {
  if (value.startsWith("'")) return `'${value}`;
  return SPREADSHEET_FORMULA_MARKER.test(value) ? `'${value}` : value;
}

export function restoreSpreadsheetText(value: string): string {
  if (value.startsWith("''")) return value.slice(1);
  if (value.startsWith("'") && SPREADSHEET_FORMULA_MARKER.test(value.slice(1))) {
    return value.slice(1);
  }
  return value;
}

export function minorUnitsToCsvDecimal(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new TypeError("amountMinor must be a non-negative safe integer.");
  }
  const whole = Math.floor(amountMinor / 100);
  const fractional = String(amountMinor % 100).padStart(2, "0");
  return `${whole}.${fractional}`;
}

function serializeCsvCell(value: string): string {
  const neutralized = neutralizeSpreadsheetText(value);
  return /[",\r\n]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

function cell(value: string | null): string {
  return serializeCsvCell(value ?? "");
}

function serializeRow(row: TransactionCsvRow): string {
  return [
    row.id,
    row.postedDate,
    row.authorizedDate,
    row.status,
    row.direction,
    String(row.amountMinor),
    minorUnitsToCsvDecimal(row.amountMinor),
    row.currency,
    row.accountId,
    row.accountLabel,
    row.description,
    row.merchantName,
    row.normalizedMerchant,
    row.categoryId,
    row.categoryName,
    row.categorizationSource,
    row.categoryRuleId,
    row.categoryRuleDisplayMerchant,
    row.plaidPfcPrimary,
    row.plaidPfcDetailed,
    row.plaidPfcConfidence,
    row.source,
    row.needsReview ? "true" : "false",
    row.reviewReason,
    row.subscriptionId,
    row.subscriptionScheduledDate,
    row.bankConfirmation,
    String(row.importMatchCount),
    String(row.reimbursementMinor ?? 0),
    String(row.amountMinor - (row.reimbursementMinor ?? 0)),
  ]
    .map(cell)
    .join(",");
}

export function serializeTransactionCsv(
  rows: readonly TransactionCsvRow[],
  options: { maximumBytes?: number } = {},
): string {
  if (rows.length > TRANSACTION_CSV_EXPORT_LIMITS.ROWS) {
    throw new TransactionCsvExportError("ROW_LIMIT_EXCEEDED");
  }
  const maximumBytes = options.maximumBytes ?? TRANSACTION_CSV_EXPORT_LIMITS.BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer.");
  }

  const encoder = new TextEncoder();
  const chunks = [`${TRANSACTION_CSV_HEADERS.join(",")}\r\n`];
  let bytes = encoder.encode(chunks[0]).byteLength;
  for (const row of rows) {
    const chunk = `${serializeRow(row)}\r\n`;
    bytes += encoder.encode(chunk).byteLength;
    if (bytes > maximumBytes) throw new TransactionCsvExportError("OUTPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  if (bytes > maximumBytes) throw new TransactionCsvExportError("OUTPUT_TOO_LARGE");
  return chunks.join("");
}
