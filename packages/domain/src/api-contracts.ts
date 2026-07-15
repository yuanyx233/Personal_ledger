import * as z from "zod";

import {
  CONNECTION_FAILURE_CODES,
  CONNECTION_NEXT_ACTION_CODES,
  CONNECTION_STATUSES,
  CONSENT_STATES,
} from "./connection-health";

export const API_ERROR_CODES = [
  "ACCESS_ASSERTION_MISSING",
  "ACCESS_ASSERTION_INVALID",
  "ACCESS_OWNER_MISMATCH",
  "APP_NOT_READY",
  "ADDITIONAL_ITEM_CONFIRMATION_REQUIRED",
  "BAD_REQUEST",
  "FORBIDDEN",
  "CSRF_INVALID",
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

export const accountEnabledUpdateRequestSchema = z.strictObject({
  enabled: z.boolean(),
  version: optimisticVersionSchema,
});

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

export const linkTokenResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    expiresAt: z.iso.datetime(),
    linkToken: z.string().min(1).max(2048),
  }),
  z.strictObject({}),
);

export const linkTokenRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    confirmAdditionalItem: z.literal(true).optional(),
    institutionCode: z.enum(["RBC", "BMO"]),
    mode: z.literal("INITIAL"),
  }),
  z.strictObject({
    connectionId: z.string().min(1).max(160),
    mode: z.literal("UPDATE"),
    reason: z.enum(["LOGIN_REQUIRED", "CONSENT_RENEWAL", "ACCOUNT_SELECTION"]),
  }),
]);

export const publicTokenExchangeRequestSchema = z.strictObject({
  publicToken: z.string().min(1).max(2048),
});

export const connectionIdSchema = z
  .string()
  .regex(/^connection-[A-Za-z0-9_-]{1,149}$/)
  .brand<"ConnectionId">();

export const syncRunIdSchema = z
  .string()
  .regex(/^sync-run-[A-Za-z0-9_-]{1,151}$/)
  .brand<"SyncRunId">();

export const syncRunCreateRequestSchema = z.strictObject({
  connectionId: connectionIdSchema,
});

export const syncRunDispatchInputSchema = z.strictObject({
  connectionId: connectionIdSchema,
  runId: syncRunIdSchema,
});

export const syncRunReadModelSchema = z.strictObject({
  attemptCount: z.int().nonnegative(),
  connectionId: connectionIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  id: syncRunIdSchema,
  lastErrorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .nullable(),
  nextAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  status: z.enum(["QUEUED", "RUNNING", "RETRY_WAIT", "SUCCEEDED", "FAILED", "PAUSED"]),
  trigger: z.enum(["WEBHOOK", "SCHEDULED", "MANUAL", "INITIAL"]),
  version: optimisticVersionSchema,
});

export const syncRunCreateResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ syncRun: syncRunReadModelSchema }),
  z.strictObject({ replayed: z.boolean(), reusedActive: z.boolean() }),
);

export const syncRunStatusResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ syncRun: syncRunReadModelSchema }),
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

export const connectionCreationResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    connection: z.strictObject({
      accounts: z.array(
        z.strictObject({
          currency: currencyCodeSchema,
          displayName: z.string().min(1).max(256),
          enabled: z.boolean(),
          id: z.string().min(1).max(160),
          subtype: z.enum(["CHECKING", "CREDIT_CARD"]),
          type: z.enum(["DEPOSITORY", "CREDIT"]),
        }),
      ),
      id: z.string().min(1).max(160),
      institutionCode: z.enum(["RBC", "BMO"]),
      institutionName: z.string().min(1).max(256),
      status: z.literal("HEALTHY"),
    }),
  }),
  z.strictObject({ replayed: z.boolean() }),
);

export const accountReadModelSchema = z.strictObject({
  currency: currencyCodeSchema,
  displayName: z.string().min(1).max(256),
  enabled: z.boolean(),
  id: z.string().min(1).max(160),
  mask: z.string().max(32).nullable(),
  subtype: z.enum(["CHECKING", "CREDIT_CARD"]),
  type: z.enum(["DEPOSITORY", "CREDIT"]),
  version: optimisticVersionSchema,
});

export const accountUpdateResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({ account: accountReadModelSchema }),
  z.strictObject({}),
);

export const connectionsResponseSchema = apiSuccessEnvelopeSchema(
  z.strictObject({
    connections: z.array(
      z.strictObject({
        accounts: z.array(accountReadModelSchema),
        consentExpiresAt: z.iso.datetime().nullable(),
        consentState: z.enum(CONSENT_STATES),
        id: z.string().min(1).max(160),
        institutionCode: z.enum(["RBC", "BMO"]),
        institutionName: z.string().min(1).max(256),
        lastFailureCode: z.enum(CONNECTION_FAILURE_CODES).nullable(),
        lastSuccessAt: z.iso.datetime().nullable(),
        nextActionCode: z.enum(CONNECTION_NEXT_ACTION_CODES),
        status: z.enum(CONNECTION_STATUSES),
        version: optimisticVersionSchema,
      }),
    ),
  }),
  z.strictObject({}),
);

export const moneyDirectionSchema = z.enum(["INFLOW", "OUTFLOW"]);

export const moneySchema = z.strictObject({
  amountMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  direction: moneyDirectionSchema,
});

export const calendarDateSchema = z.iso.date().brand<"CalendarDate">();

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type LinkTokenResponse = z.infer<typeof linkTokenResponseSchema>;
export type LinkTokenRequest = z.infer<typeof linkTokenRequestSchema>;
export type ConnectionCreationResponse = z.infer<typeof connectionCreationResponseSchema>;
export type SyncRunDispatchInput = z.infer<typeof syncRunDispatchInputSchema>;
export type SyncRunReadModel = z.infer<typeof syncRunReadModelSchema>;
export type AccountReadModel = z.infer<typeof accountReadModelSchema>;
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>;
export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;
export type CursorPaginationMeta = z.infer<typeof cursorPaginationMetaSchema>;
export type Money = z.infer<typeof moneySchema>;

export interface SyncWorkerService {
  syncConnection(input: SyncRunDispatchInput): Promise<void>;
}
