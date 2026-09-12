import {
  API_PREFIX,
  budgetMonthSchema,
  budgetSettingSchema,
  subscriptionCreateSchema,
  subscriptionMutationSchema,
  torontoDate,
  CsvImportError,
  FullJsonExportError,
  TransactionCsvExportError,
  applyActiveCategoryReferences,
  applyExistingMatches,
  applySuspectedDuplicateKeys,
  csvImportBatchIdSchema,
  csvImportCommitRequestSchema,
  csvImportContentChecksum,
  csvImportFileNameHash,
  csvImportPreviewRequestSchema,
  createFullJsonExport,
  decodeCsvBase64,
  mergeCashFlowCurrencySections,
  manualDefaultCategory,
  merchantRequiresCategoryConfirmation,
  normalizeMerchantName,
  parseCsvPreview,
  parseCashFlowReportQuery,
  parseSpendingReportQuery,
  serializeTransactionCsv,
  serializeFullJsonExport,
  type TransactionCsvRow,
} from "@ledger/domain";
import {
  categoryCreateRequestSchema,
  decimalAmountToMinorUnits,
  idempotencyKeySchema,
  manualTransactionCreateRequestSchema,
  manualTransactionPreviewRequestSchema,
  transactionReimbursementRequestSchema,
  manualTransactionDeleteRequestSchema,
  manualTransactionUpdateRequestSchema,
  merchantRuleCorrectionRequestSchema,
  merchantRuleCreateRequestSchema,
  merchantRuleUpdateRequestSchema,
  parseTransactionCsvExportQuery,
  parseTransactionListQuery,
  parseMerchantRuleListQuery,
  parseMerchantRulePreviewQuery,
  transactionCategoryOverrideRequestSchema,
  transactionIdSchema,
} from "@ledger/domain/api-contracts";
import { createStructuredLogger, type StructuredLogger } from "@ledger/domain/logging";
import {
  RequestLimitError,
  enforceRequestLimits,
  resolveAppRequestPolicy,
} from "@ledger/domain/request-limits";
import {
  CategoryRepository,
  BudgetRepository,
  SubscriptionRepository,
  SubscriptionError,
  CsvImportCommitPersistenceError,
  CsvImportCommitRepository,
  CsvImportPreviewPersistenceError,
  CsvImportPreviewRepository,
  FinancialReportPersistenceError,
  FinancialReportRepository,
  FullJsonExportPersistenceError,
  FullJsonExportRepository,
  ManualTransactionPersistenceError,
  ManualTransactionRepository,
  MerchantRuleCorrectionRepository,
  MerchantRuleManagementPersistenceError,
  MerchantRuleManagementRepository,
  TransactionCategoryOverrideRepository,
  TransactionCsvExportPersistenceError,
  TransactionQueryError,
  TransactionRepository,
  type ManualTransactionRecord,
  type MerchantRuleRecord,
  type TransactionDetailRecord,
  type TransactionCsvExportRecord,
  type TransactionRecord,
} from "@ledger/persistence";

import {
  AccessDeniedError,
  createRemoteAccessVerifier,
  type AccessIdentity,
  type AccessRequestVerifier,
  type AccessVerifierConfig,
} from "./security/access";
import { issueCsrfToken } from "./security/csrf";
import { RequestGuardError, validateApiRequest } from "./security/request-guard";
import { applySecurityHeaders } from "./security/response-headers";

export interface AppEnv {
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  API_RATE_LIMITER: RateLimit;
  APP_TIMEZONE: "America/Toronto";
  ASSETS: Fetcher;
  CSRF_HMAC_KEY: string;
  DB: D1Database;
  OWNER_EMAIL: string;
}

export type AccessGate = (request: Request, env: AppEnv) => Promise<AccessIdentity>;
export type AccessVerifierFactory = (config: AccessVerifierConfig) => AccessRequestVerifier;
export type FullJsonExportFileFactory = (input: {
  database: D1Database;
  exportedAt: string;
  timezone: "America/Toronto";
}) => Promise<string>;

const NOOP_LOGGER: StructuredLogger = { write: () => false };

export function createConfiguredAccessGate(
  createVerifier: AccessVerifierFactory = createRemoteAccessVerifier,
): AccessGate {
  let cachedVerifier: { cacheKey: string; verify: AccessRequestVerifier } | undefined;

  return (request, env) => {
    const cacheKey = `${env.ACCESS_TEAM_DOMAIN}\u0000${env.ACCESS_AUD}\u0000${env.OWNER_EMAIL}`;
    if (!cachedVerifier || cachedVerifier.cacheKey !== cacheKey) {
      cachedVerifier = {
        cacheKey,
        verify: createVerifier({
          audience: env.ACCESS_AUD,
          ownerEmail: env.OWNER_EMAIL,
          teamDomain: env.ACCESS_TEAM_DOMAIN,
        }),
      };
    }
    return cachedVerifier.verify(request);
  };
}

function accessDenied(code: AccessDeniedError["code"]): Response {
  return Response.json(
    {
      error: {
        code,
        message: "Access denied.",
      },
    },
    { status: 403 },
  );
}

function requestDenied(error: RequestGuardError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: "Request denied.",
      },
    },
    { status: error.status },
  );
}

function internalError(): Response {
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    },
    { status: 500 },
  );
}

function methodNotAllowed(): Response {
  return Response.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "This method is not allowed.",
      },
    },
    { status: 405 },
  );
}

function notFound(): Response {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "The requested resource was not found." } },
    { status: 404 },
  );
}

function versionConflict(
  currentVersion: number,
  resource: "merchant rule" | "transaction",
): Response {
  return Response.json(
    {
      error: {
        code: "VERSION_CONFLICT",
        currentVersion,
        message: `The ${resource} changed. Refresh and try again.`,
      },
    },
    { status: 409 },
  );
}

function merchantRuleConflict(): Response {
  return Response.json(
    {
      error: {
        code: "CONFLICT",
        message: "An exact merchant rule already uses that normalized merchant.",
      },
    },
    { status: 409 },
  );
}

function categoryNameConflict(): Response {
  return Response.json(
    {
      error: {
        code: "CATEGORY_NAME_CONFLICT",
        message: "A category with that normalized name already exists.",
      },
    },
    { status: 409 },
  );
}

function merchantCategoryConfirmationRequired(): Response {
  return Response.json(
    {
      error: {
        code: "CONFLICT",
        message: "Confirm a category for this merchant before recording the transaction.",
      },
    },
    { status: 409 },
  );
}

function requestLimitDenied(error: RequestLimitError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message:
          error.code === "PAYLOAD_TOO_LARGE"
            ? "Request payload is too large."
            : "Request parameters are invalid.",
      },
    },
    { status: error.status },
  );
}

function csvImportDenied(error: CsvImportError): Response {
  return Response.json(
    {
      error: {
        code: error.status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
        fieldErrors: { contentBase64: [error.code] },
        message:
          error.status === 413
            ? "The CSV file is too large."
            : "The CSV file or mapping is invalid.",
      },
    },
    { status: error.status },
  );
}

function csvImportCommitDenied(error: CsvImportCommitPersistenceError): Response {
  if (error.code === "NOT_FOUND") {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "The CSV preview was not found." } },
      { status: 404 },
    );
  }
  if (error.code === "INVALID_INPUT") {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "CSV duplicate decisions are incomplete or invalid.",
        },
      },
      { status: 422 },
    );
  }
  if (error.code === "VERSION_CONFLICT") {
    return Response.json(
      {
        error: {
          code: "VERSION_CONFLICT",
          ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
          message: "The CSV preview version is stale.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "IDEMPOTENCY_CONFLICT") {
    return Response.json(
      {
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "The idempotency key is already in use.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "PREVIEW_EXPIRED" || error.code === "CONFLICT") {
    return Response.json(
      {
        error: {
          code: "CONFLICT",
          message:
            error.code === "PREVIEW_EXPIRED"
              ? "The CSV preview has expired. Create a new preview before committing."
              : "The CSV preview can no longer be committed.",
        },
      },
      { status: 409 },
    );
  }
  return internalError();
}

function rateLimited(): Response {
  const response = Response.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests." } },
    { status: 429 },
  );
  response.headers.set("Retry-After", "60");
  return response;
}

function parseJsonBody(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body));
  } catch {
    return undefined;
  }
}

function* chunkBytes(bytes: Uint8Array, chunkSize = 64 * 1024): Iterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.slice(offset, offset + chunkSize);
  }
}

function csvPreviewRowReadModel(row: Awaited<ReturnType<typeof parseCsvPreview>>["rows"][number]) {
  return {
    canonicalFingerprint: row.canonicalFingerprint,
    duplicateEvidence: row.duplicateEvidence,
    errors: row.errors,
    existingMatch: row.existingMatch,
    raw: row.raw,
    rowNumber: row.rowNumber,
    status: row.status,
  };
}

function manualTransactionReadModel(transaction: ManualTransactionRecord) {
  const merchantName = transaction.merchantName ?? transaction.rawDescription.trim().slice(0, 256);
  const normalizedMerchant =
    transaction.normalizedMerchant ?? normalizeMerchantName(merchantName) ?? merchantName;
  return {
    accountLabel: transaction.accountLabel,
    amountMinor: transaction.amountMinor,
    reimbursementMinor: transaction.reimbursementMinor,
    categorizationSource: transaction.categorizationSource,
    categoryId: transaction.categoryId,
    createdAt: transaction.createdAt,
    currency: transaction.currency,
    description: transaction.rawDescription,
    direction: transaction.direction,
    id: transaction.id,
    installment: transaction.installment,
    merchantName,
    normalizedMerchant,
    postedDate: transaction.postedDate,
    source: transaction.source,
    status: transaction.status,
    updatedAt: transaction.updatedAt,
    version: transaction.version,
  };
}

function transactionReadModel(transaction: TransactionRecord) {
  return {
    accountLabel: transaction.accountLabel,
    amountMinor: transaction.amountMinor,
    reimbursementMinor: transaction.reimbursementMinor,
    authorizedDate: transaction.authorizedDate,
    categorizationSource: transaction.categorizationSource,
    categoryId: transaction.categoryId,
    categoryRuleId: transaction.categoryRuleId,
    createdAt: transaction.createdAt,
    currency: transaction.currency,
    description: transaction.rawDescription,
    direction: transaction.direction,
    id: transaction.id,
    installment: transaction.installment,
    merchantName: transaction.merchantName,
    needsReview: transaction.needsReview,
    normalizedMerchant: transaction.normalizedMerchant,
    paymentMetadata: transaction.paymentMetadata,
    postedDate: transaction.postedDate,
    reviewReason: transaction.reviewReason,
    source: transaction.source,
    status: transaction.status,
    updatedAt: transaction.updatedAt,
    version: transaction.version,
  };
}

function transactionCsvRow(transaction: TransactionCsvExportRecord): TransactionCsvRow {
  return {
    accountLabel: transaction.accountLabel,
    amountMinor: transaction.amountMinor,
    reimbursementMinor: transaction.reimbursementMinor,
    authorizedDate: transaction.authorizedDate,
    bankConfirmation: transaction.bankConfirmation,
    categorizationSource: transaction.categorizationSource,
    categoryId: transaction.categoryId,
    categoryName: transaction.categoryName,
    categoryRuleDisplayMerchant: transaction.categoryRuleDisplayMerchant,
    categoryRuleId: transaction.categoryRuleId,
    currency: transaction.currency,
    description: transaction.rawDescription,
    direction: transaction.direction,
    id: transaction.id,
    importMatchCount: transaction.importMatchCount,
    merchantName: transaction.merchantName,
    needsReview: transaction.needsReview,
    normalizedMerchant: transaction.normalizedMerchant,
    postedDate: transaction.postedDate,
    reviewReason: transaction.reviewReason,
    source: transaction.source,
    status: transaction.status,
    subscriptionId: transaction.subscriptionId,
    subscriptionScheduledDate: transaction.subscriptionScheduledDate,
  };
}

function merchantRuleReadModel(rule: MerchantRuleRecord) {
  return {
    active: rule.active,
    categoryId: rule.categoryId,
    createdAt: rule.createdAt,
    displayMerchant: rule.displayMerchant,
    id: rule.id,
    normalizedMerchant: rule.normalizedMerchant,
    updatedAt: rule.updatedAt,
    version: rule.version,
  };
}

function transactionDetailReadModel(detail: TransactionDetailRecord) {
  return {
    ...transactionReadModel(detail.transaction),
    categoryAudits: detail.categoryAudits,
    lifecycle: detail.lifecycle,
  };
}

const createFullJsonExportFile: FullJsonExportFileFactory = async (input) => {
  const data = await new FullJsonExportRepository(input.database).readSnapshot();
  return serializeFullJsonExport(
    createFullJsonExport({
      data,
      exportedAt: input.exportedAt,
      timezone: input.timezone,
    }),
  );
};

export function createAppWorker(
  verifyAccess: AccessGate = createConfiguredAccessGate(),
  logger: StructuredLogger = NOOP_LOGGER,
  now: () => Date = () => new Date(),
  createJsonExport: FullJsonExportFileFactory = createFullJsonExportFile,
) {
  return {
    async scheduled(_controller: ScheduledController, env: AppEnv): Promise<void> {
      try {
        const generated = await new SubscriptionRepository(env.DB).generateDue(now().toISOString());
        logger.write({
          event: "SUBSCRIPTION_SCHEDULE",
          level: "INFO",
          outcome: "SUCCESS",
          generated,
        });
      } catch {
        logger.write({
          event: "SUBSCRIPTION_SCHEDULE",
          level: "ERROR",
          outcome: "FAILED",
          errorCode: "INTERNAL_ERROR",
        });
        throw new Error("Subscription scheduling failed.");
      }
    },
    async fetch(request: Request, env: AppEnv): Promise<Response> {
      const url = new URL(request.url);
      const isApiRequest = url.pathname.startsWith(API_PREFIX);
      const secure = (response: Response, noStore = isApiRequest): Response =>
        applySecurityHeaders(response, noStore);

      let identity: AccessIdentity;
      try {
        identity = await verifyAccess(request, env);
      } catch (error) {
        const code = error instanceof AccessDeniedError ? error.code : "ACCESS_ASSERTION_INVALID";
        logger.write({
          errorCode: code,
          event: "ACCESS_CHECK",
          level: "WARN",
          outcome: "DENIED",
          status: 403,
        });
        return secure(accessDenied(code), true);
      }

      if (isApiRequest) {
        let requestBody: Uint8Array;
        try {
          await validateApiRequest(request, identity, env.CSRF_HMAC_KEY);
        } catch (error) {
          const denied =
            error instanceof RequestGuardError ? error : new RequestGuardError("CSRF_INVALID", 403);
          logger.write({
            errorCode: denied.code,
            event: "API_REQUEST",
            level: "WARN",
            outcome: "DENIED",
            status: denied.status,
          });
          return secure(requestDenied(denied));
        }
        const requestPolicy = resolveAppRequestPolicy(request);
        try {
          const rateLimit = await env.API_RATE_LIMITER.limit({
            key: `${identity.sessionBinding}:${requestPolicy.routeId}`,
          });
          if (!rateLimit.success) {
            logger.write({
              errorCode: "RATE_LIMITED",
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: 429,
            });
            return secure(rateLimited());
          }
          requestBody = await enforceRequestLimits(request, requestPolicy);
        } catch (error) {
          if (error instanceof RequestLimitError) {
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }
          logger.write({
            errorCode: "INTERNAL_ERROR",
            event: "API_REQUEST",
            level: "ERROR",
            outcome: "FAILED",
            status: 500,
          });
          return secure(internalError());
        }
        if (request.method === "GET" && url.pathname === `${API_PREFIX}/session`) {
          try {
            return secure(
              Response.json({
                data: {
                  csrfToken: await issueCsrfToken(identity, env.CSRF_HMAC_KEY),
                  identity: { email: identity.email },
                  timezone: env.APP_TIMEZONE,
                },
                meta: {},
              }),
            );
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/accounts`) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          try {
            const { results: accounts } = await env.DB.prepare(
              `SELECT DISTINCT
                 COALESCE(ledger_transaction.account_label, account.display_name) AS id,
                 COALESCE(ledger_transaction.account_label, account.display_name) AS displayName
               FROM transactions AS ledger_transaction
               LEFT JOIN accounts AS account ON account.id = ledger_transaction.account_id
               WHERE COALESCE(ledger_transaction.account_label, account.display_name) IS NOT NULL
               ORDER BY displayName`,
            ).all<{ id: string; displayName: string }>();
            return secure(Response.json({ data: { accounts }, meta: {} }));
          } catch {
            return secure(internalError());
          }
        }
        if (
          url.pathname === `${API_PREFIX}/subscriptions` ||
          url.pathname.startsWith(`${API_PREFIX}/subscriptions/`)
        ) {
          const id =
            url.pathname === `${API_PREFIX}/subscriptions`
              ? null
              : url.pathname.slice(`${API_PREFIX}/subscriptions/`.length);
          if (
            (id === null && !["GET", "POST"].includes(request.method)) ||
            (id !== null && request.method !== "PATCH")
          )
            return secure(methodNotAllowed());
          const invalid = () =>
            secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          if (url.search) return invalid();
          if (id !== null && !/^subscription-[A-Za-z0-9_-]{1,147}$/.test(id))
            return secure(notFound());
          try {
            const repository = new SubscriptionRepository(env.DB);
            const timestamp = now().toISOString();
            if (request.method === "GET")
              return secure(
                Response.json({
                  data: await repository.list(),
                  meta: { today: torontoDate(new Date(timestamp)) },
                }),
              );
            const parsed = (
              id === null ? subscriptionCreateSchema : subscriptionMutationSchema
            ).safeParse(parseJsonBody(requestBody));
            if (!parsed.success) return invalid();
            const result =
              id === null
                ? { subscription: await repository.create(parsed.data, timestamp), removedCount: 0 }
                : await repository.mutate(id, parsed.data, timestamp);
            // The plan is already committed; a catch-up failure must not invite duplicate owner mutations.
            let catchUpPending = false;
            try {
              await repository.generateDue(timestamp, result.subscription.id);
            } catch {
              catchUpPending = true;
              logger.write({
                event: "SUBSCRIPTION_SCHEDULE",
                level: "ERROR",
                outcome: "FAILED",
                errorCode: "INTERNAL_ERROR",
              });
            }
            const subscription = (await repository.find(result.subscription.id))!;
            catchUpPending ||=
              subscription.status === "ACTIVE" &&
              subscription.nextChargeDate <= torontoDate(new Date(timestamp));
            return secure(
              Response.json(
                { data: { ...result, subscription }, meta: { catchUpPending } },
                { status: id === null ? 201 : 200 },
              ),
            );
          } catch (error) {
            if (error instanceof SubscriptionError) {
              const status =
                error.code === "NOT_FOUND" ? 404 : error.code === "VERSION_CONFLICT" ? 409 : 422;
              return secure(
                Response.json(
                  {
                    error: {
                      code: error.code,
                      message: "Refresh the subscription and check the supplied values.",
                    },
                  },
                  { status },
                ),
              );
            }
            logger.write({
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              errorCode: "INTERNAL_ERROR",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/budgets`) {
          if (request.method !== "GET" && request.method !== "PUT")
            return secure(methodNotAllowed());
          const invalid = () =>
            secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          try {
            const repository = new BudgetRepository(env.DB);
            if (request.method === "PUT") {
              const parsed = budgetSettingSchema.safeParse(parseJsonBody(requestBody));
              if (!parsed.success || url.search) return invalid();
              const budget = await repository.save(parsed.data, now().toISOString());
              if (!budget) return invalid();
              return secure(Response.json({ data: { budget }, meta: {} }));
            }
            const month = budgetMonthSchema.safeParse(url.searchParams.get("month"));
            if (!month.success || [...url.searchParams.keys()].length !== 1) return invalid();
            return secure(
              Response.json({
                data: { budgets: await repository.list(month.data) },
                meta: { month: month.data },
              }),
            );
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/categories`) {
          if (request.method !== "GET" && request.method !== "POST") {
            return secure(methodNotAllowed());
          }
          try {
            const repository = new CategoryRepository(env.DB);
            if (request.method === "POST") {
              const parsedBody = categoryCreateRequestSchema.safeParse(parseJsonBody(requestBody));
              if (!parsedBody.success) {
                return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
              }
              const result = await repository.createExpense({
                name: parsedBody.data.name,
                now: now().toISOString(),
              });
              if (result.kind === "NAME_CONFLICT") return secure(categoryNameConflict());
              const response = Response.json(
                { data: { category: result.category }, meta: {} },
                { status: 201 },
              );
              response.headers.set("Location", `${API_PREFIX}/categories/${result.category.id}`);
              return secure(response);
            }
            return secure(
              Response.json({
                data: { categories: await repository.list() },
                meta: {},
              }),
            );
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/imports/csv`) {
          if (request.method !== "POST") return secure(methodNotAllowed());
          const parsedBody = csvImportPreviewRequestSchema.safeParse(parseJsonBody(requestBody));
          if (!parsedBody.success) {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }

          try {
            const csvBytes = decodeCsvBase64(parsedBody.data.contentBase64);
            const parsedPreview = await parseCsvPreview({
              chunks: chunkBytes(csvBytes),
              ...(parsedBody.data.mapping === undefined
                ? {}
                : { mapping: parsedBody.data.mapping }),
            });
            const contentChecksum = await csvImportContentChecksum(parsedPreview);
            const repository = new CsvImportPreviewRepository(env.DB);
            const [activeCategoryReferences, suspectedDuplicateKeys, existingMatches] =
              await Promise.all([
                repository.listActiveCategoryReferences(),
                repository.findSuspectedDuplicateKeys(parsedPreview.rows),
                repository.findExistingMatches(parsedPreview.rows),
              ]);
            const categoryValidatedPreview = applyActiveCategoryReferences(
              parsedPreview,
              activeCategoryReferences,
            );
            const duplicateMarkedPreview = applySuspectedDuplicateKeys(
              categoryValidatedPreview,
              suspectedDuplicateKeys,
            );
            const preview = applyExistingMatches(duplicateMarkedPreview, existingMatches);
            const requestedAt = now();
            const expiresAt = new Date(requestedAt.getTime() + 30 * 60 * 1000).toISOString();
            const sourceFileNameHash = await csvImportFileNameHash(parsedBody.data.fileName);
            const staged = await repository.stagePreview({
              contentChecksum,
              expiresAt,
              now: requestedAt.toISOString(),
              preview,
              sourceFileNameHash,
            });
            const responsePreview = staged.kind === "REPLAYED" ? staged.preview : preview;
            const visibleRows = responsePreview.rows.slice(0, 100).map(csvPreviewRowReadModel);
            const reviewRows = responsePreview.rows
              .slice(100)
              .filter(
                ({ duplicateEvidence, existingMatch }) =>
                  duplicateEvidence === "SUSPECTED_SAME_FILE" ||
                  existingMatch?.disposition === "SUSPECTED_EXISTING",
              )
              .map(csvPreviewRowReadModel);
            const status = staged.kind === "REPLAYED" ? 200 : 201;
            logger.write({
              event: "CSV_IMPORT",
              importBatchId: staged.id,
              level: "INFO",
              outcome: "SUCCESS",
              status,
            });
            return secure(
              Response.json(
                {
                  data: {
                    preview: {
                      adapter: responsePreview.adapter,
                      columns: responsePreview.columns,
                      counts: responsePreview.counts,
                      expiresAt: staged.expiresAt,
                      fileName: parsedBody.data.fileName,
                      id: staged.id,
                      mapping: parsedBody.data.mapping ?? null,
                      reviewRows,
                      rows: visibleRows,
                      status: "PREVIEWED",
                      version: staged.version,
                    },
                  },
                  meta: {
                    ledgerTransactionsCreated: 0,
                    replayed: staged.kind === "REPLAYED",
                    rowsTruncated: responsePreview.rows.length > visibleRows.length,
                  },
                },
                { status },
              ),
            );
          } catch (error) {
            if (error instanceof CsvImportError) {
              logger.write({
                errorCode: error.status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
                event: "CSV_IMPORT",
                level: "WARN",
                outcome: "DENIED",
                status: error.status,
              });
              return secure(csvImportDenied(error));
            }
            if (error instanceof CsvImportPreviewPersistenceError) {
              if (error.code === "CONFLICT") {
                logger.write({
                  errorCode: "CONFLICT",
                  event: "CSV_IMPORT",
                  level: "WARN",
                  outcome: "DENIED",
                  status: 409,
                });
                return secure(
                  Response.json(
                    {
                      error: {
                        code: "CONFLICT",
                        message: "This CSV batch can no longer be replaced by a preview.",
                      },
                    },
                    { status: 409 },
                  ),
                );
              }
              logger.write({
                errorCode: "INTERNAL_ERROR",
                event: "CSV_IMPORT",
                level: "ERROR",
                outcome: "FAILED",
                status: 500,
              });
            }
            return secure(internalError());
          }
        }
        const csvCommitMatch = url.pathname.match(/^\/api\/v1\/imports\/([^/]+)\/commit$/);
        if (csvCommitMatch) {
          if (request.method !== "POST") return secure(methodNotAllowed());
          const parsedBatchId = csvImportBatchIdSchema.safeParse(csvCommitMatch[1]);
          const parsedBody = csvImportCommitRequestSchema.safeParse(parseJsonBody(requestBody));
          const parsedIdempotencyKey = idempotencyKeySchema.safeParse(
            request.headers.get("Idempotency-Key"),
          );
          if (!parsedBatchId.success || !parsedBody.success || !parsedIdempotencyKey.success) {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }

          try {
            const result = await new CsvImportCommitRepository(env.DB).commit({
              batchId: parsedBatchId.data,
              idempotencyKey: parsedIdempotencyKey.data,
              now: now().toISOString(),
              reviewDecisions: parsedBody.data.reviewDecisions,
              version: parsedBody.data.version,
            });
            logger.write({
              event: "CSV_IMPORT",
              importBatchId: result.importBatch.id,
              level: "INFO",
              outcome: "SUCCESS",
              status: 200,
            });
            return secure(
              Response.json({
                data: { importBatch: result.importBatch },
                meta: { replayed: result.replayed },
              }),
            );
          } catch (error) {
            const failure =
              error instanceof CsvImportCommitPersistenceError
                ? error
                : new CsvImportCommitPersistenceError("WRITE_FAILED");
            const response = csvImportCommitDenied(failure);
            logger.write({
              errorCode:
                failure.code === "INVALID_INPUT"
                  ? "VALIDATION_ERROR"
                  : failure.code === "PREVIEW_EXPIRED"
                    ? "CONFLICT"
                    : failure.code,
              event: "CSV_IMPORT",
              level: response.status >= 500 ? "ERROR" : "WARN",
              outcome: "DENIED",
              status: response.status,
            });
            return secure(response);
          }
        }
        if (url.pathname === `${API_PREFIX}/exports/data.json`) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          if (url.searchParams.size > 0) {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const exportedAt = now().toISOString();
            const json = await createJsonExport({
              database: env.DB,
              exportedAt,
              timezone: env.APP_TIMEZONE,
            });
            return secure(
              new Response(json, {
                headers: {
                  "Content-Disposition": `attachment; filename="personal-ledger-${exportedAt.slice(0, 10)}.json"`,
                  "Content-Type": "application/json; charset=utf-8",
                },
              }),
            );
          } catch (error) {
            if (
              (error instanceof FullJsonExportPersistenceError &&
                error.code === "ROW_LIMIT_EXCEEDED") ||
              error instanceof FullJsonExportError
            ) {
              return secure(requestLimitDenied(new RequestLimitError("PAYLOAD_TOO_LARGE", 413)));
            }
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/exports/transactions.csv`) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          let query;
          try {
            query = parseTransactionCsvExportQuery(url.searchParams);
          } catch {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const transactions = await new TransactionRepository(env.DB).listForCsvExport(query);
            const csv = serializeTransactionCsv(transactions.map(transactionCsvRow));
            return secure(
              new Response(csv, {
                headers: {
                  "Content-Disposition": `attachment; filename="transactions-${now().toISOString().slice(0, 10)}.csv"`,
                  "Content-Type": "text/csv; charset=utf-8",
                },
              }),
            );
          } catch (error) {
            if (
              error instanceof TransactionCsvExportPersistenceError ||
              error instanceof TransactionCsvExportError
            ) {
              return secure(requestLimitDenied(new RequestLimitError("PAYLOAD_TOO_LARGE", 413)));
            }
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/reports/spending`) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          let query;
          try {
            query = parseSpendingReportQuery(url.searchParams);
          } catch {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const generatedAt = now();
            const [report, freshness] = await Promise.all([
              new FinancialReportRepository(env.DB).spendingBreakdown(query),
              Promise.resolve({ generatedAt: generatedAt.toISOString() }),
            ]);
            return secure(
              Response.json({
                data: { sections: report.sections },
                meta: { freshness, period: report.period, query },
              }),
            );
          } catch (error) {
            if (
              error instanceof FinancialReportPersistenceError &&
              error.code === "INVALID_INPUT"
            ) {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/reports/cash-flow`) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          let query;
          try {
            query = parseCashFlowReportQuery(url.searchParams);
          } catch {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const generatedAt = now();
            const report = await new FinancialReportRepository(env.DB).cashFlowWithComparisons(
              query,
            );
            const freshness = { generatedAt: generatedAt.toISOString() };
            return secure(
              Response.json({
                data: {
                  sections: mergeCashFlowCurrencySections(
                    report.current.currencies,
                    report.previousPeriod.comparisons,
                    report.previousYear.comparisons,
                  ),
                },
                meta: {
                  freshness,
                  periods: {
                    current: report.current.period,
                    previousPeriod: report.previousPeriod.period,
                    previousYear: report.previousYear.period,
                  },
                  query,
                },
              }),
            );
          } catch (error) {
            if (
              error instanceof FinancialReportPersistenceError &&
              error.code === "INVALID_INPUT"
            ) {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/transactions` && request.method === "GET") {
          let query;
          try {
            query = parseTransactionListQuery(url.searchParams);
          } catch {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          try {
            const page = await new TransactionRepository(env.DB).listPage(query);
            return secure(
              Response.json({
                data: { transactions: page.transactions.map(transactionReadModel) },
                meta: {
                  hasMore: page.hasMore,
                  nextCursor: page.nextCursor,
                  query,
                },
              }),
            );
          } catch (error) {
            if (error instanceof TransactionQueryError) {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/transaction-previews`) {
          if (request.method !== "POST") return secure(methodNotAllowed());
          const parsedBody = manualTransactionPreviewRequestSchema.safeParse(
            parseJsonBody(requestBody),
          );
          if (!parsedBody.success) {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const result = await new CategoryRepository(env.DB).previewMerchant({
              description: parsedBody.data.description,
              ignoreExactRule: merchantRequiresCategoryConfirmation(parsedBody.data.description),
              preferredCategoryId: manualDefaultCategory(parsedBody.data.description),
            });
            if (!result) throw new Error("No active expense category is available.");
            return secure(Response.json({ data: result, meta: {} }));
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/transactions` && request.method === "POST") {
          const parsedBody = manualTransactionCreateRequestSchema.safeParse(
            parseJsonBody(requestBody),
          );
          if (!parsedBody.success) {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          if (
            parsedBody.data.categoryId === undefined &&
            merchantRequiresCategoryConfirmation(parsedBody.data.description)
          ) {
            return secure(merchantCategoryConfirmationRequired());
          }

          try {
            const result = await new ManualTransactionRepository(env.DB).create({
              accountLabel: parsedBody.data.accountLabel,
              reimbursementMinor:
                parsedBody.data.reimbursementAmount === undefined
                  ? 0
                  : decimalAmountToMinorUnits(
                      parsedBody.data.reimbursementAmount,
                      parsedBody.data.currency,
                    ),
              amountMinor: decimalAmountToMinorUnits(
                parsedBody.data.amount,
                parsedBody.data.currency,
              ),
              categoryId: parsedBody.data.categoryId,
              currency: parsedBody.data.currency,
              description: parsedBody.data.description,
              direction: parsedBody.data.direction,
              installmentCount: parsedBody.data.installmentCount,
              now: now().toISOString(),
              postedDate: parsedBody.data.postedDate,
              ...(parsedBody.data.rememberMerchant === true ? { rememberMerchant: true } : {}),
            });
            if (result.kind === "CATEGORY_NOT_FOUND") {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            if (result.kind === "CATEGORY_CONFIRMATION_REQUIRED") {
              return secure(merchantCategoryConfirmationRequired());
            }
            const transactionId = transactionIdSchema.safeParse(result.transaction.id);
            if (!transactionId.success) {
              throw new ManualTransactionPersistenceError("WRITE_FAILED");
            }
            const response = Response.json(
              {
                data: {
                  categoryConfirmationRequired:
                    result.transaction.categorizationSource === "UNCLASSIFIED",
                  transaction: manualTransactionReadModel(result.transaction),
                  ...(result.transactions
                    ? { transactions: result.transactions.map(manualTransactionReadModel) }
                    : {}),
                },
                meta: {},
              },
              { status: 201 },
            );
            response.headers.set("Location", `${API_PREFIX}/transactions/${transactionId.data}`);
            logger.write({
              event: "API_REQUEST",
              level: "INFO",
              outcome: "SUCCESS",
              status: 201,
              transactionId: result.transaction.id,
            });
            return secure(response);
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/transactions` && request.method !== "GET") {
          return secure(methodNotAllowed());
        }
        const merchantRuleCorrectionPath = new RegExp(
          `^${API_PREFIX}/transactions/([^/]+)/merchant-rule$`,
        ).exec(url.pathname);
        if (merchantRuleCorrectionPath) {
          if (request.method !== "PUT") return secure(methodNotAllowed());
          const parsedTransactionId = transactionIdSchema.safeParse(merchantRuleCorrectionPath[1]);
          const parsedBody = merchantRuleCorrectionRequestSchema.safeParse(
            parseJsonBody(requestBody),
          );
          if (!parsedTransactionId.success || !parsedBody.success) {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          try {
            const result = await new MerchantRuleCorrectionRepository(env.DB).saveForFuture({
              ...parsedBody.data,
              id: parsedTransactionId.data,
              now: now().toISOString(),
            });
            if (result.kind === "NOT_FOUND") return secure(notFound());
            if (result.kind === "VERSION_CONFLICT") {
              return secure(
                versionConflict(
                  result.currentVersion,
                  result.resource === "MERCHANT_RULE" ? "merchant rule" : "transaction",
                ),
              );
            }
            if (result.kind === "CATEGORY_NOT_FOUND" || result.kind === "MERCHANT_NOT_AVAILABLE") {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            logger.write({
              event: "API_REQUEST",
              level: "INFO",
              outcome: "SUCCESS",
              status: 200,
              transactionId: result.transaction.id,
            });
            return secure(
              Response.json({
                data: {
                  merchantRule: merchantRuleReadModel(result.merchantRule),
                  transaction: transactionReadModel(result.transaction),
                },
                meta: { historicalTransactionsChanged: 0 },
              }),
            );
          } catch {
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
              transactionId: parsedTransactionId.data,
            });
            return secure(internalError());
          }
        }
        const transactionPath = new RegExp(`^${API_PREFIX}/transactions/([^/]+)$`).exec(
          url.pathname,
        );
        if (transactionPath) {
          const parsedTransactionId = transactionIdSchema.safeParse(transactionPath[1]);
          if (!parsedTransactionId.success) {
            const error = new RequestLimitError("VALIDATION_ERROR", 422);
            logger.write({
              errorCode: error.code,
              event: "API_REQUEST",
              level: "WARN",
              outcome: "DENIED",
              status: error.status,
            });
            return secure(requestLimitDenied(error));
          }

          if (request.method === "GET") {
            try {
              const detail = await new TransactionRepository(env.DB).findDetailById(
                parsedTransactionId.data,
              );
              if (!detail) return secure(notFound());
              return secure(
                Response.json({
                  data: { transaction: transactionDetailReadModel(detail) },
                  meta: {},
                }),
              );
            } catch {
              logger.write({
                errorCode: "INTERNAL_ERROR",
                event: "API_REQUEST",
                level: "ERROR",
                outcome: "FAILED",
                status: 500,
                transactionId: parsedTransactionId.data,
              });
              return secure(internalError());
            }
          }
          if (request.method !== "PATCH" && request.method !== "DELETE") {
            return secure(methodNotAllowed());
          }

          try {
            let mutation;
            if (request.method === "PATCH") {
              const body = parseJsonBody(requestBody);
              const reimbursement = transactionReimbursementRequestSchema.safeParse(body);
              if (reimbursement.success) {
                const result = await new TransactionRepository(env.DB).setReimbursement({
                  id: parsedTransactionId.data,
                  reimbursementMinor: decimalAmountToMinorUnits(
                    reimbursement.data.reimbursementAmount,
                    "CAD",
                  ),
                  version: reimbursement.data.version,
                  now: now().toISOString(),
                });
                if (result.kind === "NOT_FOUND") return secure(notFound());
                if (result.kind === "VERSION_CONFLICT")
                  return secure(versionConflict(result.currentVersion, "transaction"));
                if (result.kind === "INVALID_INPUT")
                  return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
                if (result.kind === "UPDATED") {
                  logger.write({
                    event: "API_REQUEST",
                    level: "INFO",
                    outcome: "SUCCESS",
                    status: 200,
                    transactionId: result.transaction.id,
                  });
                  return secure(
                    Response.json({
                      data: { transaction: transactionReadModel(result.transaction) },
                      meta: {},
                    }),
                  );
                }
              }
              const parsedOverride = transactionCategoryOverrideRequestSchema.safeParse(body);
              if (parsedOverride.success) {
                const override = await new TransactionCategoryOverrideRepository(env.DB).override({
                  ...parsedOverride.data,
                  id: parsedTransactionId.data,
                  now: now().toISOString(),
                });
                if (override.kind === "NOT_FOUND") return secure(notFound());
                if (override.kind === "VERSION_CONFLICT") {
                  return secure(versionConflict(override.currentVersion, "transaction"));
                }
                if (override.kind === "CATEGORY_NOT_FOUND") {
                  return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
                }
                logger.write({
                  event: "API_REQUEST",
                  level: "INFO",
                  outcome: "SUCCESS",
                  status: 200,
                  transactionId: override.transaction.id,
                });
                return secure(
                  Response.json({
                    data: { transaction: transactionReadModel(override.transaction) },
                    meta: {},
                  }),
                );
              }
              const parsedUpdate = manualTransactionUpdateRequestSchema.safeParse(body);
              if (!parsedUpdate.success) {
                return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
              }
              const { amount, reimbursementAmount, ...update } = parsedUpdate.data;
              mutation = await new ManualTransactionRepository(env.DB).update({
                ...update,
                ...(reimbursementAmount === undefined
                  ? {}
                  : {
                      reimbursementMinor: decimalAmountToMinorUnits(
                        reimbursementAmount,
                        parsedUpdate.data.currency ?? "CAD",
                      ),
                    }),
                ...(amount === undefined
                  ? {}
                  : {
                      amountMinor: decimalAmountToMinorUnits(
                        amount,
                        parsedUpdate.data.currency ?? "CAD",
                      ),
                    }),
                id: parsedTransactionId.data,
                now: now().toISOString(),
              });
            } else {
              const parsedDelete = manualTransactionDeleteRequestSchema.safeParse(
                parseJsonBody(requestBody),
              );
              if (!parsedDelete.success) {
                return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
              }
              mutation = await new ManualTransactionRepository(env.DB).delete({
                id: parsedTransactionId.data,
                now: now().toISOString(),
                version: parsedDelete.data.version,
              });
            }
            if (mutation.kind === "NOT_FOUND") return secure(notFound());
            if (mutation.kind === "VERSION_CONFLICT") {
              return secure(versionConflict(mutation.currentVersion, "transaction"));
            }
            if (mutation.kind === "CATEGORY_NOT_FOUND") {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            logger.write({
              event: "API_REQUEST",
              level: "INFO",
              outcome: "SUCCESS",
              status: 200,
              transactionId: mutation.transaction.id,
            });
            return secure(
              Response.json({
                data: { transaction: manualTransactionReadModel(mutation.transaction) },
                meta: {},
              }),
            );
          } catch (error) {
            if (
              error instanceof ManualTransactionPersistenceError &&
              error.code === "INVALID_INPUT"
            ) {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            logger.write({
              errorCode: "INTERNAL_ERROR",
              event: "API_REQUEST",
              level: "ERROR",
              outcome: "FAILED",
              status: 500,
              transactionId: parsedTransactionId.data,
            });
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/merchant-rule-previews`) {
          if (request.method !== "GET") return secure(methodNotAllowed());
          let query;
          try {
            query = parseMerchantRulePreviewQuery(url.searchParams);
          } catch {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const preview = await new MerchantRuleManagementRepository(env.DB).preview(query);
            if ("kind" in preview) {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            return secure(
              Response.json({
                data: {
                  existingRule: preview.existingRule
                    ? merchantRuleReadModel(preview.existingRule)
                    : null,
                  proposedRule: preview.proposedRule,
                },
                meta: preview.impact,
              }),
            );
          } catch {
            return secure(internalError());
          }
        }
        if (url.pathname === `${API_PREFIX}/merchant-rules`) {
          if (request.method === "GET") {
            let query;
            try {
              query = parseMerchantRuleListQuery(url.searchParams);
            } catch {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            try {
              const page = await new MerchantRuleManagementRepository(env.DB).listPage(query);
              return secure(
                Response.json({
                  data: { rules: page.rules.map(merchantRuleReadModel) },
                  meta: {
                    hasMore: page.hasMore,
                    nextCursor: page.nextCursor,
                    query,
                  },
                }),
              );
            } catch (error) {
              if (
                error instanceof MerchantRuleManagementPersistenceError &&
                error.code === "INVALID_INPUT"
              ) {
                return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
              }
              return secure(internalError());
            }
          }
          if (request.method !== "POST") return secure(methodNotAllowed());
          const parsedBody = merchantRuleCreateRequestSchema.safeParse(parseJsonBody(requestBody));
          if (!parsedBody.success) {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const result = await new MerchantRuleManagementRepository(env.DB).create({
              ...parsedBody.data,
              now: now().toISOString(),
            });
            if (result.kind === "NORMALIZED_MERCHANT_CONFLICT") {
              return secure(merchantRuleConflict());
            }
            if (result.kind === "CATEGORY_NOT_FOUND" || result.kind === "MERCHANT_INVALID") {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            const response = Response.json(
              {
                data: { merchantRule: merchantRuleReadModel(result.merchantRule) },
                meta: result.impact,
              },
              { status: 201 },
            );
            response.headers.set(
              "Location",
              `${API_PREFIX}/merchant-rules/${result.merchantRule.id}`,
            );
            return secure(response);
          } catch {
            return secure(internalError());
          }
        }
        const merchantRulePath = new RegExp(`^${API_PREFIX}/merchant-rules/([^/]+)$`).exec(
          url.pathname,
        );
        if (merchantRulePath) {
          if (request.method !== "PATCH") return secure(methodNotAllowed());
          const merchantRuleId = merchantRulePath[1]!;
          const parsedBody = merchantRuleUpdateRequestSchema.safeParse(parseJsonBody(requestBody));
          if (!/^[A-Za-z0-9_-]{1,160}$/.test(merchantRuleId) || !parsedBody.success) {
            return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
          }
          try {
            const result = await new MerchantRuleManagementRepository(env.DB).update({
              ...parsedBody.data,
              id: merchantRuleId,
              now: now().toISOString(),
            });
            if (result.kind === "NOT_FOUND") return secure(notFound());
            if (result.kind === "VERSION_CONFLICT") {
              return secure(versionConflict(result.currentVersion, "merchant rule"));
            }
            if (result.kind === "NORMALIZED_MERCHANT_CONFLICT") {
              return secure(merchantRuleConflict());
            }
            if (result.kind === "CATEGORY_NOT_FOUND" || result.kind === "MERCHANT_INVALID") {
              return secure(requestLimitDenied(new RequestLimitError("VALIDATION_ERROR", 422)));
            }
            return secure(
              Response.json({
                data: { merchantRule: merchantRuleReadModel(result.merchantRule) },
                meta: result.impact,
              }),
            );
          } catch {
            return secure(internalError());
          }
        }
        return secure(
          Response.json(
            {
              error: {
                code: "NOT_FOUND",
                message: "Not found.",
              },
            },
            { status: 404 },
          ),
        );
      }

      return secure(await env.ASSETS.fetch(request));
    },
  };
}

const productionLogger = createStructuredLogger({ sink: (line) => console.log(line) });

export default createAppWorker(
  createConfiguredAccessGate(),
  productionLogger,
) satisfies ExportedHandler<AppEnv>;
