import { calendarDateSchema, currencyCodeSchema } from "@ledger/domain/api-contracts";
import { CONNECTION_STATUSES } from "@ledger/domain";
import type { EncryptedPlaidAccessToken } from "@ledger/domain/token-crypto";
import * as z from "zod";

const identifierSchema = z.string().min(1).max(160);

const transactionSortSchema = z.enum([
  "POSTED_DATE_DESC",
  "POSTED_DATE_ASC",
  "AMOUNT_DESC",
  "AMOUNT_ASC",
]);

export const transactionListQuerySchema = z
  .strictObject({
    accountId: identifierSchema.optional(),
    categoryId: identifierSchema.optional(),
    categorizationSource: z.enum(["MANUAL", "RULE", "PLAID", "UNCLASSIFIED"]).optional(),
    currency: currencyCodeSchema.optional(),
    dateFrom: calendarDateSchema.optional(),
    dateTo: calendarDateSchema.optional(),
    needsReview: z.boolean().optional(),
    pageSize: z.int().min(1).max(100).default(50),
    sort: transactionSortSchema.default("POSTED_DATE_DESC"),
    source: z.enum(["PLAID", "MANUAL", "CSV"]).optional(),
    status: z.enum(["PENDING", "POSTED", "REMOVED"]).optional(),
  })
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    message: "dateFrom must not be after dateTo.",
    path: ["dateTo"],
  });

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

export interface ConnectionRecord {
  id: string;
  institutionId: string;
  institutionName: string;
  plaidItemId: string;
  status: (typeof CONNECTION_STATUSES)[number];
  syncCursor: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  consentExpiresAt: string | null;
  version: number;
}

export interface ConnectionAccessRecord {
  connection: ConnectionRecord;
  encryptedAccessToken: EncryptedPlaidAccessToken;
}

interface ConnectionRow {
  id: string;
  institution_id: string;
  institution_name: string;
  plaid_item_id: string;
  status: ConnectionRecord["status"];
  sync_cursor: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  consent_expires_at: string | null;
  version: number;
}

interface ConnectionAccessRow extends ConnectionRow {
  access_token_ciphertext: ArrayBuffer;
  access_token_iv: ArrayBuffer;
  token_key_version: number;
}

export interface AccountRecord {
  id: string;
  connectionId: string;
  plaidAccountId: string;
  displayName: string;
  mask: string | null;
  type: "DEPOSITORY" | "CREDIT";
  subtype: "CHECKING" | "CREDIT_CARD";
  currency: string;
  enabled: boolean;
  version: number;
}

export interface ConnectionWithAccounts {
  accounts: AccountRecord[];
  connection: ConnectionRecord;
}

export type AccountEnabledUpdateResult =
  | { account: AccountRecord; kind: "UPDATED" }
  | { kind: "NOT_FOUND" }
  | { currentVersion: number; kind: "VERSION_CONFLICT" };

interface AccountRow {
  id: string;
  connection_id: string;
  plaid_account_id: string;
  display_name: string;
  mask: string | null;
  type: AccountRecord["type"];
  subtype: AccountRecord["subtype"];
  currency: string;
  enabled: number;
  version: number;
}

export interface TransactionRecord {
  id: string;
  source: "PLAID" | "MANUAL" | "CSV";
  accountId: string | null;
  accountLabel: string | null;
  plaidTransactionId: string | null;
  pendingTransactionId: string | null;
  status: "PENDING" | "POSTED" | "REMOVED";
  authorizedDate: string | null;
  postedDate: string;
  amountMinor: number;
  direction: "INFLOW" | "OUTFLOW";
  currency: string;
  rawDescription: string;
  merchantName: string | null;
  categoryId: string | null;
  categorizationSource: "MANUAL" | "RULE" | "PLAID" | "UNCLASSIFIED";
  needsReview: boolean;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface TransactionRow {
  id: string;
  source: TransactionRecord["source"];
  account_id: string | null;
  account_label: string | null;
  plaid_transaction_id: string | null;
  pending_transaction_id: string | null;
  status: TransactionRecord["status"];
  authorized_date: string | null;
  posted_date: string;
  amount_minor: number;
  direction: TransactionRecord["direction"];
  currency: string;
  raw_description: string;
  merchant_name: string | null;
  category_id: string | null;
  categorization_source: TransactionRecord["categorizationSource"];
  needs_review: number;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

const CONNECTION_COLUMNS = `
  id, institution_id, institution_name, plaid_item_id, status, sync_cursor,
  last_success_at, last_error_code, consent_expires_at, version
`;

const ACCOUNT_COLUMNS = `
  id, connection_id, plaid_account_id, display_name, mask, type, subtype,
  currency, enabled, version
`;

const TRANSACTION_COLUMNS = `
  id, source, account_id, account_label, plaid_transaction_id,
  pending_transaction_id, status, authorized_date, posted_date, amount_minor,
  direction, currency, raw_description, merchant_name, category_id,
  categorization_source, needs_review, review_reason, created_at, updated_at, version
`;

const SORT_SQL: Readonly<Record<z.infer<typeof transactionSortSchema>, string>> = {
  POSTED_DATE_DESC: "posted_date DESC, id DESC",
  POSTED_DATE_ASC: "posted_date ASC, id ASC",
  AMOUNT_DESC: "amount_minor DESC, id DESC",
  AMOUNT_ASC: "amount_minor ASC, id ASC",
};

function toConnectionRecord(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    plaidItemId: row.plaid_item_id,
    status: row.status,
    syncCursor: row.sync_cursor,
    lastSuccessAt: row.last_success_at,
    lastErrorCode: row.last_error_code,
    consentExpiresAt: row.consent_expires_at,
    version: row.version,
  };
}

function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    plaidAccountId: row.plaid_account_id,
    displayName: row.display_name,
    mask: row.mask,
    type: row.type,
    subtype: row.subtype,
    currency: row.currency,
    enabled: row.enabled === 1,
    version: row.version,
  };
}

function toTransactionRecord(row: TransactionRow): TransactionRecord {
  return {
    id: row.id,
    source: row.source,
    accountId: row.account_id,
    accountLabel: row.account_label,
    plaidTransactionId: row.plaid_transaction_id,
    pendingTransactionId: row.pending_transaction_id,
    status: row.status,
    authorizedDate: row.authorized_date,
    postedDate: row.posted_date,
    amountMinor: row.amount_minor,
    direction: row.direction,
    currency: row.currency,
    rawDescription: row.raw_description,
    merchantName: row.merchant_name,
    categoryId: row.category_id,
    categorizationSource: row.categorization_source,
    needsReview: row.needs_review === 1,
    reviewReason: row.review_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export class ConnectionRepository {
  constructor(private readonly database: D1Database) {}

  async findByPlaidItemId(plaidItemId: unknown): Promise<ConnectionRecord | null> {
    const validatedItemId = identifierSchema.parse(plaidItemId);
    const row = await this.database
      .prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections WHERE plaid_item_id = ?`)
      .bind(validatedItemId)
      .first<ConnectionRow>();
    return row ? toConnectionRecord(row) : null;
  }

  async findAccessById(connectionId: unknown): Promise<ConnectionAccessRecord | null> {
    const validatedConnectionId = identifierSchema.parse(connectionId);
    const row = await this.database
      .prepare(
        `SELECT ${CONNECTION_COLUMNS}, access_token_ciphertext, access_token_iv, token_key_version
         FROM connections WHERE id = ?`,
      )
      .bind(validatedConnectionId)
      .first<ConnectionAccessRow>();
    if (!row) return null;
    return {
      connection: toConnectionRecord(row),
      encryptedAccessToken: {
        ciphertext: new Uint8Array(row.access_token_ciphertext),
        iv: new Uint8Array(row.access_token_iv),
        keyVersion: row.token_key_version,
      },
    };
  }

  async countActiveByInstitutionId(institutionId: unknown): Promise<number> {
    const validatedInstitutionId = identifierSchema.parse(institutionId);
    const count = await this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM connections
         WHERE institution_id = ? AND status != 'DISCONNECTED'`,
      )
      .bind(validatedInstitutionId)
      .first<number>("count");
    return count ?? 0;
  }

  async listSyncCandidates(input: unknown): Promise<ConnectionRecord[]> {
    const query = z
      .strictObject({
        before: z.iso.datetime({ offset: true }),
        limit: z.int().min(1).max(100).default(25),
        status: z.enum(CONNECTION_STATUSES),
      })
      .parse(input);
    const result = await this.database
      .prepare(
        `SELECT ${CONNECTION_COLUMNS} FROM connections
         WHERE status = ? AND last_success_at < ?
         ORDER BY last_success_at, id LIMIT ?`,
      )
      .bind(query.status, query.before, query.limit)
      .all<ConnectionRow>();
    return result.results.map(toConnectionRecord);
  }

  async listWithAccounts(): Promise<ConnectionWithAccounts[]> {
    const [connections, accounts] = await Promise.all([
      this.database
        .prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections ORDER BY institution_name, id`)
        .all<ConnectionRow>(),
      this.database
        .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY connection_id, id`)
        .all<AccountRow>(),
    ]);
    const accountsByConnection = new Map<string, AccountRecord[]>();
    for (const account of accounts.results.map(toAccountRecord)) {
      const groupedAccounts = accountsByConnection.get(account.connectionId) ?? [];
      groupedAccounts.push(account);
      accountsByConnection.set(account.connectionId, groupedAccounts);
    }
    return connections.results.map((connection) => ({
      accounts: accountsByConnection.get(connection.id) ?? [],
      connection: toConnectionRecord(connection),
    }));
  }
}

export class AccountRepository {
  constructor(private readonly database: D1Database) {}

  async listEnabled(connectionId: unknown): Promise<AccountRecord[]> {
    const validatedConnectionId = identifierSchema.parse(connectionId);
    const result = await this.database
      .prepare(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts
         WHERE connection_id = ? AND enabled = 1 ORDER BY id`,
      )
      .bind(validatedConnectionId)
      .all<AccountRow>();
    return result.results.map(toAccountRecord);
  }

  async updateEnabled(input: unknown): Promise<AccountEnabledUpdateResult> {
    const update = z
      .strictObject({
        enabled: z.boolean(),
        id: identifierSchema,
        now: z.iso.datetime({ offset: true }),
        version: z.int().positive(),
      })
      .parse(input);
    const updated = await this.database
      .prepare(
        `UPDATE accounts
         SET enabled = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND version = ?`,
      )
      .bind(update.enabled ? 1 : 0, update.now, update.id, update.version)
      .run();
    const row = await this.database
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`)
      .bind(update.id)
      .first<AccountRow>();
    if (!row) return { kind: "NOT_FOUND" };
    if (updated.meta.changes !== 1) {
      return { currentVersion: row.version, kind: "VERSION_CONFLICT" };
    }
    return { account: toAccountRecord(row), kind: "UPDATED" };
  }
}

export class TransactionRepository {
  constructor(private readonly database: D1Database) {}

  async list(input: unknown): Promise<TransactionRecord[]> {
    const query = transactionListQuerySchema.parse(input);
    const conditions: string[] = [];
    const bindings: Array<string | number> = [];

    const addFilter = (condition: string, value: string | number) => {
      conditions.push(condition);
      bindings.push(value);
    };

    if (query.accountId) addFilter("account_id = ?", query.accountId);
    if (query.categoryId) addFilter("category_id = ?", query.categoryId);
    if (query.categorizationSource) {
      addFilter("categorization_source = ?", query.categorizationSource);
    }
    if (query.currency) addFilter("currency = ?", query.currency);
    if (query.dateFrom) addFilter("posted_date >= ?", query.dateFrom);
    if (query.dateTo) addFilter("posted_date <= ?", query.dateTo);
    if (query.needsReview !== undefined) addFilter("needs_review = ?", query.needsReview ? 1 : 0);
    if (query.source) addFilter("source = ?", query.source);
    if (query.status) addFilter("status = ?", query.status);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const statement = this.database.prepare(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions
       ${whereClause}
       ORDER BY ${SORT_SQL[query.sort]} LIMIT ?`,
    );
    const result = await statement.bind(...bindings, query.pageSize).all<TransactionRow>();
    return result.results.map(toTransactionRecord);
  }
}

export interface Repositories {
  accounts: AccountRepository;
  connections: ConnectionRepository;
  transactions: TransactionRepository;
}

export function createRepositories(database: D1Database): Repositories {
  return {
    accounts: new AccountRepository(database),
    connections: new ConnectionRepository(database),
    transactions: new TransactionRepository(database),
  };
}
