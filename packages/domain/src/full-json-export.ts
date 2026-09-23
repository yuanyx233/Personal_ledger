import * as z from "zod";
import { ledgerCurrencySchema } from "./currency";
import { timeZoneSchema } from "./time-zone";

import { budgetRecordSchema } from "./budgets";

import { CSV_IMPORT_LIMITS, csvImportRawRowSchema } from "./csv-import";
import { transactionPaymentMetadataSchema } from "./e-transfer";

export const FULL_JSON_EXPORT_LIMITS = {
  BYTES: 32 * 1024 * 1024,
  RECORDS_PER_COLLECTION: 50_000,
  TOTAL_RECORDS: 100_000,
} as const;

export type FullJsonExportErrorCode = "OUTPUT_TOO_LARGE" | "ROW_LIMIT_EXCEEDED";

export class FullJsonExportError extends Error {
  constructor(readonly code: FullJsonExportErrorCode) {
    super(code);
    this.name = "FullJsonExportError";
  }
}

const idSchema = z.string().min(1).max(512);
const textSchema = z.string().max(4096);
const timestampSchema = z.iso.datetime({ offset: true });
const dateSchema = z.iso.date();
const versionSchema = z.int().positive();
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const categorizationSourceSchema = z.enum(["MANUAL", "RULE", "PLAID", "UNCLASSIFIED"]);

const categorySchema = z.strictObject({
  active: z.boolean(),
  createdAt: timestampSchema,
  editable: z.boolean(),
  id: idSchema,
  kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "UNCLASSIFIED"]),
  name: z.string().min(1).max(512),
  systemKey: z.string().min(1).max(160).nullable(),
  updatedAt: timestampSchema,
  version: versionSchema,
});

const merchantRuleSchema = z.strictObject({
  active: z.boolean(),
  categoryId: idSchema,
  createdAt: timestampSchema,
  displayMerchant: z.string().min(1).max(512),
  id: idSchema,
  normalizedMerchant: z.string().min(1).max(256),
  updatedAt: timestampSchema,
  version: versionSchema,
});

const installmentSchema = z
  .strictObject({
    count: z.int().min(2).max(60),
    groupId: idSchema,
    number: z.int().min(1).max(60),
  })
  .refine((installment) => installment.number <= installment.count, {
    message: "Installment number cannot exceed installment count.",
    path: ["number"],
  });

const transactionSchema = z
  .strictObject({
    accountLabel: z.string().min(1).max(512).nullable(),
    amountMinor: z.int().nonnegative(),
    reimbursementMinor: z.int().nonnegative().default(0),
    authorizedDate: dateSchema.nullable(),
    categorizationSource: categorizationSourceSchema,
    categoryId: idSchema.nullable(),
    categoryRuleId: idSchema.nullable(),
    createdAt: timestampSchema,
    currency: currencySchema,
    description: textSchema,
    direction: z.enum(["INFLOW", "OUTFLOW"]),
    id: idSchema,
    importFingerprint: sha256Schema.nullable(),
    installment: installmentSchema.nullable().default(null),
    merchantName: textSchema.nullable(),
    needsReview: z.boolean(),
    normalizedMerchant: z.string().min(1).max(256).nullable(),
    paymentMetadata: transactionPaymentMetadataSchema,
    pendingTransactionId: idSchema.nullable(),
    postedDate: dateSchema,
    reviewReason: z.string().min(1).max(256).nullable(),
    source: z.enum(["PLAID", "MANUAL", "CSV"]),
    status: z.enum(["PENDING", "POSTED", "REMOVED"]),
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine((transaction) => transaction.reimbursementMinor <= transaction.amountMinor, {
    message: "Reimbursement cannot exceed the transaction amount.",
    path: ["reimbursementMinor"],
  })
  .refine((transaction) => transaction.installment === null || transaction.source === "MANUAL", {
    message: "Only manual transactions can belong to an installment group.",
    path: ["installment"],
  });

const categoryAuditSchema = z.strictObject({
  createdAt: timestampSchema,
  id: idSchema,
  newCategoryId: idSchema.nullable(),
  newCategoryRuleId: idSchema.nullable(),
  newSource: categorizationSourceSchema,
  oldCategoryId: idSchema.nullable(),
  oldCategoryRuleId: idSchema.nullable(),
  oldSource: categorizationSourceSchema,
  reason: z.string().min(1).max(256),
  transactionId: idSchema,
});

const importBatchSchema = z.strictObject({
  committedAt: timestampSchema,
  contentChecksum: sha256Schema,
  createdAt: timestampSchema,
  id: idSchema,
  sourceFilenameHash: sha256Schema.nullable(),
  status: z.literal("COMMITTED"),
  version: versionSchema,
});

const csvImportRowErrorSchema = z.strictObject({
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

const exportCsvCellSchema = z.string().max(CSV_IMPORT_LIMITS.CELL_CHARACTERS);
const exportCsvImportRawRowSchema = csvImportRawRowSchema.extend({
  accountLabel: exportCsvCellSchema,
  amount: exportCsvCellSchema,
  category: exportCsvCellSchema.nullable(),
  currency: exportCsvCellSchema,
  description: exportCsvCellSchema,
  direction: exportCsvCellSchema,
  merchant: exportCsvCellSchema.nullable(),
  postedDate: exportCsvCellSchema,
});

const importMatchEvidenceSchema = z.strictObject({
  candidates: z
    .array(
      z.strictObject({
        dateDistanceDays: z.int().min(0).max(3),
        description: textSchema,
        evidence: z.enum([
          "DESCRIPTION_EXACT",
          "MERCHANT_EXACT",
          "OWNER_RULE_EXACT",
          "SUBSCRIPTION_EXACT",
        ]),
        postedDate: dateSchema,
        subscriptionName: z.string().min(1).max(160).nullable(),
        subscriptionOccurrenceId: idSchema.nullable(),
        transactionId: idSchema,
        transactionVersion: versionSchema,
      }),
    )
    .max(10),
  disposition: z.enum(["AUTO_MERGE_EXISTING", "SUSPECTED_EXISTING"]),
});

const importRowSchema = z.strictObject({
  batchId: idSchema,
  canonicalFingerprint: sha256Schema.nullable(),
  createdAt: timestampSchema,
  errors: z.array(csvImportRowErrorSchema),
  id: idSchema,
  matchEvidence: importMatchEvidenceSchema.nullable(),
  raw: exportCsvImportRawRowSchema,
  resolution: z.enum([
    "UNRESOLVED",
    "IMPORTED_NEW",
    "AUTO_MERGED",
    "OWNER_MERGED",
    "SKIPPED_INVALID",
    "SKIPPED_DUPLICATE",
  ]),
  resolvedAt: timestampSchema.nullable(),
  rowNumber: z.int().positive(),
  transactionId: idSchema.nullable(),
  validationStatus: z.enum(["VALID", "INVALID", "DUPLICATE", "IMPORTED"]),
});

const subscriptionSchema = z.strictObject({
  cancellationEffectiveDate: dateSchema.nullable().optional(),
  accountLabel: z.string().min(1).max(160),
  amountMinor: z.int().positive(),
  anchorDay: z.int().min(1).max(31),
  cadence: z.enum(["MONTHLY", "YEARLY"]),
  categoryId: idSchema,
  createdAt: timestampSchema,
  currency: ledgerCurrencySchema,
  id: idSchema,
  lastErrorCode: z.string().min(1).max(80).nullable(),
  merchantName: z.string().min(1).max(256).nullable(),
  name: z.string().min(1).max(160),
  nextChargeDate: dateSchema,
  normalizedMerchant: z.string().min(1).max(256),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
  updatedAt: timestampSchema,
  version: versionSchema,
});

const subscriptionOccurrenceSchema = z.strictObject({
  createdAt: timestampSchema,
  id: idSchema,
  ownerDecisionAt: timestampSchema.nullable(),
  scheduledDate: dateSchema,
  status: z.enum(["GENERATED", "NOT_CHARGED"]),
  subscriptionId: idSchema,
  transactionId: idSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});

const collection = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.array(schema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION);

export const fullJsonExportDataSchema = z.strictObject({
  budgets: collection(budgetRecordSchema),
  categories: collection(categorySchema),
  categoryAudits: collection(categoryAuditSchema),
  importBatches: collection(importBatchSchema),
  importRows: collection(importRowSchema),
  merchantRules: collection(merchantRuleSchema),
  subscriptionOccurrences: collection(subscriptionOccurrenceSchema),
  subscriptions: collection(subscriptionSchema),
  transactions: collection(transactionSchema),
});

const recordCountsSchema = z.strictObject({
  budgets: z.int().nonnegative(),
  categories: z.int().nonnegative(),
  categoryAudits: z.int().nonnegative(),
  importBatches: z.int().nonnegative(),
  importRows: z.int().nonnegative(),
  merchantRules: z.int().nonnegative(),
  subscriptionOccurrences: z.int().nonnegative(),
  subscriptions: z.int().nonnegative(),
  transactions: z.int().nonnegative(),
});

export const fullJsonExportSchema = z
  .strictObject({
    data: fullJsonExportDataSchema,
    exportKind: z.literal("PERSONAL_LEDGER_FULL"),
    exportedAt: timestampSchema,
    recordCounts: recordCountsSchema,
    schemaVersion: z.literal(5),
    timezone: timeZoneSchema,
  })
  .superRefine((document, context) => {
    for (const key of Object.keys(document.data) as Array<keyof FullJsonExportData>) {
      if (document.recordCounts[key] !== document.data[key].length) {
        context.addIssue({
          code: "custom",
          message: "Record count must match records.",
          path: ["recordCounts", key],
        });
      }
    }
  });

export type FullJsonExportData = z.infer<typeof fullJsonExportDataSchema>;
export type FullJsonExport = z.infer<typeof fullJsonExportSchema>;

function recordCounts(data: FullJsonExportData): FullJsonExport["recordCounts"] {
  return {
    budgets: data.budgets.length,
    categories: data.categories.length,
    categoryAudits: data.categoryAudits.length,
    importBatches: data.importBatches.length,
    importRows: data.importRows.length,
    merchantRules: data.merchantRules.length,
    subscriptionOccurrences: data.subscriptionOccurrences.length,
    subscriptions: data.subscriptions.length,
    transactions: data.transactions.length,
  };
}

export function createFullJsonExport(input: {
  data: FullJsonExportData;
  exportedAt: string;
  timezone: string;
}): FullJsonExport {
  const normalizedData = fullJsonExportDataSchema.parse(input.data);
  const counts = recordCounts(normalizedData);
  if (
    Object.values(counts).some((count) => count > FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION)
  ) {
    throw new FullJsonExportError("ROW_LIMIT_EXCEEDED");
  }
  if (
    Object.values(counts).reduce((sum, count) => sum + count, 0) >
    FULL_JSON_EXPORT_LIMITS.TOTAL_RECORDS
  ) {
    throw new FullJsonExportError("ROW_LIMIT_EXCEEDED");
  }
  return fullJsonExportSchema.parse({
    data: normalizedData,
    exportKind: "PERSONAL_LEDGER_FULL",
    exportedAt: input.exportedAt,
    recordCounts: counts,
    schemaVersion: 5,
    timezone: input.timezone,
  });
}

export function normalizeFullJsonExport(value: unknown): FullJsonExport {
  return fullJsonExportSchema.parse(value);
}

export function serializeFullJsonExport(
  document: FullJsonExport,
  options: { maximumBytes?: number } = {},
): string {
  const maximumBytes = options.maximumBytes ?? FULL_JSON_EXPORT_LIMITS.BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer.");
  }
  const json = `${JSON.stringify(fullJsonExportSchema.parse(document))}\n`;
  if (new TextEncoder().encode(json).byteLength > maximumBytes) {
    throw new FullJsonExportError("OUTPUT_TOO_LARGE");
  }
  return json;
}
