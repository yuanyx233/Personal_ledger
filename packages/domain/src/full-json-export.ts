import * as z from "zod";

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

const connectionSchema = z.strictObject({
  createdAt: timestampSchema,
  id: idSchema,
  institutionId: z.string().min(1).max(256),
  institutionName: z.string().min(1).max(512),
  updatedAt: timestampSchema,
  version: versionSchema,
});

const accountSchema = z.strictObject({
  connectionId: idSchema,
  createdAt: timestampSchema,
  currency: currencySchema,
  displayName: z.string().min(1).max(512),
  enabled: z.boolean(),
  id: idSchema,
  subtype: z.enum(["CHECKING", "CREDIT_CARD"]),
  type: z.enum(["DEPOSITORY", "CREDIT"]),
  updatedAt: timestampSchema,
  version: versionSchema,
});

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

const plaidPersonalFinanceCategorySchema = z.strictObject({
  confidenceLevel: z.enum(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]).nullable(),
  detailed: z.string().min(1).max(160),
  primary: z.string().min(1).max(160),
});

const transactionSchema = z
  .strictObject({
    accountId: idSchema.nullable(),
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
    merchantName: textSchema.nullable(),
    needsReview: z.boolean(),
    normalizedMerchant: z.string().min(1).max(256).nullable(),
    paymentMetadata: transactionPaymentMetadataSchema,
    pendingTransactionId: idSchema.nullable(),
    plaidPersonalFinanceCategory: plaidPersonalFinanceCategorySchema.nullable(),
    postedDate: dateSchema,
    providerTransactionId: z.string().min(1).max(512).nullable(),
    reviewReason: z.string().min(1).max(256).nullable(),
    source: z.enum(["PLAID", "MANUAL", "CSV"]),
    status: z.enum(["PENDING", "POSTED", "REMOVED"]),
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine((transaction) => transaction.reimbursementMinor <= transaction.amountMinor, {
    message: "Reimbursement cannot exceed the transaction amount.",
    path: ["reimbursementMinor"],
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

const transferEvidenceSchema = z.strictObject({
  amountMinor: z.int().nonnegative(),
  currency: currencySchema,
  dayDifference: z.int().min(0).max(3),
  reason: z
    .enum(["EVIDENCE_MISSING", "MULTIPLE_CANDIDATES", "TEXT_ONLY_EVIDENCE", "CREDIT_CARD_PAYMENT"])
    .nullable(),
  signals: z.array(z.enum(["DESCRIPTION", "PAYMENT_METHOD"])).max(2),
});

const transferMatchSchema = z.strictObject({
  confidence: z.enum(["HIGH", "AMBIGUOUS"]),
  createdAt: timestampSchema,
  decisionReason: z.string().min(1).max(256).nullable(),
  evidence: transferEvidenceSchema,
  id: idSchema,
  leftTransactionId: idSchema,
  rightTransactionId: idSchema,
  status: z.enum(["AUTO_CONFIRMED", "PENDING_REVIEW", "CONFIRMED", "BROKEN", "IGNORED"]),
  updatedAt: timestampSchema,
  version: versionSchema,
});

const transferMatchAuditSchema = z.strictObject({
  action: z.enum(["CONFIRM", "BREAK", "IGNORE"]),
  createdAt: timestampSchema,
  id: idSchema,
  matchVersion: z.int().min(2),
  newStatus: z.enum(["CONFIRMED", "BROKEN", "IGNORED"]),
  oldStatus: z.enum(["AUTO_CONFIRMED", "PENDING_REVIEW", "CONFIRMED", "BROKEN", "IGNORED"]),
  reason: z.enum(["OWNER_CONFIRMED", "OWNER_BROKE", "OWNER_IGNORED"]),
  transferMatchId: idSchema,
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

const importRowV1Schema = z.strictObject({
  batchId: idSchema,
  canonicalFingerprint: sha256Schema.nullable(),
  createdAt: timestampSchema,
  errors: z.array(csvImportRowErrorSchema),
  id: idSchema,
  raw: exportCsvImportRawRowSchema,
  rowNumber: z.int().positive(),
  transactionId: idSchema.nullable(),
  validationStatus: z.enum(["VALID", "INVALID", "DUPLICATE", "IMPORTED"]),
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

const importRowSchema = importRowV1Schema.extend({
  matchEvidence: importMatchEvidenceSchema.nullable(),
  resolution: z.enum([
    "UNRESOLVED",
    "IMPORTED_NEW",
    "AUTO_MERGED",
    "OWNER_MERGED",
    "SKIPPED_INVALID",
    "SKIPPED_DUPLICATE",
  ]),
  resolvedAt: timestampSchema.nullable(),
});

const subscriptionSchema = z.strictObject({
  cancellationEffectiveDate: dateSchema.nullable().optional(),
  accountLabel: z.string().min(1).max(160),
  amountMinor: z.int().positive(),
  anchorDay: z.int().min(1).max(31),
  cadence: z.enum(["MONTHLY", "YEARLY"]),
  categoryId: idSchema,
  createdAt: timestampSchema,
  currency: z.enum(["CAD", "USD"]),
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

const fullJsonExportDataV1Schema = z.strictObject({
  accounts: z.array(accountSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  categories: z.array(categorySchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  categoryAudits: z.array(categoryAuditSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  connections: z.array(connectionSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  importBatches: z.array(importBatchSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  importRows: z.array(importRowV1Schema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  merchantRules: z.array(merchantRuleSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  transactions: z.array(transactionSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  transferMatchAudits: z
    .array(transferMatchAuditSchema)
    .max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  transferMatches: z.array(transferMatchSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
});

const fullJsonExportDataV2Schema = z.strictObject({
  ...fullJsonExportDataV1Schema.shape,
  importRows: z.array(importRowSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  subscriptionOccurrences: z
    .array(subscriptionOccurrenceSchema)
    .max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
  subscriptions: z.array(subscriptionSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
});

export const fullJsonExportDataSchema = fullJsonExportDataV2Schema.extend({
  budgets: z.array(budgetRecordSchema).max(FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION),
});

const recordCountsV1Schema = z.strictObject({
  accounts: z.int().nonnegative(),
  categories: z.int().nonnegative(),
  categoryAudits: z.int().nonnegative(),
  connections: z.int().nonnegative(),
  importBatches: z.int().nonnegative(),
  importRows: z.int().nonnegative(),
  merchantRules: z.int().nonnegative(),
  transactions: z.int().nonnegative(),
  transferMatchAudits: z.int().nonnegative(),
  transferMatches: z.int().nonnegative(),
});

const recordCountsSchema = z.strictObject({
  ...recordCountsV1Schema.shape,
  subscriptionOccurrences: z.int().nonnegative(),
  subscriptions: z.int().nonnegative(),
});

export const fullJsonExportV1Schema = z
  .strictObject({
    data: fullJsonExportDataV1Schema,
    exportKind: z.literal("PERSONAL_LEDGER_FULL"),
    exportedAt: timestampSchema,
    recordCounts: recordCountsV1Schema,
    schemaVersion: z.literal(1),
    timezone: z.literal("America/Toronto"),
  })
  .superRefine((document, context) => {
    for (const key of Object.keys(document.data) as Array<
      keyof z.infer<typeof fullJsonExportDataV1Schema>
    >) {
      if (document.recordCounts[key] !== document.data[key].length) {
        context.addIssue({
          code: "custom",
          message: `recordCounts.${key} must match data.${key}.length`,
          path: ["recordCounts", key],
        });
      }
    }
  });

const fullJsonExportV2Schema = z
  .strictObject({
    data: fullJsonExportDataV2Schema,
    exportKind: z.literal("PERSONAL_LEDGER_FULL"),
    exportedAt: timestampSchema,
    recordCounts: recordCountsSchema,
    schemaVersion: z.literal(2),
    timezone: z.literal("America/Toronto"),
  })
  .superRefine((document, context) => {
    for (const key of Object.keys(document.data) as Array<
      keyof z.infer<typeof fullJsonExportDataV2Schema>
    >) {
      if (document.recordCounts[key] !== document.data[key].length) {
        context.addIssue({
          code: "custom",
          message: `recordCounts.${key} must match data.${key}.length`,
          path: ["recordCounts", key],
        });
      }
    }
  });

export const fullJsonExportSchema = z
  .strictObject({
    ...fullJsonExportV2Schema.shape,
    data: fullJsonExportDataSchema,
    recordCounts: recordCountsSchema.extend({ budgets: z.int().nonnegative() }),
    schemaVersion: z.literal(4),
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

// v3 backups predate effective cancellation dates; keep accepting their original shape.
const fullJsonExportV3Schema = z
  .strictObject({
    ...fullJsonExportSchema.shape,
    schemaVersion: z.literal(3),
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
    accounts: data.accounts.length,
    categories: data.categories.length,
    categoryAudits: data.categoryAudits.length,
    connections: data.connections.length,
    importBatches: data.importBatches.length,
    importRows: data.importRows.length,
    merchantRules: data.merchantRules.length,
    subscriptionOccurrences: data.subscriptionOccurrences.length,
    subscriptions: data.subscriptions.length,
    transactions: data.transactions.length,
    transferMatchAudits: data.transferMatchAudits.length,
    transferMatches: data.transferMatches.length,
  };
}

export function createFullJsonExport(input: {
  data: Omit<
    FullJsonExportData,
    "budgets" | "importRows" | "subscriptionOccurrences" | "subscriptions"
  > & {
    budgets?: FullJsonExportData["budgets"];
    importRows: Array<FullJsonExportData["importRows"][number] | z.infer<typeof importRowV1Schema>>;
    subscriptionOccurrences?: FullJsonExportData["subscriptionOccurrences"];
    subscriptions?: FullJsonExportData["subscriptions"];
  };
  exportedAt: string;
  timezone: "America/Toronto";
}): FullJsonExport {
  const normalizedData = fullJsonExportDataSchema.parse({
    ...input.data,
    budgets: input.data.budgets ?? [],
    importRows: input.data.importRows.map((row) =>
      "resolution" in row
        ? row
        : {
            ...row,
            matchEvidence: null,
            resolution:
              row.validationStatus === "IMPORTED"
                ? "IMPORTED_NEW"
                : row.validationStatus === "INVALID"
                  ? "SKIPPED_INVALID"
                  : row.validationStatus === "DUPLICATE"
                    ? "SKIPPED_DUPLICATE"
                    : "UNRESOLVED",
            resolvedAt: row.validationStatus === "VALID" ? null : row.createdAt,
          },
    ),
    subscriptionOccurrences: input.data.subscriptionOccurrences ?? [],
    subscriptions: input.data.subscriptions ?? [],
  });
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
    schemaVersion: 4,
    timezone: input.timezone,
  });
}

export function normalizeFullJsonExport(value: unknown): FullJsonExport {
  const current = fullJsonExportSchema.safeParse(value);
  if (current.success) return current.data;
  const v3 = fullJsonExportV3Schema.safeParse(value);
  if (v3.success)
    return createFullJsonExport({
      data: v3.data.data,
      exportedAt: v3.data.exportedAt,
      timezone: v3.data.timezone,
    });
  const v2 = fullJsonExportV2Schema.safeParse(value);
  const legacy = v2.success ? v2.data : fullJsonExportV1Schema.parse(value);
  return createFullJsonExport({
    data: legacy.data,
    exportedAt: legacy.exportedAt,
    timezone: legacy.timezone,
  });
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
