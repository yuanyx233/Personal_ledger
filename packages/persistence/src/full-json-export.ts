import {
  FULL_JSON_EXPORT_LIMITS,
  fullJsonExportDataSchema,
  projectTransactionPaymentMetadata,
  type FullJsonExportData,
} from "@ledger/domain";

export type FullJsonExportPersistenceErrorCode =
  "INVALID_STORED_DATA" | "READ_FAILED" | "ROW_LIMIT_EXCEEDED";

export class FullJsonExportPersistenceError extends Error {
  constructor(readonly code: FullJsonExportPersistenceErrorCode) {
    super(code);
    this.name = "FullJsonExportPersistenceError";
  }
}

export interface FullJsonExportRepositoryOptions {
  maximumRecordsPerCollection?: number;
  maximumTotalRecords?: number;
}

interface ConnectionRow {
  created_at: string;
  id: string;
  institution_id: string;
  institution_name: string;
  updated_at: string;
  version: number;
}

interface AccountRow {
  connection_id: string;
  created_at: string;
  currency: string;
  display_name: string;
  enabled: number;
  id: string;
  subtype: "CHECKING" | "CREDIT_CARD";
  type: "DEPOSITORY" | "CREDIT";
  updated_at: string;
  version: number;
}

interface CategoryRow {
  active: number;
  created_at: string;
  editable: number;
  id: string;
  kind: "INCOME" | "EXPENSE" | "TRANSFER" | "UNCLASSIFIED";
  name: string;
  system_key: string | null;
  updated_at: string;
  version: number;
}

interface MerchantRuleRow {
  active: number;
  category_id: string;
  created_at: string;
  display_merchant: string;
  id: string;
  normalized_merchant: string;
  updated_at: string;
  version: number;
}

interface TransactionRow {
  account_id: string | null;
  account_label: string | null;
  amount_minor: number;
  reimbursement_minor: number;
  authorized_date: string | null;
  categorization_source: "MANUAL" | "RULE" | "PLAID" | "UNCLASSIFIED";
  category_id: string | null;
  category_rule_id: string | null;
  created_at: string;
  currency: string;
  direction: "INFLOW" | "OUTFLOW";
  id: string;
  import_fingerprint: string | null;
  merchant_name: string | null;
  needs_review: number;
  normalized_merchant: string | null;
  payment_metadata_json: string | null;
  pending_transaction_id: string | null;
  plaid_pfc_confidence: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | null;
  plaid_pfc_detailed: string | null;
  plaid_pfc_primary: string | null;
  plaid_transaction_id: string | null;
  posted_date: string;
  raw_description: string;
  review_reason: string | null;
  source: "PLAID" | "MANUAL" | "CSV";
  status: "PENDING" | "POSTED" | "REMOVED";
  updated_at: string;
  version: number;
}

interface CategoryAuditRow {
  created_at: string;
  id: string;
  new_category_id: string | null;
  new_category_rule_id: string | null;
  new_source: TransactionRow["categorization_source"];
  old_category_id: string | null;
  old_category_rule_id: string | null;
  old_source: TransactionRow["categorization_source"];
  reason: string;
  transaction_id: string;
}

interface TransferMatchRow {
  confidence: "HIGH" | "AMBIGUOUS";
  created_at: string;
  decision_reason: string | null;
  evidence_json: string;
  id: string;
  left_transaction_id: string;
  right_transaction_id: string;
  status: "AUTO_CONFIRMED" | "PENDING_REVIEW" | "CONFIRMED" | "BROKEN" | "IGNORED";
  updated_at: string;
  version: number;
}

interface TransferMatchAuditRow {
  action: "CONFIRM" | "BREAK" | "IGNORE";
  created_at: string;
  id: string;
  match_version: number;
  new_status: "CONFIRMED" | "BROKEN" | "IGNORED";
  old_status: TransferMatchRow["status"];
  reason: "OWNER_CONFIRMED" | "OWNER_BROKE" | "OWNER_IGNORED";
  transfer_match_id: string;
}

interface ImportBatchRow {
  committed_at: string;
  content_checksum: string;
  created_at: string;
  id: string;
  source_filename_hash: string | null;
  status: "COMMITTED";
  version: number;
}

interface ImportRow {
  batch_id: string;
  canonical_fingerprint: string | null;
  created_at: string;
  errors_json: string;
  id: string;
  match_evidence_json: string | null;
  raw_json: string;
  resolution:
    | "UNRESOLVED"
    | "IMPORTED_NEW"
    | "AUTO_MERGED"
    | "OWNER_MERGED"
    | "SKIPPED_INVALID"
    | "SKIPPED_DUPLICATE";
  resolved_at: string | null;
  row_number: number;
  transaction_id: string | null;
  validation_status: "VALID" | "INVALID" | "DUPLICATE" | "IMPORTED";
}

interface SubscriptionRow {
  cancellation_effective_date: string | null;
  account_label: string;
  amount_minor: number;
  anchor_day: number;
  cadence: "MONTHLY" | "YEARLY";
  category_id: string;
  created_at: string;
  currency: "CAD" | "USD";
  id: string;
  last_error_code: string | null;
  merchant_name: string | null;
  name: string;
  next_charge_date: string;
  normalized_merchant: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  updated_at: string;
  version: number;
}

interface SubscriptionOccurrenceRow {
  created_at: string;
  id: string;
  owner_decision_at: string | null;
  scheduled_date: string;
  status: "GENERATED" | "NOT_CHARGED";
  subscription_id: string;
  transaction_id: string;
  updated_at: string;
  version: number;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function resultRows<T>(results: D1Result<unknown>[], index: number): T[] {
  return (results[index]?.results ?? []) as T[];
}

function jsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Stored JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

export class FullJsonExportRepository {
  private readonly maximumRecordsPerCollection: number;
  private readonly maximumTotalRecords: number;

  constructor(
    private readonly database: D1Database,
    options: FullJsonExportRepositoryOptions = {},
  ) {
    this.maximumRecordsPerCollection = positiveSafeInteger(
      options.maximumRecordsPerCollection ?? FULL_JSON_EXPORT_LIMITS.RECORDS_PER_COLLECTION,
      "maximumRecordsPerCollection",
    );
    this.maximumTotalRecords = positiveSafeInteger(
      options.maximumTotalRecords ?? FULL_JSON_EXPORT_LIMITS.TOTAL_RECORDS,
      "maximumTotalRecords",
    );
  }

  async readSnapshot(): Promise<FullJsonExportData> {
    const limit = this.maximumRecordsPerCollection + 1;
    const statements = [
      this.database
        .prepare(
          `SELECT id, institution_id, institution_name, created_at, updated_at, version
           FROM connections ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, connection_id, display_name, type, subtype, currency, enabled,
                  created_at, updated_at, version
           FROM accounts ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, name, kind, system_key, editable, active, created_at, updated_at, version
           FROM categories ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, normalized_merchant, display_merchant, category_id, active,
                  created_at, updated_at, version
           FROM merchant_rules ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, source, account_id, account_label, plaid_transaction_id,
                  pending_transaction_id, import_fingerprint, status, authorized_date, posted_date,
                  amount_minor, reimbursement_minor, direction, currency, raw_description, merchant_name,
                  payment_metadata_json, category_id, categorization_source, category_rule_id,
                  normalized_merchant, plaid_pfc_primary, plaid_pfc_detailed,
                  plaid_pfc_confidence, needs_review, review_reason, created_at, updated_at, version
           FROM transactions ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, transaction_id, old_category_id, new_category_id, old_source, new_source,
                  reason, created_at, old_category_rule_id, new_category_rule_id
           FROM category_audits ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, left_transaction_id, right_transaction_id, status, confidence,
                  evidence_json, decision_reason, created_at, updated_at, version
           FROM transfer_matches ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, transfer_match_id, action, old_status, new_status, reason,
                  match_version, created_at
           FROM transfer_match_audits ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, content_checksum, status, created_at, committed_at, version,
                  source_filename_hash
           FROM import_batches WHERE status = 'COMMITTED' ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT row.id, row.batch_id, row.row_number, row.raw_json,
                  row.canonical_fingerprint, row.validation_status, row.errors_json,
                  row.transaction_id, row.created_at, row.resolution,
                  row.match_evidence_json, row.resolved_at
           FROM import_rows AS row
           JOIN import_batches AS batch ON batch.id = row.batch_id
           WHERE batch.status = 'COMMITTED'
           ORDER BY row.batch_id ASC, row.row_number ASC, row.id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, name, merchant_name, normalized_merchant, account_label,
                  amount_minor, currency, category_id, cadence, anchor_day,
                  next_charge_date, status, last_error_code, cancellation_effective_date, created_at, updated_at, version
           FROM subscriptions ORDER BY id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT id, subscription_id, scheduled_date, transaction_id, status,
                  owner_decision_at, created_at, updated_at, version
           FROM subscription_occurrences
           ORDER BY subscription_id ASC, scheduled_date ASC, id ASC LIMIT ?`,
        )
        .bind(limit),
      this.database
        .prepare(
          `SELECT category_id AS categoryId, currency, effective_month AS effectiveMonth,
        amount_minor AS amountMinor, updated_at AS updatedAt FROM category_budgets
        ORDER BY category_id, currency, effective_month LIMIT ?`,
        )
        .bind(limit),
    ];

    let results: D1Result<unknown>[];
    try {
      results = await this.database.batch(statements);
    } catch {
      throw new FullJsonExportPersistenceError("READ_FAILED");
    }

    const collections = results.map(({ results: rows }) => rows ?? []);
    if (collections.some((rows) => rows.length > this.maximumRecordsPerCollection)) {
      throw new FullJsonExportPersistenceError("ROW_LIMIT_EXCEEDED");
    }
    if (collections.reduce((total, rows) => total + rows.length, 0) > this.maximumTotalRecords) {
      throw new FullJsonExportPersistenceError("ROW_LIMIT_EXCEEDED");
    }

    try {
      const connections = resultRows<ConnectionRow>(results, 0).map((row) => ({
        createdAt: row.created_at,
        id: row.id,
        institutionId: row.institution_id,
        institutionName: row.institution_name,
        updatedAt: row.updated_at,
        version: row.version,
      }));
      const accounts = resultRows<AccountRow>(results, 1).map((row) => ({
        connectionId: row.connection_id,
        createdAt: row.created_at,
        currency: row.currency,
        displayName: row.display_name,
        enabled: row.enabled === 1,
        id: row.id,
        subtype: row.subtype,
        type: row.type,
        updatedAt: row.updated_at,
        version: row.version,
      }));
      const categories = resultRows<CategoryRow>(results, 2).map((row) => ({
        active: row.active === 1,
        createdAt: row.created_at,
        editable: row.editable === 1,
        id: row.id,
        kind: row.kind,
        name: row.name,
        systemKey: row.system_key,
        updatedAt: row.updated_at,
        version: row.version,
      }));
      const merchantRules = resultRows<MerchantRuleRow>(results, 3).map((row) => ({
        active: row.active === 1,
        categoryId: row.category_id,
        createdAt: row.created_at,
        displayMerchant: row.display_merchant,
        id: row.id,
        normalizedMerchant: row.normalized_merchant,
        updatedAt: row.updated_at,
        version: row.version,
      }));
      const transactions = resultRows<TransactionRow>(results, 4).map((row) => ({
        accountId: row.account_id,
        accountLabel: row.account_label,
        amountMinor: row.amount_minor,
        reimbursementMinor: row.reimbursement_minor ?? 0,
        authorizedDate: row.authorized_date,
        categorizationSource: row.categorization_source,
        categoryId: row.category_id,
        categoryRuleId: row.category_rule_id,
        createdAt: row.created_at,
        currency: row.currency,
        description: row.raw_description,
        direction: row.direction,
        id: row.id,
        importFingerprint: row.import_fingerprint,
        merchantName: row.merchant_name,
        needsReview: row.needs_review === 1,
        normalizedMerchant: row.normalized_merchant,
        paymentMetadata: projectTransactionPaymentMetadata(
          row.payment_metadata_json === null ? null : JSON.parse(row.payment_metadata_json),
        ),
        pendingTransactionId: row.pending_transaction_id,
        plaidPersonalFinanceCategory:
          row.plaid_pfc_primary === null || row.plaid_pfc_detailed === null
            ? null
            : {
                confidenceLevel: row.plaid_pfc_confidence,
                detailed: row.plaid_pfc_detailed,
                primary: row.plaid_pfc_primary,
              },
        postedDate: row.posted_date,
        providerTransactionId: row.plaid_transaction_id,
        reviewReason: row.review_reason,
        source: row.source,
        status: row.status,
        updatedAt: row.updated_at,
        version: row.version,
      }));
      const categoryAudits = resultRows<CategoryAuditRow>(results, 5).map((row) => ({
        createdAt: row.created_at,
        id: row.id,
        newCategoryId: row.new_category_id,
        newCategoryRuleId: row.new_category_rule_id,
        newSource: row.new_source,
        oldCategoryId: row.old_category_id,
        oldCategoryRuleId: row.old_category_rule_id,
        oldSource: row.old_source,
        reason: row.reason,
        transactionId: row.transaction_id,
      }));
      const transferMatches = resultRows<TransferMatchRow>(results, 6).map((row) => {
        const evidence = jsonObject(row.evidence_json);
        return {
          confidence: row.confidence,
          createdAt: row.created_at,
          decisionReason: row.decision_reason,
          evidence: {
            amountMinor: evidence.amountMinor,
            currency: evidence.currency,
            dayDifference: evidence.dayDifference,
            reason: evidence.reason ?? null,
            signals: evidence.signals,
          },
          id: row.id,
          leftTransactionId: row.left_transaction_id,
          rightTransactionId: row.right_transaction_id,
          status: row.status,
          updatedAt: row.updated_at,
          version: row.version,
        };
      });
      const transferMatchAudits = resultRows<TransferMatchAuditRow>(results, 7).map((row) => ({
        action: row.action,
        createdAt: row.created_at,
        id: row.id,
        matchVersion: row.match_version,
        newStatus: row.new_status,
        oldStatus: row.old_status,
        reason: row.reason,
        transferMatchId: row.transfer_match_id,
      }));
      const importBatches = resultRows<ImportBatchRow>(results, 8).map((row) => ({
        committedAt: row.committed_at,
        contentChecksum: row.content_checksum,
        createdAt: row.created_at,
        id: row.id,
        sourceFilenameHash: row.source_filename_hash,
        status: row.status,
        version: row.version,
      }));
      const importRows = resultRows<ImportRow>(results, 9).map((row) => {
        const storedErrors = JSON.parse(row.errors_json) as unknown;
        const errors = Array.isArray(storedErrors)
          ? storedErrors
          : typeof storedErrors === "object" &&
              storedErrors !== null &&
              "fieldErrors" in storedErrors
            ? storedErrors.fieldErrors
            : null;
        return {
          batchId: row.batch_id,
          canonicalFingerprint: row.canonical_fingerprint,
          createdAt: row.created_at,
          errors,
          id: row.id,
          matchEvidence:
            row.match_evidence_json === null
              ? null
              : (JSON.parse(row.match_evidence_json) as unknown),
          raw: JSON.parse(row.raw_json) as unknown,
          resolution: row.resolution,
          resolvedAt: row.resolved_at,
          rowNumber: row.row_number,
          transactionId: row.transaction_id,
          validationStatus: row.validation_status,
        };
      });
      const subscriptions = resultRows<SubscriptionRow>(results, 10).map((row) => ({
        cancellationEffectiveDate: row.cancellation_effective_date,
        accountLabel: row.account_label,
        amountMinor: row.amount_minor,
        anchorDay: row.anchor_day,
        cadence: row.cadence,
        categoryId: row.category_id,
        createdAt: row.created_at,
        currency: row.currency,
        id: row.id,
        lastErrorCode: row.last_error_code,
        merchantName: row.merchant_name,
        name: row.name,
        nextChargeDate: row.next_charge_date,
        normalizedMerchant: row.normalized_merchant,
        status: row.status,
        updatedAt: row.updated_at,
        version: row.version,
      }));
      const subscriptionOccurrences = resultRows<SubscriptionOccurrenceRow>(results, 11).map(
        (row) => ({
          createdAt: row.created_at,
          id: row.id,
          ownerDecisionAt: row.owner_decision_at,
          scheduledDate: row.scheduled_date,
          status: row.status,
          subscriptionId: row.subscription_id,
          transactionId: row.transaction_id,
          updatedAt: row.updated_at,
          version: row.version,
        }),
      );
      const parsed = fullJsonExportDataSchema.safeParse({
        budgets: resultRows(results, 12),
        accounts,
        categories,
        categoryAudits,
        connections,
        importBatches,
        importRows,
        merchantRules,
        subscriptionOccurrences,
        subscriptions,
        transactions,
        transferMatchAudits,
        transferMatches,
      });
      if (!parsed.success) throw new TypeError("Stored export data failed schema validation.");
      return parsed.data;
    } catch {
      throw new FullJsonExportPersistenceError("INVALID_STORED_DATA");
    }
  }
}
