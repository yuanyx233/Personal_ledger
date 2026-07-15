import * as z from "zod";

const identifierSchema = z.string().min(1).max(160);
const cursorSchema = z.string().max(256).nullable();
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paymentMetadataSchema = z.strictObject({
  byOrderOf: z.string().max(256).nullable(),
  payee: z.string().max(256).nullable(),
  payer: z.string().max(256).nullable(),
  paymentMethod: z.string().max(256).nullable(),
  paymentProcessor: z.string().max(256).nullable(),
  ppdId: z.string().max(256).nullable(),
  reason: z.string().max(256).nullable(),
  referenceNumber: z.string().max(256).nullable(),
});
const plaidTransactionSchema = z.strictObject({
  accountId: identifierSchema,
  amount: z.number().finite(),
  authorizedDate: calendarDateSchema.nullable(),
  date: calendarDateSchema,
  isoCurrencyCode: z.string().regex(/^[A-Z]{3}$/),
  merchantName: z.string().min(1).max(256).nullable(),
  name: z.string().min(1).max(512),
  paymentMetadata: paymentMetadataSchema,
  pending: z.boolean(),
  pendingTransactionId: identifierSchema.nullable(),
  transactionId: identifierSchema,
});
const removedTransactionSchema = z.strictObject({
  accountId: identifierSchema,
  transactionId: identifierSchema,
});
const runLeaseSchema = z.strictObject({
  leaseToken: z.string().min(16).max(160),
  processPendingEventsThrough: z.iso.datetime({ offset: true }).optional(),
  runId: identifierSchema,
});
const syncBatchSchema = z.strictObject({
  added: z.array(plaidTransactionSchema).max(50_000),
  connectionId: identifierSchema,
  finalCursor: z.string().max(256),
  initialCursor: cursorSchema,
  modified: z.array(plaidTransactionSchema).max(50_000),
  now: z.iso.datetime({ offset: true }),
  removed: z.array(removedTransactionSchema).max(50_000),
  runLease: runLeaseSchema.optional(),
});

type PlaidTransactionInput = z.infer<typeof plaidTransactionSchema>;
export type TransactionSyncPersistenceInput = z.infer<typeof syncBatchSchema>;
export type TransactionSyncPersistenceErrorCode = "BATCH_FAILED" | "INVALID_BATCH";

export class TransactionSyncPersistenceError extends Error {
  constructor(readonly code: TransactionSyncPersistenceErrorCode) {
    super(code);
    this.name = "TransactionSyncPersistenceError";
  }
}

function amountFields(amount: number): {
  amountMinor: number;
  direction: "INFLOW" | "OUTFLOW";
  providerAmountDecimal: string;
} {
  const providerAmountDecimal = String(amount);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(providerAmountDecimal);
  if (!match) throw new TransactionSyncPersistenceError("INVALID_BATCH");

  const whole = BigInt(match[2]!);
  const fractional = BigInt((match[3] ?? "").padEnd(2, "0"));
  const amountMinorBigInt = whole * 100n + fractional;
  if (amountMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TransactionSyncPersistenceError("INVALID_BATCH");
  }

  return {
    amountMinor: Number(amountMinorBigInt),
    direction: match[1] === "-" ? "INFLOW" : "OUTFLOW",
    providerAmountDecimal,
  };
}

function paymentMetadataJson(metadata: PlaidTransactionInput["paymentMetadata"]): string | null {
  const supplied = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== null),
  );
  return Object.keys(supplied).length === 0 ? null : JSON.stringify(supplied);
}

function createTransactionId(): string {
  return `transaction-${crypto.randomUUID()}`;
}

export class TransactionSyncRepository {
  constructor(private readonly database: D1Database) {}

  async apply(input: unknown): Promise<void> {
    const parsed = syncBatchSchema.safeParse(input);
    if (!parsed.success) throw new TransactionSyncPersistenceError("INVALID_BATCH");
    const batch = parsed.data;
    const statements: D1PreparedStatement[] = [];
    const changedTransactions = [...batch.added, ...batch.modified];

    for (const transaction of changedTransactions) {
      const { amountMinor, direction, providerAmountDecimal } = amountFields(transaction.amount);
      statements.push(
        this.database
          .prepare(
            `INSERT INTO transactions (
              id, source, account_id, account_label, plaid_transaction_id,
              pending_transaction_id, status, authorized_date, posted_date,
              amount_minor, direction, currency, provider_amount_decimal,
              raw_description, merchant_name, payment_metadata_json, category_id,
              categorization_source, category_rule_id, needs_review, review_reason,
              created_at, updated_at, version
            ) VALUES (
              ?, 'PLAID',
              (SELECT id FROM accounts
               WHERE connection_id = ? AND plaid_account_id = ? AND enabled = 1),
              NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
              'UNCLASSIFIED', NULL, 1, 'UNCLASSIFIED_MERCHANT', ?, ?, 1
            )
            ON CONFLICT(plaid_transaction_id) DO UPDATE SET
              source = CASE
                WHEN transactions.source = 'PLAID' THEN 'PLAID'
                ELSE 'INVALID_SOURCE'
              END,
              account_id = excluded.account_id,
              status = excluded.status,
              authorized_date = excluded.authorized_date,
              posted_date = excluded.posted_date,
              amount_minor = excluded.amount_minor,
              direction = excluded.direction,
              currency = excluded.currency,
              provider_amount_decimal = excluded.provider_amount_decimal,
              raw_description = excluded.raw_description,
              merchant_name = excluded.merchant_name,
              payment_metadata_json = excluded.payment_metadata_json,
              updated_at = excluded.updated_at,
              version = transactions.version + 1`,
          )
          .bind(
            createTransactionId(),
            batch.connectionId,
            transaction.accountId,
            transaction.transactionId,
            transaction.pending ? "PENDING" : "POSTED",
            transaction.authorizedDate,
            transaction.date,
            amountMinor,
            direction,
            transaction.isoCurrencyCode,
            providerAmountDecimal,
            transaction.name,
            transaction.merchantName,
            paymentMetadataJson(transaction.paymentMetadata),
            batch.now,
            batch.now,
          ),
      );
    }

    for (const transaction of changedTransactions) {
      statements.push(
        this.database
          .prepare(
            `UPDATE transactions
             SET pending_transaction_id = CASE
                   WHEN ? IS NULL THEN NULL
                   ELSE (
                     SELECT pending.id FROM transactions AS pending
                     JOIN accounts AS pending_account ON pending_account.id = pending.account_id
                     WHERE pending.plaid_transaction_id = ?
                       AND pending.source = 'PLAID'
                       AND pending_account.connection_id = ?
                   )
                 END,
                 updated_at = ?,
                 version = version + 1
             WHERE plaid_transaction_id = ?
               AND source = 'PLAID'
               AND account_id IN (
                 SELECT id FROM accounts WHERE connection_id = ?
               )`,
          )
          .bind(
            transaction.pendingTransactionId,
            transaction.pendingTransactionId,
            batch.connectionId,
            batch.now,
            transaction.transactionId,
            batch.connectionId,
          ),
      );
    }

    for (const removed of batch.removed) {
      statements.push(
        this.database
          .prepare(
            `UPDATE transactions
             SET status = 'REMOVED', updated_at = ?, version = version + 1
             WHERE plaid_transaction_id = ?
               AND source = 'PLAID'
               AND status != 'REMOVED'
               AND account_id = (
                 SELECT id FROM accounts
                 WHERE connection_id = ? AND plaid_account_id = ?
               )`,
          )
          .bind(batch.now, removed.transactionId, batch.connectionId, removed.accountId),
      );
    }

    statements.push(
      this.database
        .prepare(
          `UPDATE connections
           SET sync_cursor = ?,
               status = CASE
                 WHEN (sync_cursor = ? OR (sync_cursor IS NULL AND ? IS NULL))
                   ${
                     batch.runLease
                       ? `AND EXISTS (
                           SELECT 1 FROM sync_runs
                           WHERE id = ? AND connection_id = ? AND status = 'RUNNING'
                             AND lease_token = ? AND lease_expires_at > ?
                         )`
                       : ""
                   }
                 THEN 'HEALTHY'
                 ELSE 'CURSOR_CONFLICT'
               END,
               last_success_at = ?,
               last_error_code = NULL,
               updated_at = ?,
               version = version + 1
           WHERE id = ?`,
        )
        .bind(
          batch.finalCursor,
          batch.initialCursor,
          batch.initialCursor,
          ...(batch.runLease
            ? [batch.runLease.runId, batch.connectionId, batch.runLease.leaseToken, batch.now]
            : []),
          batch.now,
          batch.now,
          batch.connectionId,
        ),
    );

    if (batch.runLease) {
      if (batch.runLease.processPendingEventsThrough) {
        statements.push(
          this.database
            .prepare(
              `UPDATE sync_events
               SET status = 'PROCESSED', processed_at = ?, error_code = NULL
               WHERE connection_id = ? AND status = 'PENDING' AND received_at <= ?`,
            )
            .bind(batch.now, batch.connectionId, batch.runLease.processPendingEventsThrough),
        );
      }
      statements.push(
        this.database
          .prepare(
            `UPDATE sync_runs
             SET status = 'SUCCEEDED', end_cursor = ?, lease_expires_at = NULL,
                 lease_token = NULL, next_attempt_at = NULL, last_error_code = NULL,
                 finished_at = ?, version = version + 1
             WHERE id = ? AND connection_id = ? AND status = 'RUNNING'
               AND lease_token = ? AND lease_expires_at > ?`,
          )
          .bind(
            batch.finalCursor,
            batch.now,
            batch.runLease.runId,
            batch.connectionId,
            batch.runLease.leaseToken,
            batch.now,
          ),
      );
    }

    try {
      const results = await this.database.batch(statements);
      if (results.at(-1)?.meta.changes !== 1) {
        throw new TransactionSyncPersistenceError("BATCH_FAILED");
      }
    } catch {
      throw new TransactionSyncPersistenceError("BATCH_FAILED");
    }
  }
}
