import {
  calendarDateSchema,
  currencyCodeSchema,
  cursorSchema,
  type TransactionCsvExportQuery,
} from "@ledger/domain/api-contracts";
import {
  TRANSACTION_CSV_EXPORT_LIMITS,
  reportMerchantFamily,
  merchantFamilySchema,
  projectTransactionPaymentMetadata,
  type TransactionPaymentMetadata,
} from "@ledger/domain";
import * as z from "zod";

const identifierSchema = z.string().min(1).max(160);

const transactionSortSchema = z.enum([
  "POSTED_DATE_DESC",
  "POSTED_DATE_ASC",
  "AMOUNT_DESC",
  "AMOUNT_ASC",
]);

const transactionFilterFields = {
  accountId: identifierSchema.optional(),
  categoryId: identifierSchema.optional(),
  categorizationSource: z.enum(["MANUAL", "RULE", "PLAID", "UNCLASSIFIED"]).optional(),
  currency: currencyCodeSchema.optional(),
  dateFrom: calendarDateSchema.optional(),
  dateTo: calendarDateSchema.optional(),
  merchantFamily: merchantFamilySchema.optional(),
  merchantMissing: z.literal(true).optional(),
  needsReview: z.boolean().optional(),
  normalizedMerchant: z.string().min(1).max(256).optional(),
  reportMetric: z.literal("NET_SPENDING").optional(),
  sort: transactionSortSchema.default("POSTED_DATE_DESC"),
  source: z.enum(["PLAID", "MANUAL", "CSV"]).optional(),
  status: z.enum(["PENDING", "POSTED", "REMOVED"]).optional(),
} as const;

export const transactionListQuerySchema = z
  .strictObject({
    ...transactionFilterFields,
    cursor: cursorSchema.optional(),
    pageSize: z.int().min(1).max(100).default(50),
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

const transactionCsvExportPersistenceQuerySchema = z
  .strictObject(transactionFilterFields)
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

const transactionCursorSchema = z.discriminatedUnion("sort", [
  z.strictObject({
    id: identifierSchema,
    postedDate: calendarDateSchema,
    scope: z.string().regex(/^[0-9a-f]{16}$/),
    sort: z.enum(["POSTED_DATE_DESC", "POSTED_DATE_ASC"]),
    version: z.literal(1),
  }),
  z.strictObject({
    amountMinor: z.int().nonnegative(),
    id: identifierSchema,
    scope: z.string().regex(/^[0-9a-f]{16}$/),
    sort: z.enum(["AMOUNT_DESC", "AMOUNT_ASC"]),
    version: z.literal(1),
  }),
]);

type TransactionCursor = z.infer<typeof transactionCursorSchema>;

export type TransactionQueryErrorCode = "INVALID_CURSOR";

export class TransactionQueryError extends Error {
  constructor(readonly code: TransactionQueryErrorCode) {
    super(code);
    this.name = "TransactionQueryError";
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}

function transactionCursorScope(query: TransactionListQuery): string {
  const canonicalFilters = JSON.stringify([
    query.accountId ?? null,
    query.categoryId ?? null,
    query.categorizationSource ?? null,
    query.currency ?? null,
    query.dateFrom ?? null,
    query.dateTo ?? null,
    query.merchantMissing ?? null,
    query.needsReview ?? null,
    query.normalizedMerchant ?? null,
    query.reportMetric ?? null,
    query.source ?? null,
    query.status ?? null,
    ...(query.merchantFamily ? [query.merchantFamily] : []),
  ]);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonicalFilters.length; index += 1) {
    hash ^= BigInt(canonicalFilters.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function decodeTransactionCursor(value: string, query: TransactionListQuery): TransactionCursor {
  try {
    const cursor = transactionCursorSchema.parse(JSON.parse(decodeBase64Url(value)) as unknown);
    if (cursor.sort !== query.sort || cursor.scope !== transactionCursorScope(query)) {
      throw new TransactionQueryError("INVALID_CURSOR");
    }
    return cursor;
  } catch (error) {
    if (error instanceof TransactionQueryError) throw error;
    throw new TransactionQueryError("INVALID_CURSOR");
  }
}

function encodeTransactionCursor(
  transaction: TransactionRecord,
  query: TransactionListQuery,
): string {
  const { sort } = query;
  const scope = transactionCursorScope(query);
  const cursor: TransactionCursor =
    sort === "POSTED_DATE_DESC" || sort === "POSTED_DATE_ASC"
      ? {
          id: transaction.id,
          postedDate: calendarDateSchema.parse(transaction.postedDate),
          scope,
          sort,
          version: 1,
        }
      : { amountMinor: transaction.amountMinor, id: transaction.id, scope, sort, version: 1 };
  return cursorSchema.parse(encodeBase64Url(JSON.stringify(cursor)));
}

export interface TransactionRecord {
  id: string;
  source: "PLAID" | "MANUAL" | "CSV";
  accountLabel: string | null;
  pendingTransactionId: string | null;
  status: "PENDING" | "POSTED" | "REMOVED";
  authorizedDate: string | null;
  postedDate: string;
  amountMinor: number;
  reimbursementMinor: number;
  direction: "INFLOW" | "OUTFLOW";
  currency: string;
  installment?: {
    count: number;
    groupId: string;
    number: number;
  } | null;
  rawDescription: string;
  merchantName: string | null;
  paymentMetadata: TransactionPaymentMetadata;
  categoryId: string | null;
  categoryRuleId: string | null;
  categorizationSource: "MANUAL" | "RULE" | "PLAID" | "UNCLASSIFIED";
  normalizedMerchant: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TransactionRow {
  id: string;
  source: TransactionRecord["source"];
  account_id: string | null;
  account_label: string | null;
  pending_transaction_id: string | null;
  status: TransactionRecord["status"];
  authorized_date: string | null;
  posted_date: string;
  amount_minor: number;
  reimbursement_minor: number;
  direction: TransactionRecord["direction"];
  currency: string;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_count: number | null;
  raw_description: string;
  merchant_name: string | null;
  payment_metadata_json: string | null;
  category_id: string | null;
  category_rule_id: string | null;
  categorization_source: TransactionRecord["categorizationSource"];
  normalized_merchant: string | null;
  needs_review: number;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface TransactionPage {
  hasMore: boolean;
  nextCursor: string | null;
  transactions: TransactionRecord[];
}

export interface TransactionCsvExportRecord extends TransactionRecord {
  accountLabel: string;
  bankConfirmation: "NONE" | "IMPORTED" | "AUTO_MERGED" | "OWNER_MERGED";
  categoryName: string | null;
  categoryRuleDisplayMerchant: string | null;
  importMatchCount: number;
  subscriptionId: string | null;
  subscriptionScheduledDate: string | null;
}

interface TransactionCsvExportRow extends TransactionRow {
  bank_confirmation: TransactionCsvExportRecord["bankConfirmation"];
  category_name: string | null;
  category_rule_display_merchant: string | null;
  export_account_label: string;
  import_match_count: number;
  subscription_id: string | null;
  subscription_scheduled_date: string | null;
}

export interface TransactionCategoryAuditRecord {
  createdAt: string;
  id: string;
  newCategoryId: string | null;
  newCategoryRuleId: string | null;
  newSource: TransactionRecord["categorizationSource"];
  oldCategoryId: string | null;
  oldCategoryRuleId: string | null;
  oldSource: TransactionRecord["categorizationSource"];
  reason: string;
}

export interface TransactionDetailRecord {
  categoryAudits: TransactionCategoryAuditRecord[];
  lifecycle: {
    pendingTransactionId: string | null;
    replacedByTransactionId: string | null;
  };
  transaction: TransactionRecord;
}

interface TransactionCategoryAuditRow {
  created_at: string;
  id: string;
  new_category_id: string | null;
  new_category_rule_id: string | null;
  new_source: TransactionCategoryAuditRecord["newSource"];
  old_category_id: string | null;
  old_category_rule_id: string | null;
  old_source: TransactionCategoryAuditRecord["oldSource"];
  reason: string;
}

export const TRANSACTION_COLUMNS = `
  id, source, account_id, account_label,
  pending_transaction_id, status, authorized_date, posted_date, amount_minor, reimbursement_minor,
  direction, currency, raw_description, merchant_name, payment_metadata_json, category_id,
  category_rule_id, categorization_source, needs_review, review_reason, created_at, updated_at,
  version, normalized_merchant, installment_group_id, installment_number, installment_count
`;

const READ_TRANSACTION_COLUMNS = `
  ledger_transaction.id, ledger_transaction.source, ledger_transaction.account_id,
  COALESCE(ledger_transaction.account_label, account.display_name) AS account_label,
  ledger_transaction.pending_transaction_id, ledger_transaction.status,
  ledger_transaction.authorized_date, ledger_transaction.posted_date,
  ledger_transaction.amount_minor, ledger_transaction.reimbursement_minor,
  ledger_transaction.direction, ledger_transaction.currency, ledger_transaction.raw_description,
  ledger_transaction.merchant_name, ledger_transaction.payment_metadata_json,
  ledger_transaction.category_id, ledger_transaction.category_rule_id,
  ledger_transaction.categorization_source, ledger_transaction.needs_review,
  ledger_transaction.review_reason, ledger_transaction.created_at, ledger_transaction.updated_at,
  ledger_transaction.version, ledger_transaction.normalized_merchant,
  ledger_transaction.installment_group_id, ledger_transaction.installment_number,
  ledger_transaction.installment_count
`;

const SORT_SQL: Readonly<Record<z.infer<typeof transactionSortSchema>, string>> = {
  POSTED_DATE_DESC: "posted_date DESC, id DESC",
  POSTED_DATE_ASC: "posted_date ASC, id ASC",
  AMOUNT_DESC: "amount_minor DESC, id DESC",
  AMOUNT_ASC: "amount_minor ASC, id ASC",
};

const CSV_EXPORT_SORT_SQL: Readonly<Record<z.infer<typeof transactionSortSchema>, string>> = {
  POSTED_DATE_DESC: "filtered_transactions.posted_date DESC, filtered_transactions.id DESC",
  POSTED_DATE_ASC: "filtered_transactions.posted_date ASC, filtered_transactions.id ASC",
  AMOUNT_DESC: "filtered_transactions.amount_minor DESC, filtered_transactions.id DESC",
  AMOUNT_ASC: "filtered_transactions.amount_minor ASC, filtered_transactions.id ASC",
};

type TransactionFilterQuery = TransactionListQuery | TransactionCsvExportQuery;

function buildTransactionFilters(query: TransactionFilterQuery): {
  bindings: Array<string | number>;
  conditions: string[];
} {
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];
  const addFilter = (condition: string, ...values: Array<string | number>) => {
    conditions.push(condition);
    bindings.push(...values);
  };

  if (query.accountId) {
    addFilter(
      `COALESCE(account_label, (
        SELECT display_name FROM accounts AS filter_account
        WHERE filter_account.id = transactions.account_id
      )) = ?`,
      query.accountId,
    );
  }
  if (query.categoryId) addFilter("category_id = ?", query.categoryId);
  if (query.categorizationSource) {
    addFilter("categorization_source = ?", query.categorizationSource);
  }
  if (query.currency) addFilter("currency = ?", query.currency);
  if (query.dateFrom) addFilter("posted_date >= ?", query.dateFrom);
  if (query.dateTo) addFilter("posted_date <= ?", query.dateTo);
  if (query.merchantMissing) conditions.push("normalized_merchant IS NULL");
  if (query.needsReview !== undefined) addFilter("needs_review = ?", query.needsReview ? 1 : 0);
  if (query.normalizedMerchant) addFilter("normalized_merchant = ?", query.normalizedMerchant);
  if (query.reportMetric === "NET_SPENDING") {
    conditions.push("status = 'POSTED'");
    conditions.push(
      `EXISTS (
        SELECT 1 FROM categories AS report_category
        WHERE report_category.id = transactions.category_id
          AND report_category.kind = 'EXPENSE'
      )`,
    );
  }
  if (query.source) addFilter("source = ?", query.source);
  if (query.status) addFilter("status = ?", query.status);

  return { bindings, conditions };
}

export type TransactionCsvExportPersistenceErrorCode = "ROW_LIMIT_EXCEEDED";

export class TransactionCsvExportPersistenceError extends Error {
  constructor(readonly code: TransactionCsvExportPersistenceErrorCode) {
    super(code);
    this.name = "TransactionCsvExportPersistenceError";
  }
}

export function toTransactionRecord(row: TransactionRow): TransactionRecord {
  let storedPaymentMetadata: unknown = null;
  if (row.payment_metadata_json !== null) {
    try {
      storedPaymentMetadata = JSON.parse(row.payment_metadata_json) as unknown;
    } catch {
      storedPaymentMetadata = null;
    }
  }
  return {
    id: row.id,
    source: row.source,
    accountLabel: row.account_label,
    pendingTransactionId: row.pending_transaction_id,
    status: row.status,
    authorizedDate: row.authorized_date,
    postedDate: row.posted_date,
    amountMinor: row.amount_minor,
    reimbursementMinor: row.reimbursement_minor ?? 0,
    direction: row.direction,
    currency: row.currency,
    ...(typeof row.installment_group_id === "string" &&
    typeof row.installment_number === "number" &&
    typeof row.installment_count === "number"
      ? {
          installment: {
            count: row.installment_count,
            groupId: row.installment_group_id,
            number: row.installment_number,
          },
        }
      : {}),
    rawDescription: row.raw_description,
    merchantName: row.merchant_name,
    paymentMetadata: projectTransactionPaymentMetadata(storedPaymentMetadata),
    categoryId: row.category_id,
    categoryRuleId: row.category_rule_id ?? null,
    categorizationSource: row.categorization_source,
    normalizedMerchant: row.normalized_merchant ?? null,
    needsReview: row.needs_review === 1,
    reviewReason: row.review_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export class TransactionRepository {
  constructor(private readonly database: D1Database) {}

  private async filterMerchantFamily(
    query: TransactionFilterQuery,
    filters: ReturnType<typeof buildTransactionFilters>,
  ): Promise<void> {
    if (!query.merchantFamily) return;
    const { bindings, conditions } = filters;
    const candidates = await this.database
      .prepare(
        `SELECT DISTINCT normalized_merchant FROM transactions
       WHERE ${[...conditions, "normalized_merchant IS NOT NULL"].join(" AND ")}`,
      )
      .bind(...bindings)
      .all<{ normalized_merchant: string }>();
    const aliases = candidates.results
      .filter((row) => reportMerchantFamily(row.normalized_merchant)?.key === query.merchantFamily)
      .map((row) => row.normalized_merchant);
    // One binding regardless of order count; filter before sorting/pagination and export limits.
    conditions.push("normalized_merchant IN (SELECT value FROM json_each(?))");
    bindings.push(JSON.stringify(aliases));
  }

  private async query(query: TransactionListQuery, limit: number): Promise<TransactionRecord[]> {
    const filters = buildTransactionFilters(query);
    await this.filterMerchantFamily(query, filters);
    const { bindings, conditions } = filters;

    const addFilter = (condition: string, ...values: Array<string | number>) => {
      conditions.push(condition);
      bindings.push(...values);
    };

    if (query.cursor) {
      const cursor = decodeTransactionCursor(query.cursor, query);
      switch (cursor.sort) {
        case "POSTED_DATE_DESC":
          addFilter(
            "(posted_date < ? OR (posted_date = ? AND id < ?))",
            cursor.postedDate,
            cursor.postedDate,
            cursor.id,
          );
          break;
        case "POSTED_DATE_ASC":
          addFilter(
            "(posted_date > ? OR (posted_date = ? AND id > ?))",
            cursor.postedDate,
            cursor.postedDate,
            cursor.id,
          );
          break;
        case "AMOUNT_DESC":
          addFilter(
            "(amount_minor < ? OR (amount_minor = ? AND id < ?))",
            cursor.amountMinor,
            cursor.amountMinor,
            cursor.id,
          );
          break;
        case "AMOUNT_ASC":
          addFilter(
            "(amount_minor > ? OR (amount_minor = ? AND id > ?))",
            cursor.amountMinor,
            cursor.amountMinor,
            cursor.id,
          );
          break;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const statement = this.database.prepare(
      `SELECT * FROM (
         SELECT ${READ_TRANSACTION_COLUMNS}
         FROM transactions AS ledger_transaction
         LEFT JOIN accounts AS account ON account.id = ledger_transaction.account_id
       ) AS transactions
       ${whereClause}
       ORDER BY ${SORT_SQL[query.sort]} LIMIT ?`,
    );
    const result = await statement.bind(...bindings, limit).all<TransactionRow>();
    return result.results.map(toTransactionRecord);
  }

  async findById(id: unknown): Promise<TransactionRecord | null> {
    const validatedId = identifierSchema.parse(id);
    const row = await this.database
      .prepare(
        `SELECT ${READ_TRANSACTION_COLUMNS}
         FROM transactions AS ledger_transaction
         LEFT JOIN accounts AS account ON account.id = ledger_transaction.account_id
         WHERE ledger_transaction.id = ?`,
      )
      .bind(validatedId)
      .first<TransactionRow>();
    return row ? toTransactionRecord(row) : null;
  }

  async findDetailById(id: unknown): Promise<TransactionDetailRecord | null> {
    const validatedId = identifierSchema.parse(id);
    const transaction = await this.findById(validatedId);
    if (!transaction) return null;

    const [replacement, categoryAudits] = await Promise.all([
      this.database
        .prepare(
          `SELECT id FROM transactions
           WHERE pending_transaction_id = ? ORDER BY posted_date DESC, id DESC LIMIT 1`,
        )
        .bind(validatedId)
        .first<{ id: string }>(),
      this.database
        .prepare(
          `SELECT id, old_category_id, new_category_id, old_source, new_source,
                  old_category_rule_id, new_category_rule_id, reason, created_at
           FROM category_audits
           WHERE transaction_id = ? ORDER BY created_at DESC, id DESC`,
        )
        .bind(validatedId)
        .all<TransactionCategoryAuditRow>(),
    ]);

    return {
      categoryAudits: categoryAudits.results.map((audit) => ({
        createdAt: audit.created_at,
        id: audit.id,
        newCategoryId: audit.new_category_id,
        newCategoryRuleId: audit.new_category_rule_id,
        newSource: audit.new_source,
        oldCategoryId: audit.old_category_id,
        oldCategoryRuleId: audit.old_category_rule_id,
        oldSource: audit.old_source,
        reason: audit.reason,
      })),
      lifecycle: {
        pendingTransactionId: transaction.pendingTransactionId,
        replacedByTransactionId: replacement?.id ?? null,
      },
      transaction,
    };
  }

  async list(input: unknown): Promise<TransactionRecord[]> {
    const query = transactionListQuerySchema.parse(input);
    return this.query(query, query.pageSize);
  }

  async listForCsvExport(input: unknown): Promise<TransactionCsvExportRecord[]> {
    const query = transactionCsvExportPersistenceQuerySchema.parse(input);
    const filters = buildTransactionFilters(query);
    await this.filterMerchantFamily(query, filters);
    const { bindings, conditions } = filters;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const statement = this.database.prepare(
      `WITH filtered_transactions AS (
         SELECT ${TRANSACTION_COLUMNS}
         FROM transactions
         ${whereClause}
         ORDER BY ${SORT_SQL[query.sort]}
         LIMIT ?
       )
       SELECT filtered_transactions.*,
              COALESCE(filtered_transactions.account_label, account.display_name)
                AS export_account_label,
              categories.name AS category_name,
              merchant_rules.display_merchant AS category_rule_display_merchant,
              subscription_occurrence.subscription_id AS subscription_id,
              subscription_occurrence.scheduled_date AS subscription_scheduled_date,
              COALESCE(bank_match.bank_confirmation,
                CASE WHEN filtered_transactions.source = 'CSV' THEN 'IMPORTED' ELSE 'NONE' END
              ) AS bank_confirmation,
              COALESCE(bank_match.import_match_count, 0) AS import_match_count
       FROM filtered_transactions
       LEFT JOIN accounts AS account ON account.id = filtered_transactions.account_id
       LEFT JOIN categories ON categories.id = filtered_transactions.category_id
       LEFT JOIN merchant_rules ON merchant_rules.id = filtered_transactions.category_rule_id
       LEFT JOIN subscription_occurrences AS subscription_occurrence
         ON subscription_occurrence.transaction_id = filtered_transactions.id
       LEFT JOIN (
         SELECT import_rows.transaction_id,
                count(*) AS import_match_count,
                CASE
                  WHEN max(import_rows.resolution = 'OWNER_MERGED') = 1 THEN 'OWNER_MERGED'
                  WHEN max(import_rows.resolution = 'AUTO_MERGED') = 1 THEN 'AUTO_MERGED'
                  ELSE 'IMPORTED'
                END AS bank_confirmation
         FROM import_rows
         JOIN import_batches ON import_batches.id = import_rows.batch_id
         WHERE import_batches.status = 'COMMITTED'
           AND import_rows.resolution IN ('IMPORTED_NEW', 'AUTO_MERGED', 'OWNER_MERGED')
         GROUP BY import_rows.transaction_id
       ) AS bank_match ON bank_match.transaction_id = filtered_transactions.id
       ORDER BY ${CSV_EXPORT_SORT_SQL[query.sort]}`,
    );
    const result = await statement
      .bind(...bindings, TRANSACTION_CSV_EXPORT_LIMITS.ROWS + 1)
      .all<TransactionCsvExportRow>();
    if (result.results.length > TRANSACTION_CSV_EXPORT_LIMITS.ROWS) {
      throw new TransactionCsvExportPersistenceError("ROW_LIMIT_EXCEEDED");
    }
    return result.results.map((row) => ({
      ...toTransactionRecord(row),
      accountLabel: row.export_account_label,
      bankConfirmation: row.bank_confirmation,
      categoryName: row.category_name,
      categoryRuleDisplayMerchant: row.category_rule_display_merchant,
      importMatchCount: row.import_match_count,
      subscriptionId: row.subscription_id,
      subscriptionScheduledDate: row.subscription_scheduled_date,
    }));
  }

  async listPage(input: unknown): Promise<TransactionPage> {
    const query = transactionListQuerySchema.parse(input);
    const records = await this.query(query, query.pageSize + 1);
    const hasMore = records.length > query.pageSize;
    const transactions = hasMore ? records.slice(0, query.pageSize) : records;
    const last = transactions.at(-1);
    return {
      hasMore,
      nextCursor: hasMore && last ? encodeTransactionCursor(last, query) : null,
      transactions,
    };
  }

  async setReimbursement(input: {
    id: string;
    reimbursementMinor: number;
    version: number;
    now: string;
  }): Promise<
    | { kind: "UPDATED"; transaction: TransactionRecord }
    | { kind: "NOT_FOUND" | "INVALID_INPUT" }
    | { kind: "VERSION_CONFLICT"; currentVersion: number }
  > {
    if (
      !Number.isSafeInteger(input.reimbursementMinor) ||
      input.reimbursementMinor < 0 ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1
    ) {
      return { kind: "INVALID_INPUT" };
    }
    const row = await this.database
      .prepare(
        `UPDATE transactions SET reimbursement_minor = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND status = 'POSTED' AND version = ? AND amount_minor >= ?
       RETURNING ${TRANSACTION_COLUMNS}`,
      )
      .bind(input.reimbursementMinor, input.now, input.id, input.version, input.reimbursementMinor)
      .first<TransactionRow>();
    if (row) return { kind: "UPDATED", transaction: toTransactionRecord(row) };
    const current = await this.findById(input.id);
    if (!current || current.status !== "POSTED") return { kind: "NOT_FOUND" };
    if (current.version !== input.version)
      return { kind: "VERSION_CONFLICT", currentVersion: current.version };
    return { kind: "INVALID_INPUT" };
  }
}
