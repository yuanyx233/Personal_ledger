import * as z from "zod";
import { merchantFamilySchema } from "./import-categorization";

import { transactionPaymentMetadataSchema } from "./e-transfer";

export { transactionPaymentMetadataSchema };
export type { TransactionPaymentMetadata } from "./e-transfer";

export const API_ERROR_CODES = [
  "ACCESS_ASSERTION_MISSING",
  "ACCESS_ASSERTION_INVALID",
  "ACCESS_OWNER_MISMATCH",
  "APP_NOT_READY",
  "ADDITIONAL_ITEM_CONFIRMATION_REQUIRED",
  "BAD_REQUEST",
  "FORBIDDEN",
  "CSRF_INVALID",
  "CATEGORY_NAME_CONFLICT",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "NO_SUPPORTED_ACCOUNTS",
  "ORIGIN_DENIED",
  "FETCH_METADATA_DENIED",
  "CONFLICT",
  "CONNECTION_NOT_REPAIRABLE",
  "IDEMPOTENCY_CONFLICT",
  "VERSION_CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNSUPPORTED_INSTITUTION",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const API_ERROR_STATUS = {
  ACCESS_ASSERTION_MISSING: 403,
  ACCESS_ASSERTION_INVALID: 403,
  ACCESS_OWNER_MISMATCH: 403,
  APP_NOT_READY: 503,
  ADDITIONAL_ITEM_CONFIRMATION_REQUIRED: 409,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  CATEGORY_NAME_CONFLICT: 409,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NO_SUPPORTED_ACCOUNTS: 422,
  ORIGIN_DENIED: 403,
  FETCH_METADATA_DENIED: 403,
  CONFLICT: 409,
  CONNECTION_NOT_REPAIRABLE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNSUPPORTED_INSTITUTION: 422,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ApiErrorCode, number>;

export const fieldErrorsSchema = z.record(z.string().min(1), z.array(z.string().min(1)).min(1));

export const optimisticVersionSchema = z.int().positive().brand<"OptimisticVersion">();

export const apiErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(240),
    currentVersion: optimisticVersionSchema.optional(),
    fieldErrors: fieldErrorsSchema.optional(),
  }),
});

export function apiSuccessEnvelopeSchema<TData extends z.ZodType, TMeta extends z.ZodType>(
  data: TData,
  meta: TMeta,
) {
  return z.strictObject({ data, meta });
}

export const csrfTokenSchema = z
  .string()
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  .brand<"CsrfToken">();

export const sessionResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    csrfToken: csrfTokenSchema,
    identity: z.strictObject({ email: z.email() }),
    timezone: z.literal("America/Toronto"),
  }),
  z.strictObject({}),
);

export const cursorSchema = z.base64url().min(1).max(512).brand<"Cursor">();

const pageSizeQueryValueSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,2}$/)
  .transform(Number)
  .pipe(z.int().min(1).max(100))
  .default(50);

export const cursorPaginationQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  pageSize: pageSizeQueryValueSchema,
});

export const cursorPaginationMetaSchema = z
  .strictObject({
    hasMore: z.boolean(),
    nextCursor: cursorSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.hasMore && value.nextCursor === null) {
      context.addIssue({
        code: "custom",
        message: "nextCursor is required when hasMore is true.",
        path: ["nextCursor"],
      });
    }

    if (!value.hasMore && value.nextCursor !== null) {
      context.addIssue({
        code: "custom",
        message: "nextCursor must be null when hasMore is false.",
        path: ["nextCursor"],
      });
    }
  });

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .brand<"IdempotencyKey">();

export const amountMinorSchema = z.int().nonnegative().brand<"AmountMinor">();

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .brand<"CurrencyCode">();

export const moneyDirectionSchema = z.enum(["INFLOW", "OUTFLOW"]);

export const moneySchema = z.strictObject({
  amountMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  direction: moneyDirectionSchema,
});

export const calendarDateSchema = z.iso.date().brand<"CalendarDate">();

export const transactionSortSchema = z.enum([
  "POSTED_DATE_DESC",
  "POSTED_DATE_ASC",
  "AMOUNT_DESC",
  "AMOUNT_ASC",
]);

const transactionCategorizationSourceSchema = z.enum(["MANUAL", "RULE", "PLAID", "UNCLASSIFIED"]);
const transactionSourceSchema = z.enum(["PLAID", "MANUAL", "CSV"]);
const transactionStatusSchema = z.enum(["PENDING", "POSTED", "REMOVED"]);
const identifierSchema = z.string().min(1).max(160);

export const categoryReadModelSchema = z.strictObject({
  active: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  editable: z.boolean(),
  id: identifierSchema,
  kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "UNCLASSIFIED"]),
  name: z.string().min(1).max(160),
  systemKey: z.enum(["TRANSFER", "UNCLASSIFIED"]).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
  version: optimisticVersionSchema,
});

export const categoriesResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ categories: z.array(categoryReadModelSchema) }),
  z.strictObject({}),
);

export const categoryCreateRequestSchema = z.strictObject({
  kind: z.literal("EXPENSE"),
  name: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine(
      (value) =>
        !/[<>]/u.test(value) &&
        ![...value].some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
        }),
    ),
});

export const categoryMutationResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ category: categoryReadModelSchema }),
  z.strictObject({}),
);
const needsReviewQueryValueSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
const trueQueryValueSchema = z.literal("true").transform(() => true as const);

export const transactionListQuerySchema = z
  .strictObject({
    accountId: identifierSchema.optional(),
    categorizationSource: transactionCategorizationSourceSchema.optional(),
    categoryId: identifierSchema.optional(),
    currency: currencyCodeSchema.optional(),
    cursor: cursorSchema.optional(),
    dateFrom: calendarDateSchema.optional(),
    dateTo: calendarDateSchema.optional(),
    merchantFamily: merchantFamilySchema.optional(),
    merchantMissing: trueQueryValueSchema.optional(),
    needsReview: needsReviewQueryValueSchema.optional(),
    normalizedMerchant: z.string().min(1).max(256).optional(),
    pageSize: pageSizeQueryValueSchema,
    reportMetric: z.literal("NET_SPENDING").optional(),
    sort: transactionSortSchema.default("POSTED_DATE_DESC"),
    source: transactionSourceSchema.optional(),
    status: transactionStatusSchema.optional(),
  })
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    message: "dateFrom must not be after dateTo.",
    path: ["dateTo"],
  })
  .refine(
    (query) => !query.merchantFamily || (!query.merchantMissing && !query.normalizedMerchant),
    {
      message: "merchantFamily cannot be combined with another merchant filter.",
      path: ["merchantFamily"],
    },
  )
  .refine((query) => !query.merchantMissing || !query.normalizedMerchant, {
    message: "merchantMissing and normalizedMerchant are mutually exclusive.",
    path: ["merchantMissing"],
  })
  .refine((query) => !query.reportMetric || !query.status || query.status === "POSTED", {
    message: "NET_SPENDING drill-down only supports POSTED status.",
    path: ["status"],
  });

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

function uniqueTransactionQueryInput(searchParams: URLSearchParams): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(input, key)) {
      throw new TypeError(`Repeated transaction query key: ${key}`);
    }
    input[key] = value;
  }
  return input;
}

export function parseTransactionListQuery(searchParams: URLSearchParams): TransactionListQuery {
  return transactionListQuerySchema.parse(uniqueTransactionQueryInput(searchParams));
}

export const transactionCsvExportQuerySchema = z
  .strictObject({
    accountId: identifierSchema.optional(),
    categorizationSource: transactionCategorizationSourceSchema.optional(),
    categoryId: identifierSchema.optional(),
    currency: currencyCodeSchema.optional(),
    dateFrom: calendarDateSchema.optional(),
    dateTo: calendarDateSchema.optional(),
    merchantFamily: merchantFamilySchema.optional(),
    merchantMissing: trueQueryValueSchema.optional(),
    needsReview: needsReviewQueryValueSchema.optional(),
    normalizedMerchant: z.string().min(1).max(256).optional(),
    reportMetric: z.literal("NET_SPENDING").optional(),
    sort: transactionSortSchema.default("POSTED_DATE_DESC"),
    source: transactionSourceSchema.optional(),
    status: transactionStatusSchema.optional(),
  })
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    message: "dateFrom must not be after dateTo.",
    path: ["dateTo"],
  })
  .refine(
    (query) => !query.merchantFamily || (!query.merchantMissing && !query.normalizedMerchant),
    {
      message: "merchantFamily cannot be combined with another merchant filter.",
      path: ["merchantFamily"],
    },
  )
  .refine((query) => !query.merchantMissing || !query.normalizedMerchant, {
    message: "merchantMissing and normalizedMerchant are mutually exclusive.",
    path: ["merchantMissing"],
  })
  .refine((query) => !query.reportMetric || !query.status || query.status === "POSTED", {
    message: "NET_SPENDING drill-down only supports POSTED status.",
    path: ["status"],
  });

export type TransactionCsvExportQuery = z.infer<typeof transactionCsvExportQuerySchema>;

export function parseTransactionCsvExportQuery(
  searchParams: URLSearchParams,
): TransactionCsvExportQuery {
  return transactionCsvExportQuerySchema.parse(uniqueTransactionQueryInput(searchParams));
}

export const decimalAmountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,2})?$/)
  .brand<"DecimalAmount">();

export const manualTransactionCurrencySchema = z.enum(["CAD", "USD"]);
export const installmentCountSchema = z.int().min(2).max(60);

const manualTransactionFields = {
  accountLabel: z.string().trim().min(1).max(160),
  amount: decimalAmountSchema,
  reimbursementAmount: decimalAmountSchema.optional(),
  categoryId: z.string().min(1).max(160).optional(),
  currency: manualTransactionCurrencySchema,
  description: z.string().trim().min(1).max(512),
  direction: moneyDirectionSchema,
  postedDate: calendarDateSchema,
} as const;

export const manualTransactionCreateRequestSchema = z
  .strictObject({
    ...manualTransactionFields,
    installmentCount: installmentCountSchema.optional(),
    rememberMerchant: z.literal(true).optional(),
  })
  .refine((value) => Number(value.reimbursementAmount ?? "0") <= Number(value.amount), {
    message: "Reimbursement cannot exceed the transaction amount.",
    path: ["reimbursementAmount"],
  })
  .refine((value) => value.rememberMerchant !== true || value.categoryId !== undefined, {
    message: "A category is required when remembering a merchant.",
    path: ["categoryId"],
  });

export const manualTransactionPreviewRequestSchema = z
  .strictObject({
    accountLabel: manualTransactionFields.accountLabel,
    amount: manualTransactionFields.amount,
    reimbursementAmount: manualTransactionFields.reimbursementAmount,
    currency: manualTransactionFields.currency,
    description: manualTransactionFields.description,
    direction: manualTransactionFields.direction,
    installmentCount: installmentCountSchema.optional(),
    postedDate: manualTransactionFields.postedDate,
  })
  .refine((value) => Number(value.reimbursementAmount ?? "0") <= Number(value.amount), {
    message: "Reimbursement cannot exceed the transaction amount.",
    path: ["reimbursementAmount"],
  });

export const transactionReimbursementRequestSchema = z.strictObject({
  reimbursementAmount: decimalAmountSchema,
  version: optimisticVersionSchema,
});

export const manualTransactionUpdateRequestSchema = z
  .strictObject({
    accountLabel: manualTransactionFields.accountLabel.optional(),
    amount: manualTransactionFields.amount.optional(),
    reimbursementAmount: manualTransactionFields.reimbursementAmount,
    categoryId: manualTransactionFields.categoryId.optional(),
    currency: manualTransactionFields.currency.optional(),
    description: manualTransactionFields.description.optional(),
    direction: manualTransactionFields.direction.optional(),
    postedDate: manualTransactionFields.postedDate.optional(),
    version: optimisticVersionSchema,
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, field]) => key !== "version" && field !== undefined),
    { message: "At least one transaction field is required." },
  );

export const manualTransactionDeleteRequestSchema = z.strictObject({
  version: optimisticVersionSchema,
});

export const transactionCategoryOverrideRequestSchema = z.strictObject({
  categoryId: z.string().min(1).max(160),
  version: optimisticVersionSchema,
});

export const merchantRuleCorrectionRequestSchema = z.strictObject({
  categoryId: z.string().min(1).max(160),
  version: optimisticVersionSchema,
});

export const merchantRuleCreateRequestSchema = z.strictObject({
  categoryId: z.string().min(1).max(160),
  displayMerchant: z.string().trim().min(1).max(256),
});

export const merchantRuleUpdateRequestSchema = z
  .strictObject({
    active: z.boolean().optional(),
    categoryId: z.string().min(1).max(160).optional(),
    displayMerchant: z.string().trim().min(1).max(256).optional(),
    version: optimisticVersionSchema,
  })
  .refine(
    (value) =>
      value.active !== undefined ||
      value.categoryId !== undefined ||
      value.displayMerchant !== undefined,
    { message: "At least one merchant rule field is required." },
  );

export const merchantRuleListQuerySchema = z.strictObject({
  active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  cursor: cursorSchema.optional(),
  pageSize: pageSizeQueryValueSchema,
});

export const merchantRulePreviewQuerySchema = z.strictObject({
  categoryId: z.string().min(1).max(160),
  displayMerchant: z.string().trim().min(1).max(256),
});

export const transactionIdSchema = z
  .string()
  .regex(/^(?:transaction-[A-Za-z0-9_-]{1,148}|csv-[A-Za-z0-9_-]{1,156})$/)
  .brand<"TransactionId">();

const transactionInstallmentSchema = z
  .strictObject({
    count: installmentCountSchema,
    groupId: identifierSchema,
    number: z.int().min(1).max(60),
  })
  .refine((installment) => installment.number <= installment.count, {
    message: "Installment number cannot exceed installment count.",
    path: ["number"],
  });

const transactionReadModelSchema = z.strictObject({
  accountLabel: z.string().min(1).max(160).nullable(),
  amountMinor: amountMinorSchema,
  reimbursementMinor: z.int().nonnegative().default(0),
  authorizedDate: calendarDateSchema.nullable(),
  categorizationSource: transactionCategorizationSourceSchema,
  categoryId: identifierSchema.nullable(),
  categoryRuleId: identifierSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  currency: currencyCodeSchema,
  description: z.string().min(1).max(512),
  direction: moneyDirectionSchema,
  id: transactionIdSchema,
  installment: transactionInstallmentSchema.nullable().optional(),
  merchantName: z.string().max(256).nullable(),
  needsReview: z.boolean(),
  normalizedMerchant: z.string().max(256).nullable(),
  paymentMetadata: transactionPaymentMetadataSchema,
  postedDate: calendarDateSchema,
  reviewReason: z.string().min(1).max(160).nullable(),
  source: transactionSourceSchema,
  status: transactionStatusSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  version: optimisticVersionSchema,
});

const transactionCanonicalQuerySchema = z
  .strictObject({
    accountId: identifierSchema.optional(),
    categorizationSource: transactionCategorizationSourceSchema.optional(),
    categoryId: identifierSchema.optional(),
    currency: currencyCodeSchema.optional(),
    cursor: cursorSchema.optional(),
    dateFrom: calendarDateSchema.optional(),
    dateTo: calendarDateSchema.optional(),
    merchantFamily: merchantFamilySchema.optional(),
    merchantMissing: z.literal(true).optional(),
    needsReview: z.boolean().optional(),
    normalizedMerchant: z.string().min(1).max(256).optional(),
    pageSize: z.int().min(1).max(100),
    reportMetric: z.literal("NET_SPENDING").optional(),
    sort: transactionSortSchema,
    source: transactionSourceSchema.optional(),
    status: transactionStatusSchema.optional(),
  })
  .refine(
    (query) => !query.merchantFamily || (!query.merchantMissing && !query.normalizedMerchant),
    {
      message: "merchantFamily cannot be combined with another merchant filter.",
      path: ["merchantFamily"],
    },
  )
  .refine((query) => !query.merchantMissing || !query.normalizedMerchant, {
    message: "merchantMissing and normalizedMerchant are mutually exclusive.",
    path: ["merchantMissing"],
  })
  .refine((query) => !query.reportMetric || !query.status || query.status === "POSTED", {
    message: "NET_SPENDING drill-down only supports POSTED status.",
    path: ["status"],
  });

const transactionListMetaSchema = z
  .strictObject({
    hasMore: z.boolean(),
    nextCursor: cursorSchema.nullable(),
    query: transactionCanonicalQuerySchema,
  })
  .superRefine((value, context) => {
    if (value.hasMore && value.nextCursor === null) {
      context.addIssue({
        code: "custom",
        message: "nextCursor is required when hasMore is true.",
        path: ["nextCursor"],
      });
    }
    if (!value.hasMore && value.nextCursor !== null) {
      context.addIssue({
        code: "custom",
        message: "nextCursor must be null when hasMore is false.",
        path: ["nextCursor"],
      });
    }
  });

export const transactionListResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ transactions: z.array(transactionReadModelSchema) }),
  transactionListMetaSchema,
);

export const transactionCategoryOverrideResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ transaction: transactionReadModelSchema }),
  z.strictObject({}),
);

export const merchantRuleReadModelSchema = z.strictObject({
  active: z.boolean(),
  categoryId: identifierSchema,
  createdAt: z.iso.datetime({ offset: true }),
  displayMerchant: z.string().min(1).max(256),
  id: identifierSchema,
  normalizedMerchant: z.string().min(1).max(256),
  updatedAt: z.iso.datetime({ offset: true }),
  version: optimisticVersionSchema,
});

export const merchantRuleCorrectionResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    merchantRule: merchantRuleReadModelSchema,
    transaction: transactionReadModelSchema,
  }),
  z.strictObject({ historicalTransactionsChanged: z.literal(0) }),
);

export const merchantRuleImpactSchema = z.strictObject({
  conflictingTransactions: z.int().nonnegative(),
  historicalTransactionsChanged: z.literal(0),
  matchingTransactions: z.int().nonnegative(),
});

const merchantRuleCanonicalQuerySchema = z.strictObject({
  active: z.boolean().optional(),
  cursor: cursorSchema.optional(),
  pageSize: z.int().min(1).max(100),
});

export const merchantRuleListResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ rules: z.array(merchantRuleReadModelSchema) }),
  z
    .strictObject({
      hasMore: z.boolean(),
      nextCursor: cursorSchema.nullable(),
      query: merchantRuleCanonicalQuerySchema,
    })
    .superRefine((value, context) => {
      if (value.hasMore !== (value.nextCursor !== null)) {
        context.addIssue({
          code: "custom",
          message: "nextCursor presence must match hasMore.",
          path: ["nextCursor"],
        });
      }
    }),
);

export const merchantRuleMutationResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ merchantRule: merchantRuleReadModelSchema }),
  merchantRuleImpactSchema,
);

export const merchantRulePreviewResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    existingRule: merchantRuleReadModelSchema.nullable(),
    proposedRule: z.strictObject({
      categoryId: identifierSchema,
      displayMerchant: z.string().min(1).max(256),
      normalizedMerchant: z.string().min(1).max(256),
    }),
  }),
  merchantRuleImpactSchema,
);

const categoryAuditReadModelSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: identifierSchema,
  newCategoryId: identifierSchema.nullable(),
  newCategoryRuleId: identifierSchema.nullable(),
  newSource: transactionCategorizationSourceSchema,
  oldCategoryId: identifierSchema.nullable(),
  oldCategoryRuleId: identifierSchema.nullable(),
  oldSource: transactionCategorizationSourceSchema,
  reason: z.string().min(1).max(160),
});

export const transactionDetailResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    transaction: transactionReadModelSchema.extend({
      categoryAudits: z.array(categoryAuditReadModelSchema),
      lifecycle: z.strictObject({
        pendingTransactionId: transactionIdSchema.nullable(),
        replacedByTransactionId: transactionIdSchema.nullable(),
      }),
    }),
  }),
  z.strictObject({}),
);

export const manualTransactionReadModelSchema = z.strictObject({
  accountLabel: z.string().min(1).max(160),
  amountMinor: amountMinorSchema,
  reimbursementMinor: z.int().nonnegative().default(0),
  categorizationSource: z.enum(["MANUAL", "RULE", "UNCLASSIFIED"]),
  categoryId: z.string().min(1).max(160),
  createdAt: z.iso.datetime({ offset: true }),
  currency: manualTransactionCurrencySchema,
  description: z.string().min(1).max(512),
  direction: moneyDirectionSchema,
  id: transactionIdSchema,
  installment: transactionInstallmentSchema.nullable().optional(),
  merchantName: z.string().min(1).max(256),
  normalizedMerchant: z.string().min(1).max(256),
  postedDate: calendarDateSchema,
  source: z.literal("MANUAL"),
  status: z.enum(["POSTED", "REMOVED"]),
  updatedAt: z.iso.datetime({ offset: true }),
  version: optimisticVersionSchema,
});

export const manualTransactionCreateResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    categoryConfirmationRequired: z.boolean(),
    transaction: manualTransactionReadModelSchema.extend({ status: z.literal("POSTED") }),
    transactions: z
      .array(manualTransactionReadModelSchema.extend({ status: z.literal("POSTED") }))
      .min(1)
      .max(60)
      .optional(),
  }),
  z.strictObject({}),
);

export const manualTransactionPreviewResponseSchema = apiSuccessEnvelopeSchema(
  z.discriminatedUnion("kind", [
    z.strictObject({ category: categoryReadModelSchema, kind: z.literal("KNOWN_MERCHANT") }),
    z.strictObject({ category: categoryReadModelSchema, kind: z.literal("NEW_MERCHANT") }),
  ]),
  z.strictObject({}),
);

export const manualTransactionMutationResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ transaction: manualTransactionReadModelSchema }),
  z.strictObject({}),
);

export type CategoryReadModel = z.infer<typeof categoryReadModelSchema>;
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;
export type ManualTransactionPreviewResponse = z.infer<
  typeof manualTransactionPreviewResponseSchema
>;
export type MerchantRuleListResponse = z.infer<typeof merchantRuleListResponseSchema>;
export type MerchantRulePreviewResponse = z.infer<typeof merchantRulePreviewResponseSchema>;
export type TransactionListResponse = z.infer<typeof transactionListResponseSchema>;
export type TransactionDetailResponse = z.infer<typeof transactionDetailResponseSchema>;

export const accountOptionsResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    accounts: z.array(
      z.strictObject({ id: z.string().min(1).max(160), displayName: z.string().min(1).max(160) }),
    ),
  }),
  z.strictObject({}),
);
export type AccountOptionsResponse = z.infer<typeof accountOptionsResponseSchema>;

export function decimalAmountToMinorUnits(value: string, currency: unknown): number {
  manualTransactionCurrencySchema.parse(currency);
  const parsed = decimalAmountSchema.parse(value);
  const [whole = "0", fractional = ""] = parsed.split(".");
  return Number(BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0")));
}

export function parseMerchantRuleListQuery(searchParams: URLSearchParams) {
  return parseUniqueSearchParams(searchParams, merchantRuleListQuerySchema);
}

export function parseMerchantRulePreviewQuery(searchParams: URLSearchParams) {
  return parseUniqueSearchParams(searchParams, merchantRulePreviewQuerySchema);
}

function parseUniqueSearchParams<T>(searchParams: URLSearchParams, schema: z.ZodType<T>): T {
  const input: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(input, key)) throw new TypeError(`Repeated query key: ${key}`);
    input[key] = value;
  }
  return schema.parse(input);
}
