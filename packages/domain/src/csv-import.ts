import { calendarDateSchema, optimisticVersionSchema } from "./api-contracts";
import * as z from "zod";
import { isCentesimalCurrency } from "./currency";

export const CSV_IMPORT_LIMITS = {
  CELL_CHARACTERS: 4096,
  COLUMNS: 32,
  FILE_BYTES: 5 * 1024 * 1024,
  ROWS: 4_000,
} as const;

export type CsvImportErrorCode =
  | "CSV_BASE64_INVALID"
  | "CSV_COLUMN_LIMIT_EXCEEDED"
  | "CSV_ENCODING_UNSUPPORTED"
  | "CSV_FILE_LIMIT_EXCEEDED"
  | "CSV_MAPPING_INVALID"
  | "CSV_ROW_LIMIT_EXCEEDED"
  | "CSV_SHAPE_INVALID";

export class CsvImportError extends Error {
  constructor(
    readonly code: CsvImportErrorCode,
    readonly status: 413 | 422,
  ) {
    super(code);
    this.name = "CsvImportError";
  }
}

export interface CsvImportColumnMapping {
  accountLabel: string;
  amount: string;
  category?: string | undefined;
  currency: string;
  description: string;
  direction: string;
  merchant?: string | undefined;
  postedDate: string;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

const csvHeaderNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => !containsControlCharacter(value));

export const csvImportColumnMappingSchema = z.strictObject({
  accountLabel: csvHeaderNameSchema,
  amount: csvHeaderNameSchema,
  category: csvHeaderNameSchema.optional(),
  currency: csvHeaderNameSchema,
  description: csvHeaderNameSchema,
  direction: csvHeaderNameSchema,
  merchant: csvHeaderNameSchema.optional(),
  postedDate: csvHeaderNameSchema,
});

export const csvImportPreviewRequestSchema = z.strictObject({
  contentBase64: z
    .string()
    .min(1)
    .max(Math.ceil(CSV_IMPORT_LIMITS.FILE_BYTES / 3) * 4),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !containsControlCharacter(value)),
  mapping: csvImportColumnMappingSchema.optional(),
});

export const csvImportBatchIdSchema = z.string().regex(/^import-preview-[A-Za-z0-9_-]{1,160}$/);

export const csvImportCommitRequestSchema = z
  .strictObject({
    reviewDecisions: z
      .array(
        z.discriminatedUnion("action", [
          z.strictObject({
            action: z.literal("IMPORT_NEW"),
            rowNumber: z
              .int()
              .min(2)
              .max(CSV_IMPORT_LIMITS.ROWS + 1),
          }),
          z.strictObject({
            action: z.literal("MERGE_EXISTING"),
            candidateTransactionId: z.string().min(1).max(160),
            candidateVersion: optimisticVersionSchema,
            rowNumber: z
              .int()
              .min(2)
              .max(CSV_IMPORT_LIMITS.ROWS + 1),
          }),
          z.strictObject({
            action: z.literal("SKIP"),
            rowNumber: z
              .int()
              .min(2)
              .max(CSV_IMPORT_LIMITS.ROWS + 1),
          }),
        ]),
      )
      .max(CSV_IMPORT_LIMITS.ROWS),
    version: optimisticVersionSchema,
  })
  .superRefine(({ reviewDecisions }, context) => {
    const seen = new Set<number>();
    for (const [index, decision] of reviewDecisions.entries()) {
      if (seen.has(decision.rowNumber)) {
        context.addIssue({
          code: "custom",
          message: "Each review row can be decided only once.",
          path: ["reviewDecisions", index, "rowNumber"],
        });
      }
      seen.add(decision.rowNumber);
    }
  });

export type CsvImportCommitRequest = z.infer<typeof csvImportCommitRequestSchema>;

export interface CsvImportRawRow {
  accountLabel: string;
  amount: string;
  category: string | null;
  currency: string;
  description: string;
  direction: string;
  merchant: string | null;
  postedDate: string;
}

export type CsvImportRowErrorCode =
  | "COLUMN_COUNT_MISMATCH"
  | "INVALID_ACCOUNT_LABEL"
  | "INVALID_AMOUNT"
  | "INVALID_CATEGORY"
  | "INVALID_CURRENCY"
  | "INVALID_DATE"
  | "INVALID_DESCRIPTION"
  | "INVALID_DIRECTION"
  | "INVALID_MERCHANT";

export interface CsvImportRowError {
  code: CsvImportRowErrorCode;
  field:
    | "accountLabel"
    | "amount"
    | "category"
    | "currency"
    | "description"
    | "direction"
    | "merchant"
    | "postedDate"
    | "row";
}

export interface CanonicalImportRowCandidate {
  accountLabel: string;
  amountMinor: number;
  currency: string;
  description: string;
  direction: "INFLOW" | "OUTFLOW";
  postedDate: string;
}

export interface CsvImportExistingMatchCandidate {
  dateDistanceDays: number;
  description: string;
  evidence: "DESCRIPTION_EXACT" | "MERCHANT_EXACT" | "OWNER_RULE_EXACT" | "SUBSCRIPTION_EXACT";
  postedDate: string;
  subscriptionName: string | null;
  subscriptionOccurrenceId: string | null;
  transactionId: string;
  transactionVersion: number;
}

export interface CsvImportExistingMatch {
  candidates: CsvImportExistingMatchCandidate[];
  disposition: "AUTO_MERGE_EXISTING" | "SUSPECTED_EXISTING";
}

export interface CsvImportPreviewRow {
  canonicalFingerprint: string | null;
  duplicateEvidence: "EXACT_REPEAT" | "SUSPECTED_EXISTING" | "SUSPECTED_SAME_FILE" | null;
  duplicateKey: string | null;
  errors: CsvImportRowError[];
  existingMatch: CsvImportExistingMatch | null;
  raw: CsvImportRawRow;
  rowNumber: number;
  status: "DUPLICATE" | "INVALID" | "VALID";
}

export interface CsvImportPreviewCounts {
  duplicate: number;
  invalid: number;
  total: number;
  valid: number;
}

export interface CsvImportPreview {
  adapter: "GENERIC_V1" | "RBC_CA_V1";
  columns: string[];
  counts: CsvImportPreviewCounts;
  rows: CsvImportPreviewRow[];
}

export const csvImportRowErrorSchema = z.strictObject({
  code: z.enum([
    "COLUMN_COUNT_MISMATCH",
    "INVALID_ACCOUNT_LABEL",
    "INVALID_AMOUNT",
    "INVALID_CATEGORY",
    "INVALID_CURRENCY",
    "INVALID_DATE",
    "INVALID_DESCRIPTION",
    "INVALID_DIRECTION",
    "INVALID_MERCHANT",
  ]),
  field: z.enum([
    "accountLabel",
    "amount",
    "category",
    "currency",
    "description",
    "direction",
    "merchant",
    "postedDate",
    "row",
  ]),
});

export const csvImportRawRowSchema = z.strictObject({
  accountLabel: z.string(),
  amount: z.string(),
  category: z.string().nullable(),
  currency: z.string(),
  description: z.string(),
  direction: z.string(),
  merchant: z.string().nullable(),
  postedDate: z.string(),
});

export const csvImportExistingMatchCandidateSchema = z.strictObject({
  dateDistanceDays: z.int().min(0).max(3),
  description: z.string().min(1).max(512),
  evidence: z.enum([
    "DESCRIPTION_EXACT",
    "MERCHANT_EXACT",
    "OWNER_RULE_EXACT",
    "SUBSCRIPTION_EXACT",
  ]),
  postedDate: calendarDateSchema,
  subscriptionName: z.string().min(1).max(160).nullable(),
  subscriptionOccurrenceId: z.string().min(1).max(160).nullable(),
  transactionId: z.string().min(1).max(160),
  transactionVersion: optimisticVersionSchema,
});

export const csvImportExistingMatchSchema = z
  .strictObject({
    candidates: z.array(csvImportExistingMatchCandidateSchema).min(1).max(10),
    disposition: z.enum(["AUTO_MERGE_EXISTING", "SUSPECTED_EXISTING"]),
  })
  .superRefine(({ candidates, disposition }, context) => {
    if (disposition === "AUTO_MERGE_EXISTING" && candidates.length !== 1) {
      context.addIssue({ code: "custom", message: "Automatic merge requires one candidate." });
    }
    if (new Set(candidates.map(({ transactionId }) => transactionId)).size !== candidates.length) {
      context.addIssue({ code: "custom", message: "Match candidates must be unique." });
    }
  });

const csvImportPreviewResponseRowSchema = z.strictObject({
  canonicalFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  duplicateEvidence: z
    .enum(["EXACT_REPEAT", "SUSPECTED_EXISTING", "SUSPECTED_SAME_FILE"])
    .nullable(),
  errors: z.array(csvImportRowErrorSchema),
  existingMatch: csvImportExistingMatchSchema.nullable(),
  raw: csvImportRawRowSchema,
  rowNumber: z.int().min(2),
  status: z.enum(["DUPLICATE", "INVALID", "VALID"]),
});

const csvImportHiddenReviewRowSchema = csvImportPreviewResponseRowSchema.superRefine(
  ({ duplicateEvidence, existingMatch, rowNumber }, context) => {
    if (rowNumber <= 101) {
      context.addIssue({ code: "custom", message: "Hidden review rows must follow row 101." });
    }
    if (
      duplicateEvidence !== "SUSPECTED_SAME_FILE" &&
      existingMatch?.disposition !== "SUSPECTED_EXISTING"
    ) {
      context.addIssue({ code: "custom", message: "Hidden rows must require owner review." });
    }
  },
);

export const csvImportPreviewResponseSchema = z.strictObject({
  data: z.strictObject({
    preview: z
      .strictObject({
        adapter: z.enum(["GENERIC_V1", "RBC_CA_V1"]),
        columns: z.array(z.string()).max(CSV_IMPORT_LIMITS.COLUMNS),
        counts: z.strictObject({
          duplicate: z.int().nonnegative(),
          invalid: z.int().nonnegative(),
          total: z.int().nonnegative(),
          valid: z.int().nonnegative(),
        }),
        expiresAt: z.iso.datetime({ offset: true }),
        fileName: z.string().min(1).max(255),
        id: csvImportBatchIdSchema,
        mapping: csvImportColumnMappingSchema.nullable(),
        reviewRows: z.array(csvImportHiddenReviewRowSchema).max(CSV_IMPORT_LIMITS.ROWS - 100),
        rows: z.array(csvImportPreviewResponseRowSchema).max(100),
        status: z.literal("PREVIEWED"),
        version: optimisticVersionSchema,
      })
      .superRefine(({ reviewRows, rows }, context) => {
        const visibleRowNumbers = new Set(rows.map(({ rowNumber }) => rowNumber));
        for (const [index, row] of reviewRows.entries()) {
          if (visibleRowNumbers.has(row.rowNumber)) {
            context.addIssue({
              code: "custom",
              message: "Hidden review rows cannot duplicate visible rows.",
              path: ["reviewRows", index, "rowNumber"],
            });
          }
        }
      }),
  }),
  meta: z.strictObject({
    ledgerTransactionsCreated: z.literal(0),
    replayed: z.boolean(),
    rowsTruncated: z.boolean(),
  }),
});

const csvImportCommitRowResultSchema = z.strictObject({
  duplicateEvidence: z
    .enum([
      "EXACT_REPEAT",
      "SUSPECTED_EXISTING",
      "SUSPECTED_SAME_FILE",
      "FINGERPRINT_ALREADY_COMMITTED",
    ])
    .nullable(),
  outcome: z.enum([
    "IMPORTED_NEW",
    "AUTO_MERGED",
    "OWNER_MERGED",
    "SKIPPED_INVALID",
    "SKIPPED_DUPLICATE",
  ]),
  rowNumber: z
    .int()
    .min(2)
    .max(CSV_IMPORT_LIMITS.ROWS + 1),
  transactionId: z.string().min(1).max(160).nullable(),
});

const csvImportCommittedBatchSchema = z
  .strictObject({
    committedAt: z.iso.datetime({ offset: true }),
    contentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    counts: z.strictObject({
      autoMerged: z.int().nonnegative(),
      importedNew: z.int().nonnegative(),
      ownerMerged: z.int().nonnegative(),
      skippedDuplicate: z.int().nonnegative(),
      skippedInvalid: z.int().nonnegative(),
      total: z.int().nonnegative().max(CSV_IMPORT_LIMITS.ROWS),
    }),
    id: csvImportBatchIdSchema,
    rows: z.array(csvImportCommitRowResultSchema).max(CSV_IMPORT_LIMITS.ROWS),
    sourceFileNameHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal("COMMITTED"),
    version: optimisticVersionSchema,
  })
  .superRefine(({ counts, rows }, context) => {
    const actual = {
      autoMerged: rows.filter(({ outcome }) => outcome === "AUTO_MERGED").length,
      importedNew: rows.filter(({ outcome }) => outcome === "IMPORTED_NEW").length,
      ownerMerged: rows.filter(({ outcome }) => outcome === "OWNER_MERGED").length,
      skippedDuplicate: rows.filter(({ outcome }) => outcome === "SKIPPED_DUPLICATE").length,
      skippedInvalid: rows.filter(({ outcome }) => outcome === "SKIPPED_INVALID").length,
      total: rows.length,
    };
    if (
      counts.autoMerged !== actual.autoMerged ||
      counts.importedNew !== actual.importedNew ||
      counts.ownerMerged !== actual.ownerMerged ||
      counts.skippedDuplicate !== actual.skippedDuplicate ||
      counts.skippedInvalid !== actual.skippedInvalid ||
      counts.total !== actual.total
    ) {
      context.addIssue({ code: "custom", message: "Commit counts must match row outcomes." });
    }
  });

export const csvImportCommitResponseSchema = z.strictObject({
  data: z.strictObject({ importBatch: csvImportCommittedBatchSchema }),
  meta: z.strictObject({ replayed: z.boolean() }),
});

export type CsvImportCommitResponse = z.infer<typeof csvImportCommitResponseSchema>;
export type CsvImportCommittedBatch = CsvImportCommitResponse["data"]["importBatch"];

interface CsvParserState {
  currentField: string;
  currentRow: string[];
  rows: string[][];
  skipLineFeed: boolean;
  state: "AFTER_QUOTE" | "FIELD_START" | "QUOTED" | "UNQUOTED";
}

const MAPPING_REQUIRED_FIELDS = [
  "accountLabel",
  "amount",
  "currency",
  "description",
  "direction",
  "postedDate",
] as const;

const RBC_HEADERS = [
  "Account Type",
  "Account Number",
  "Transaction Date",
  "Cheque Number",
  "Description 1",
  "Description 2",
  "CAD$",
  "USD$",
] as const;

const RBC_PREVIEW_COLUMNS = [
  "postedDate",
  "description",
  "amount",
  "direction",
  "currency",
  "accountLabel",
] as const;

function shapeError(code: CsvImportErrorCode = "CSV_SHAPE_INVALID"): CsvImportError {
  return new CsvImportError(code, 422);
}

function appendCharacter(parser: CsvParserState, character: string): void {
  parser.currentField += character;
  if (parser.currentField.length > CSV_IMPORT_LIMITS.CELL_CHARACTERS) {
    throw shapeError();
  }
}

function completeField(parser: CsvParserState): void {
  parser.currentRow.push(parser.currentField);
  if (parser.currentRow.length > CSV_IMPORT_LIMITS.COLUMNS) {
    throw shapeError("CSV_COLUMN_LIMIT_EXCEEDED");
  }
  parser.currentField = "";
  parser.state = "FIELD_START";
}

function completeRow(parser: CsvParserState): void {
  completeField(parser);
  parser.rows.push(parser.currentRow);
  parser.currentRow = [];
  if (parser.rows.length > CSV_IMPORT_LIMITS.ROWS + 1) {
    throw shapeError("CSV_ROW_LIMIT_EXCEEDED");
  }
}

function processCsvText(parser: CsvParserState, text: string): void {
  for (const character of text) {
    if (parser.skipLineFeed) {
      parser.skipLineFeed = false;
      if (character === "\n") continue;
    }

    if (parser.state === "QUOTED") {
      if (character === '"') parser.state = "AFTER_QUOTE";
      else appendCharacter(parser, character);
      continue;
    }

    if (parser.state === "AFTER_QUOTE") {
      if (character === '"') {
        appendCharacter(parser, character);
        parser.state = "QUOTED";
      } else if (character === ",") {
        completeField(parser);
      } else if (character === "\n" || character === "\r") {
        completeRow(parser);
        parser.skipLineFeed = character === "\r";
      } else {
        throw shapeError();
      }
      continue;
    }

    if (character === ",") {
      completeField(parser);
    } else if (character === "\n" || character === "\r") {
      completeRow(parser);
      parser.skipLineFeed = character === "\r";
    } else if (character === '"') {
      if (parser.state !== "FIELD_START") throw shapeError();
      parser.state = "QUOTED";
    } else {
      appendCharacter(parser, character);
      parser.state = "UNQUOTED";
    }
  }
}

function finalizeCsv(parser: CsvParserState): string[][] {
  if (parser.state === "QUOTED") throw shapeError();
  if (
    parser.currentField.length > 0 ||
    parser.currentRow.length > 0 ||
    parser.state === "AFTER_QUOTE"
  ) {
    completeRow(parser);
  }
  if (parser.rows.length === 0) throw shapeError();
  return parser.rows;
}

function mappingIndexes(headers: string[], mapping: CsvImportColumnMapping) {
  if (headers.some((header) => header.length === 0) || new Set(headers).size !== headers.length) {
    throw shapeError("CSV_MAPPING_INVALID");
  }
  const mappingEntries: Array<[keyof CsvImportColumnMapping, string]> = [
    ["accountLabel", mapping.accountLabel],
    ["amount", mapping.amount],
    ["currency", mapping.currency],
    ["description", mapping.description],
    ["direction", mapping.direction],
    ["postedDate", mapping.postedDate],
  ];
  if (mapping.category !== undefined) mappingEntries.push(["category", mapping.category]);
  if (mapping.merchant !== undefined) mappingEntries.push(["merchant", mapping.merchant]);
  const mappingValues = mappingEntries.map(([, header]) => header);
  if (new Set(mappingValues).size !== mappingValues.length) {
    throw shapeError("CSV_MAPPING_INVALID");
  }
  for (const field of MAPPING_REQUIRED_FIELDS) {
    if (!mapping[field] || mapping[field].length > 160) {
      throw shapeError("CSV_MAPPING_INVALID");
    }
  }
  if (mappingValues.some((header) => !headers.includes(header))) {
    throw shapeError("CSV_MAPPING_INVALID");
  }

  return Object.fromEntries(
    mappingEntries.map(([field, header]) => [field, headers.indexOf(header)]),
  ) as Record<keyof CsvImportColumnMapping, number>;
}

function hasExactRbcHeaders(headers: string[]): boolean {
  return (
    headers.length === RBC_HEADERS.length &&
    new Set(headers).size === headers.length &&
    RBC_HEADERS.every((header) => headers.includes(header))
  );
}

function rbcDateToIso(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return value.trim();
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return value.trim();
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function readRbcRow(row: string[], headers: string[]): CsvImportRawRow {
  const value = (header: (typeof RBC_HEADERS)[number]) =>
    row[headers.indexOf(header)]?.trim() ?? "";
  const cad = value("CAD$");
  const usd = value("USD$");
  const hasCad = cad.length > 0;
  const hasUsd = usd.length > 0;
  const signedAmount = hasCad === hasUsd ? "" : hasCad ? cad : usd;
  const validSignedAmount = /^-?(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(signedAmount);
  const amount = validSignedAmount ? signedAmount.replace(/^-/, "") : signedAmount;
  const direction = validSignedAmount ? (signedAmount.startsWith("-") ? "OUTFLOW" : "INFLOW") : "";
  const accountType = value("Account Type");
  const description = [value("Description 1"), value("Description 2")]
    .filter((part) => part.length > 0)
    .join(" ");
  return {
    accountLabel:
      accountType === "Visa" ? "RBC Credit" : accountType === "Chequing" ? "RBC Debit" : "",
    amount,
    category: null,
    currency: hasCad === hasUsd ? "" : hasCad ? "CAD" : "USD",
    description,
    direction,
    merchant: null,
    postedDate: rbcDateToIso(value("Transaction Date")),
  };
}

function redactedMalformedRbcRow(): CsvImportRawRow {
  return {
    accountLabel: "",
    amount: "",
    category: null,
    currency: "",
    description: "",
    direction: "",
    merchant: null,
    postedDate: "",
  };
}

function readMappedRow(
  row: string[],
  indexes: Record<keyof CsvImportColumnMapping, number>,
): CsvImportRawRow {
  return {
    accountLabel: row[indexes.accountLabel] ?? "",
    amount: row[indexes.amount] ?? "",
    category: indexes.category === undefined ? null : (row[indexes.category] ?? ""),
    currency: row[indexes.currency] ?? "",
    description: row[indexes.description] ?? "",
    direction: row[indexes.direction] ?? "",
    merchant: indexes.merchant === undefined ? null : (row[indexes.merchant] ?? ""),
    postedDate: row[indexes.postedDate] ?? "",
  };
}

export function csvImportAmountToMinorUnits(value: string): number | null {
  if (!/^(0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole = "0", fractional = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

function normalizeDuplicateText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
}

export function canonicalImportRowKey(candidate: CanonicalImportRowCandidate): string {
  return JSON.stringify([
    candidate.postedDate,
    candidate.amountMinor,
    candidate.direction,
    candidate.currency,
    normalizeDuplicateText(candidate.description),
    normalizeDuplicateText(candidate.accountLabel),
  ]);
}

function validateRow(raw: CsvImportRawRow): {
  candidate: CanonicalImportRowCandidate | null;
  errors: CsvImportRowError[];
  normalizedRaw: CsvImportRawRow;
} {
  const normalizedRaw: CsvImportRawRow = {
    accountLabel: raw.accountLabel.trim(),
    amount: raw.amount.trim(),
    category: raw.category?.trim() || null,
    currency: raw.currency.trim(),
    description: raw.description.trim(),
    direction: raw.direction.trim(),
    merchant: raw.merchant?.trim() || null,
    postedDate: raw.postedDate.trim(),
  };
  const errors: CsvImportRowError[] = [];
  const amountMinor = csvImportAmountToMinorUnits(normalizedRaw.amount);
  if (!calendarDateSchema.safeParse(normalizedRaw.postedDate).success) {
    errors.push({ code: "INVALID_DATE", field: "postedDate" });
  }
  if (normalizedRaw.description.length < 1 || normalizedRaw.description.length > 512) {
    errors.push({ code: "INVALID_DESCRIPTION", field: "description" });
  }
  if (amountMinor === null) errors.push({ code: "INVALID_AMOUNT", field: "amount" });
  if (normalizedRaw.direction !== "INFLOW" && normalizedRaw.direction !== "OUTFLOW") {
    errors.push({ code: "INVALID_DIRECTION", field: "direction" });
  }
  if (!isCentesimalCurrency(normalizedRaw.currency)) {
    errors.push({ code: "INVALID_CURRENCY", field: "currency" });
  }
  if (normalizedRaw.accountLabel.length < 1 || normalizedRaw.accountLabel.length > 160) {
    errors.push({ code: "INVALID_ACCOUNT_LABEL", field: "accountLabel" });
  }
  if (normalizedRaw.merchant !== null && normalizedRaw.merchant.length > 256) {
    errors.push({ code: "INVALID_MERCHANT", field: "merchant" });
  }
  if (normalizedRaw.category !== null && normalizedRaw.category.length > 160) {
    errors.push({ code: "INVALID_CATEGORY", field: "category" });
  }

  if (
    errors.length > 0 ||
    amountMinor === null ||
    (normalizedRaw.direction !== "INFLOW" && normalizedRaw.direction !== "OUTFLOW") ||
    !isCentesimalCurrency(normalizedRaw.currency)
  ) {
    return { candidate: null, errors, normalizedRaw };
  }
  return {
    candidate: {
      accountLabel: normalizedRaw.accountLabel,
      amountMinor,
      currency: normalizedRaw.currency,
      description: normalizedRaw.description,
      direction: normalizedRaw.direction,
      postedDate: normalizedRaw.postedDate,
    },
    errors,
    normalizedRaw,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function csvImportFileNameHash(fileName: string): Promise<string> {
  return sha256Hex(fileName.normalize("NFKC").trim());
}

export function csvImportContentChecksum(preview: CsvImportPreview): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      "CSV_IMPORT_CANONICAL_V1",
      preview.adapter,
      preview.rows.map((row) => [
        row.canonicalFingerprint,
        row.duplicateEvidence,
        row.status,
        row.errors.map(({ code, field }) => [code, field]),
        [
          row.raw.postedDate,
          row.raw.description,
          row.raw.amount,
          row.raw.direction,
          row.raw.currency,
          row.raw.accountLabel,
          row.raw.merchant,
          row.raw.category,
        ],
      ]),
    ]),
  );
}

function countsFor(rows: CsvImportPreviewRow[]): CsvImportPreviewCounts {
  return {
    duplicate: rows.filter(({ status }) => status === "DUPLICATE").length,
    invalid: rows.filter(({ status }) => status === "INVALID").length,
    total: rows.length,
    valid: rows.filter(({ status }) => status === "VALID").length,
  };
}

export async function parseCsvPreview(input: {
  chunks: Iterable<Uint8Array>;
  mapping?: CsvImportColumnMapping;
}): Promise<CsvImportPreview> {
  const parser: CsvParserState = {
    currentField: "",
    currentRow: [],
    rows: [],
    skipLineFeed: false,
    state: "FIELD_START",
  };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let totalBytes = 0;
  try {
    for (const chunk of input.chunks) {
      totalBytes += chunk.byteLength;
      if (totalBytes > CSV_IMPORT_LIMITS.FILE_BYTES) {
        throw new CsvImportError("CSV_FILE_LIMIT_EXCEEDED", 413);
      }
      processCsvText(parser, decoder.decode(chunk, { stream: true }));
    }
    processCsvText(parser, decoder.decode());
  } catch (error) {
    if (error instanceof CsvImportError) throw error;
    throw shapeError("CSV_ENCODING_UNSUPPORTED");
  }

  const parsedRows = finalizeCsv(parser);
  const headers = parsedRows[0]!;
  const rbc = hasExactRbcHeaders(headers);
  if (!rbc && input.mapping === undefined) throw shapeError("CSV_MAPPING_INVALID");
  const indexes = rbc ? null : mappingIndexes(headers, input.mapping!);
  const occurrenceCounts = new Map<string, number>();
  const rows: CsvImportPreviewRow[] = [];

  for (const [index, values] of parsedRows.slice(1).entries()) {
    const columnCountMismatch = values.length !== headers.length;
    const raw = rbc
      ? columnCountMismatch
        ? redactedMalformedRbcRow()
        : readRbcRow(values, headers)
      : readMappedRow(values, indexes!);
    const validation = validateRow(raw);
    if (
      rbc &&
      validation.errors.some(({ code }) => code === "INVALID_AMOUNT" || code === "INVALID_CURRENCY")
    ) {
      validation.errors = validation.errors.filter(({ code }) => code !== "INVALID_DIRECTION");
    }
    if (columnCountMismatch) {
      validation.errors.unshift({ code: "COLUMN_COUNT_MISMATCH", field: "row" });
    }
    if (!validation.candidate || validation.errors.length > 0) {
      rows.push({
        canonicalFingerprint: null,
        duplicateEvidence: null,
        duplicateKey: null,
        errors: validation.errors,
        existingMatch: null,
        raw: validation.normalizedRaw,
        rowNumber: index + 2,
        status: "INVALID",
      });
      continue;
    }

    const duplicateKey = canonicalImportRowKey(validation.candidate);
    const occurrenceOrdinal = (occurrenceCounts.get(duplicateKey) ?? 0) + 1;
    occurrenceCounts.set(duplicateKey, occurrenceOrdinal);
    const canonicalFingerprint = await sha256Hex(JSON.stringify([duplicateKey, occurrenceOrdinal]));
    const sameFileRepeat = occurrenceOrdinal > 1;
    rows.push({
      canonicalFingerprint,
      duplicateEvidence: sameFileRepeat ? "SUSPECTED_SAME_FILE" : null,
      duplicateKey,
      errors: [],
      existingMatch: null,
      raw: validation.normalizedRaw,
      rowNumber: index + 2,
      status: sameFileRepeat ? "DUPLICATE" : "VALID",
    });
  }

  return {
    adapter: rbc ? "RBC_CA_V1" : "GENERIC_V1",
    columns: rbc ? [...RBC_PREVIEW_COLUMNS] : [...headers],
    counts: countsFor(rows),
    rows,
  };
}

export function applySuspectedDuplicateKeys(
  preview: CsvImportPreview,
  suspectedDuplicateKeys: ReadonlySet<string>,
): CsvImportPreview {
  const rows = preview.rows.map((row): CsvImportPreviewRow => {
    if (
      row.status !== "VALID" ||
      row.duplicateKey === null ||
      !suspectedDuplicateKeys.has(row.duplicateKey)
    ) {
      return { ...row, errors: [...row.errors], raw: { ...row.raw } };
    }
    return {
      ...row,
      duplicateEvidence: "SUSPECTED_EXISTING",
      errors: [...row.errors],
      existingMatch: null,
      raw: { ...row.raw },
      status: "DUPLICATE",
    };
  });
  return { adapter: preview.adapter, columns: [...preview.columns], counts: countsFor(rows), rows };
}

export function applyActiveCategoryReferences(
  preview: CsvImportPreview,
  activeCategoryReferences: ReadonlySet<string>,
): CsvImportPreview {
  const rows = preview.rows.map((row): CsvImportPreviewRow => {
    if (row.raw.category === null || activeCategoryReferences.has(row.raw.category)) {
      return { ...row, errors: [...row.errors], raw: { ...row.raw } };
    }
    return {
      ...row,
      canonicalFingerprint: null,
      duplicateEvidence: null,
      duplicateKey: null,
      errors: [...row.errors, { code: "INVALID_CATEGORY", field: "category" }],
      existingMatch: null,
      raw: { ...row.raw },
      status: "INVALID",
    };
  });
  return { adapter: preview.adapter, columns: [...preview.columns], counts: countsFor(rows), rows };
}

export function applyExistingMatches(
  preview: CsvImportPreview,
  matches: ReadonlyMap<number, CsvImportExistingMatch>,
): CsvImportPreview {
  const rows = preview.rows.map((row): CsvImportPreviewRow => {
    const existingMatch = matches.get(row.rowNumber) ?? null;
    if (existingMatch === null || row.status === "INVALID") {
      return { ...row, errors: [...row.errors], existingMatch: null, raw: { ...row.raw } };
    }
    const parsed = csvImportExistingMatchSchema.parse(existingMatch);
    return {
      ...row,
      duplicateEvidence:
        row.duplicateEvidence === "SUSPECTED_SAME_FILE"
          ? "SUSPECTED_SAME_FILE"
          : "SUSPECTED_EXISTING",
      errors: [...row.errors],
      existingMatch: parsed,
      raw: { ...row.raw },
      status: "DUPLICATE",
    };
  });
  return { adapter: preview.adapter, columns: [...preview.columns], counts: countsFor(rows), rows };
}

export function decodeCsvBase64(
  value: string,
  maximumBytes = CSV_IMPORT_LIMITS.FILE_BYTES,
): Uint8Array {
  const maximumEncodedLength = Math.ceil(maximumBytes / 3) * 4;
  if (value.length > maximumEncodedLength) {
    throw new CsvImportError("CSV_FILE_LIMIT_EXCEEDED", 413);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw shapeError("CSV_BASE64_INVALID");
  }
  try {
    const binary = atob(value);
    if (binary.length > maximumBytes) {
      throw new CsvImportError("CSV_FILE_LIMIT_EXCEEDED", 413);
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (error) {
    if (error instanceof CsvImportError) throw error;
    throw shapeError("CSV_BASE64_INVALID");
  }
}
