import { normalizeFullJsonExport, type FullJsonExport } from "@ledger/domain";

export type FullJsonRestoreErrorCode =
  | "DANGLING_RELATIONSHIP"
  | "DUPLICATE_ID"
  | "DUPLICATE_UNIQUE_VALUE"
  | "INVALID_ACCOUNT_TYPE"
  | "INVALID_SOURCE_IDENTITY"
  | "INVALID_SYSTEM_CATEGORY"
  | "PENDING_RELATIONSHIP_CYCLE"
  | "RECONCILIATION_FAILED";

export class FullJsonRestoreError extends Error {
  constructor(readonly code: FullJsonRestoreErrorCode) {
    super(code);
    this.name = "FullJsonRestoreError";
  }
}

export interface FullJsonRestoreReportTotal {
  currency: string;
  incomeMinor: number;
  netCashFlowMinor: number;
  netSpendingMinor: number;
}

export interface FullJsonRestoreEvidence {
  counts: FullJsonExport["recordCounts"];
  foreignKeyViolations: number;
  relationshipViolations: number;
  reportTotals: FullJsonRestoreReportTotal[];
}

type Transaction = FullJsonExport["data"]["transactions"][number];

function assertUnique(values: readonly string[], code: FullJsonRestoreErrorCode): void {
  if (new Set(values).size !== values.length) throw new FullJsonRestoreError(code);
}

function assertUniqueIds(document: FullJsonExport): void {
  const { budgets, ...collections } = document.data;
  assertUnique(
    budgets.map((budget) =>
      JSON.stringify([budget.categoryId, budget.currency, budget.effectiveMonth]),
    ),
    "DUPLICATE_UNIQUE_VALUE",
  );
  for (const records of Object.values(collections)) {
    assertUnique(
      records.map(({ id }) => id),
      "DUPLICATE_ID",
    );
  }
}

function assertReference(ids: ReadonlySet<string>, value: string | null): void {
  if (value !== null && !ids.has(value)) {
    throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
  }
}

function topologicallySortedTransactions(transactions: readonly Transaction[]): Transaction[] {
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const sorted: Transaction[] = [];

  function visit(transaction: Transaction): void {
    if (visited.has(transaction.id)) return;
    if (visiting.has(transaction.id)) {
      throw new FullJsonRestoreError("PENDING_RELATIONSHIP_CYCLE");
    }
    visiting.add(transaction.id);
    if (transaction.pendingTransactionId !== null) {
      const pending = byId.get(transaction.pendingTransactionId);
      if (!pending) throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
      visit(pending);
    }
    visiting.delete(transaction.id);
    visited.add(transaction.id);
    sorted.push(transaction);
  }

  for (const transaction of transactions) visit(transaction);
  return sorted;
}

function validateRestoreRelationships(document: FullJsonExport): Transaction[] {
  assertUniqueIds(document);
  const data = document.data;
  const connectionIds = new Set(data.connections.map(({ id }) => id));
  const accountIds = new Set(data.accounts.map(({ id }) => id));
  const categoryIds = new Set(data.categories.map(({ id }) => id));
  for (const budget of data.budgets) {
    assertReference(categoryIds, budget.categoryId);
    if (data.categories.find(({ id }) => id === budget.categoryId)?.kind !== "EXPENSE") {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
  }
  const ruleIds = new Set(data.merchantRules.map(({ id }) => id));
  const transactionIds = new Set(data.transactions.map(({ id }) => id));
  const transferMatchIds = new Set(data.transferMatches.map(({ id }) => id));
  const importBatchIds = new Set(data.importBatches.map(({ id }) => id));
  const subscriptionIds = new Set(data.subscriptions.map(({ id }) => id));

  assertUnique(
    data.categories.map(({ name }) => name),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.categories.flatMap(({ systemKey }) => (systemKey === null ? [] : [systemKey])),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.merchantRules.map(({ normalizedMerchant }) => normalizedMerchant),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.transactions.flatMap(({ providerTransactionId }) =>
      providerTransactionId === null ? [] : [providerTransactionId],
    ),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.transactions.flatMap(({ importFingerprint }) =>
      importFingerprint === null ? [] : [importFingerprint],
    ),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.importBatches.map(({ contentChecksum }) => contentChecksum),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.importRows.map(({ batchId, rowNumber }) => `${batchId}\u0000${rowNumber}`),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.subscriptionOccurrences.map(
      ({ scheduledDate, subscriptionId }) => `${subscriptionId}\u0000${scheduledDate}`,
    ),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.subscriptionOccurrences.map(({ transactionId }) => transactionId),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.importRows.flatMap(({ resolution, transactionId }) =>
      transactionId !== null && (resolution === "AUTO_MERGED" || resolution === "OWNER_MERGED")
        ? [transactionId]
        : [],
    ),
    "DUPLICATE_UNIQUE_VALUE",
  );
  assertUnique(
    data.transferMatches.map(
      ({ leftTransactionId, rightTransactionId }) =>
        `${leftTransactionId}\u0000${rightTransactionId}`,
    ),
    "DUPLICATE_UNIQUE_VALUE",
  );

  const systemCategories = data.categories.filter(({ systemKey }) => systemKey !== null);
  if (
    systemCategories.length !== 2 ||
    !systemCategories.some(
      ({ active, editable, kind, systemKey }) =>
        active && !editable && kind === "TRANSFER" && systemKey === "TRANSFER",
    ) ||
    !systemCategories.some(
      ({ active, editable, kind, systemKey }) =>
        active && !editable && kind === "UNCLASSIFIED" && systemKey === "UNCLASSIFIED",
    ) ||
    data.categories.some(
      ({ editable, kind, systemKey }) =>
        systemKey === null &&
        (!editable || (kind !== "INCOME" && kind !== "EXPENSE" && kind !== "TRANSFER")),
    )
  ) {
    throw new FullJsonRestoreError("INVALID_SYSTEM_CATEGORY");
  }

  for (const account of data.accounts) {
    assertReference(connectionIds, account.connectionId);
    if (!(
      (account.type === "DEPOSITORY" && account.subtype === "CHECKING") ||
      (account.type === "CREDIT" && account.subtype === "CREDIT_CARD")
    )) {
      throw new FullJsonRestoreError("INVALID_ACCOUNT_TYPE");
    }
  }

  const rules = new Map(data.merchantRules.map((rule) => [rule.id, rule]));
  for (const rule of data.merchantRules) assertReference(categoryIds, rule.categoryId);
  for (const subscription of data.subscriptions) {
    assertReference(categoryIds, subscription.categoryId);
    const category = data.categories.find(({ id }) => id === subscription.categoryId);
    if (category?.kind !== "EXPENSE" || !category.active) {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
  }
  for (const transaction of data.transactions) {
    assertReference(accountIds, transaction.accountId);
    assertReference(categoryIds, transaction.categoryId);
    assertReference(ruleIds, transaction.categoryRuleId);
    assertReference(transactionIds, transaction.pendingTransactionId);
    if (transaction.accountId === null && transaction.accountLabel === null) {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
    if (
      (transaction.source === "PLAID" && transaction.providerTransactionId === null) ||
      (transaction.source === "CSV" && transaction.importFingerprint === null)
    ) {
      throw new FullJsonRestoreError("INVALID_SOURCE_IDENTITY");
    }
    if (
      transaction.categoryRuleId !== null &&
      (transaction.categoryId === null ||
        rules.get(transaction.categoryRuleId)?.categoryId !== transaction.categoryId)
    ) {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
  }
  for (const audit of data.categoryAudits) {
    assertReference(transactionIds, audit.transactionId);
    assertReference(categoryIds, audit.oldCategoryId);
    assertReference(categoryIds, audit.newCategoryId);
    assertReference(ruleIds, audit.oldCategoryRuleId);
    assertReference(ruleIds, audit.newCategoryRuleId);
  }
  for (const match of data.transferMatches) {
    assertReference(transactionIds, match.leftTransactionId);
    assertReference(transactionIds, match.rightTransactionId);
    if (match.leftTransactionId >= match.rightTransactionId) {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
  }
  for (const audit of data.transferMatchAudits) {
    assertReference(transferMatchIds, audit.transferMatchId);
  }
  for (const row of data.importRows) {
    assertReference(importBatchIds, row.batchId);
    assertReference(transactionIds, row.transactionId);
    if (
      (row.resolution === "IMPORTED_NEW" ||
        row.resolution === "AUTO_MERGED" ||
        row.resolution === "OWNER_MERGED") &&
      (row.transactionId === null || row.resolvedAt === null)
    ) {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
    if (
      (row.resolution === "AUTO_MERGED" || row.resolution === "OWNER_MERGED") &&
      row.matchEvidence === null
    ) {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
  }
  for (const occurrence of data.subscriptionOccurrences) {
    assertReference(subscriptionIds, occurrence.subscriptionId);
    assertReference(transactionIds, occurrence.transactionId);
    const subscription = data.subscriptions.find(({ id }) => id === occurrence.subscriptionId);
    const transaction = data.transactions.find(({ id }) => id === occurrence.transactionId);
    if (
      !subscription ||
      !transaction ||
      transaction.source !== "MANUAL" ||
      transaction.direction !== "OUTFLOW" ||
      transaction.postedDate !== occurrence.scheduledDate ||
      (occurrence.status === "GENERATED" &&
        (occurrence.ownerDecisionAt !== null || transaction.status !== "POSTED")) ||
      (occurrence.status === "NOT_CHARGED" &&
        (occurrence.ownerDecisionAt === null || transaction.status !== "REMOVED"))
    ) {
      throw new FullJsonRestoreError("DANGLING_RELATIONSHIP");
    }
  }

  return topologicallySortedTransactions(data.transactions);
}

function parseRestoreDocument(value: unknown): FullJsonExport {
  return normalizeFullJsonExport(value);
}

function utf8Hex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function text(value: string): string {
  return `CAST(X'${utf8Hex(value)}' AS TEXT)`;
}

function nullableText(value: string | null): string {
  return value === null ? "NULL" : text(value);
}

function bool(value: boolean): string {
  return value ? "1" : "0";
}

function json(value: unknown): string {
  return text(JSON.stringify(value));
}

function statement(table: string, columns: readonly string[], values: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")})`;
}

export function createFullJsonRestoreSql(value: unknown): string {
  const document = parseRestoreDocument(value);
  const transactions = validateRestoreRelationships(document);
  const data = document.data;
  const statements: string[] = [
    "PRAGMA foreign_keys = ON",
    "DELETE FROM categories WHERE system_key IS NULL",
  ];

  for (const connection of data.connections) {
    statements.push(
      statement(
        "connections",
        [
          "id",
          "institution_id",
          "institution_name",
          "plaid_item_id",
          "access_token_ciphertext",
          "access_token_iv",
          "token_key_version",
          "sync_cursor",
          "status",
          "last_success_at",
          "last_error_code",
          "consent_expires_at",
          "created_at",
          "updated_at",
          "version",
          "creation_idempotency_key",
        ],
        [
          text(connection.id),
          text(connection.institutionId),
          text(connection.institutionName),
          `'restored-local-item:' || ${text(connection.id)}`,
          "X'00'",
          "X'00'",
          "1",
          "NULL",
          "'DISCONNECTED'",
          "NULL",
          "NULL",
          "NULL",
          text(connection.createdAt),
          text(connection.updatedAt),
          String(connection.version),
          "NULL",
        ],
      ),
    );
  }
  for (const account of data.accounts) {
    statements.push(
      statement(
        "accounts",
        [
          "id",
          "connection_id",
          "plaid_account_id",
          "display_name",
          "mask",
          "type",
          "subtype",
          "currency",
          "enabled",
          "created_at",
          "updated_at",
          "version",
        ],
        [
          text(account.id),
          text(account.connectionId),
          `'restored-local-account:' || ${text(account.id)}`,
          text(account.displayName),
          "NULL",
          text(account.type),
          text(account.subtype),
          text(account.currency),
          bool(account.enabled),
          text(account.createdAt),
          text(account.updatedAt),
          String(account.version),
        ],
      ),
    );
  }
  for (const category of data.categories.filter(({ systemKey }) => systemKey === null)) {
    statements.push(
      statement(
        "categories",
        [
          "id",
          "name",
          "kind",
          "system_key",
          "editable",
          "active",
          "created_at",
          "updated_at",
          "version",
        ],
        [
          text(category.id),
          text(category.name),
          text(category.kind),
          "NULL",
          bool(category.editable),
          bool(category.active),
          text(category.createdAt),
          text(category.updatedAt),
          String(category.version),
        ],
      ),
    );
  }
  for (const budget of data.budgets) {
    statements.push(
      statement(
        "category_budgets",
        ["category_id", "currency", "effective_month", "amount_minor", "updated_at"],
        [
          text(budget.categoryId),
          text(budget.currency),
          text(budget.effectiveMonth),
          budget.amountMinor === null ? "NULL" : String(budget.amountMinor),
          text(budget.updatedAt),
        ],
      ),
    );
  }
  for (const rule of data.merchantRules) {
    statements.push(
      statement(
        "merchant_rules",
        [
          "id",
          "normalized_merchant",
          "display_merchant",
          "category_id",
          "active",
          "created_at",
          "updated_at",
          "version",
        ],
        [
          text(rule.id),
          text(rule.normalizedMerchant),
          text(rule.displayMerchant),
          text(rule.categoryId),
          bool(rule.active),
          text(rule.createdAt),
          text(rule.updatedAt),
          String(rule.version),
        ],
      ),
    );
  }
  for (const subscription of data.subscriptions) {
    statements.push(
      statement(
        "subscriptions",
        [
          "id",
          "name",
          "merchant_name",
          "normalized_merchant",
          "account_label",
          "amount_minor",
          "currency",
          "category_id",
          "cadence",
          "anchor_day",
          "next_charge_date",
          "status",
          "cancellation_effective_date",
          "last_error_code",
          "created_at",
          "updated_at",
          "version",
        ],
        [
          text(subscription.id),
          text(subscription.name),
          nullableText(subscription.merchantName),
          text(subscription.normalizedMerchant),
          text(subscription.accountLabel),
          String(subscription.amountMinor),
          text(subscription.currency),
          text(subscription.categoryId),
          text(subscription.cadence),
          String(subscription.anchorDay),
          text(subscription.nextChargeDate),
          text(subscription.status),
          nullableText(subscription.cancellationEffectiveDate ?? null),
          nullableText(subscription.lastErrorCode),
          text(subscription.createdAt),
          text(subscription.updatedAt),
          String(subscription.version),
        ],
      ),
    );
  }
  for (const transaction of transactions) {
    statements.push(
      statement(
        "transactions",
        [
          "id",
          "source",
          "account_id",
          "account_label",
          "plaid_transaction_id",
          "pending_transaction_id",
          "import_fingerprint",
          "status",
          "authorized_date",
          "posted_date",
          "amount_minor",
          "reimbursement_minor",
          "direction",
          "currency",
          "provider_amount_decimal",
          "raw_description",
          "merchant_name",
          "payment_metadata_json",
          "category_id",
          "categorization_source",
          "category_rule_id",
          "needs_review",
          "review_reason",
          "created_at",
          "updated_at",
          "version",
          "normalized_merchant",
          "plaid_pfc_primary",
          "plaid_pfc_detailed",
          "plaid_pfc_confidence",
        ],
        [
          text(transaction.id),
          text(transaction.source),
          nullableText(transaction.accountId),
          nullableText(transaction.accountLabel),
          nullableText(transaction.providerTransactionId),
          nullableText(transaction.pendingTransactionId),
          nullableText(transaction.importFingerprint),
          text(transaction.status),
          nullableText(transaction.authorizedDate),
          text(transaction.postedDate),
          String(transaction.amountMinor),
          String(transaction.reimbursementMinor),
          text(transaction.direction),
          text(transaction.currency),
          "NULL",
          text(transaction.description),
          nullableText(transaction.merchantName),
          json(transaction.paymentMetadata),
          nullableText(transaction.categoryId),
          text(transaction.categorizationSource),
          nullableText(transaction.categoryRuleId),
          bool(transaction.needsReview),
          nullableText(transaction.reviewReason),
          text(transaction.createdAt),
          text(transaction.updatedAt),
          String(transaction.version),
          nullableText(transaction.normalizedMerchant),
          nullableText(transaction.plaidPersonalFinanceCategory?.primary ?? null),
          nullableText(transaction.plaidPersonalFinanceCategory?.detailed ?? null),
          nullableText(transaction.plaidPersonalFinanceCategory?.confidenceLevel ?? null),
        ],
      ),
    );
  }
  for (const occurrence of data.subscriptionOccurrences) {
    statements.push(
      statement(
        "subscription_occurrences",
        [
          "id",
          "subscription_id",
          "scheduled_date",
          "transaction_id",
          "status",
          "owner_decision_at",
          "created_at",
          "updated_at",
          "version",
        ],
        [
          text(occurrence.id),
          text(occurrence.subscriptionId),
          text(occurrence.scheduledDate),
          text(occurrence.transactionId),
          text(occurrence.status),
          nullableText(occurrence.ownerDecisionAt),
          text(occurrence.createdAt),
          text(occurrence.updatedAt),
          String(occurrence.version),
        ],
      ),
    );
  }
  for (const audit of data.categoryAudits) {
    statements.push(
      statement(
        "category_audits",
        [
          "id",
          "transaction_id",
          "old_category_id",
          "new_category_id",
          "old_source",
          "new_source",
          "reason",
          "created_at",
          "old_category_rule_id",
          "new_category_rule_id",
        ],
        [
          text(audit.id),
          text(audit.transactionId),
          nullableText(audit.oldCategoryId),
          nullableText(audit.newCategoryId),
          text(audit.oldSource),
          text(audit.newSource),
          text(audit.reason),
          text(audit.createdAt),
          nullableText(audit.oldCategoryRuleId),
          nullableText(audit.newCategoryRuleId),
        ],
      ),
    );
  }
  for (const match of data.transferMatches) {
    statements.push(
      statement(
        "transfer_matches",
        [
          "id",
          "left_transaction_id",
          "right_transaction_id",
          "status",
          "confidence",
          "evidence_json",
          "decision_reason",
          "created_at",
          "updated_at",
          "version",
        ],
        [
          text(match.id),
          text(match.leftTransactionId),
          text(match.rightTransactionId),
          text(match.status),
          text(match.confidence),
          json(match.evidence),
          nullableText(match.decisionReason),
          text(match.createdAt),
          text(match.updatedAt),
          String(match.version),
        ],
      ),
    );
  }
  for (const audit of data.transferMatchAudits) {
    statements.push(
      statement(
        "transfer_match_audits",
        [
          "id",
          "transfer_match_id",
          "action",
          "old_status",
          "new_status",
          "reason",
          "match_version",
          "created_at",
        ],
        [
          text(audit.id),
          text(audit.transferMatchId),
          text(audit.action),
          text(audit.oldStatus),
          text(audit.newStatus),
          text(audit.reason),
          String(audit.matchVersion),
          text(audit.createdAt),
        ],
      ),
    );
  }
  for (const batch of data.importBatches) {
    statements.push(
      statement(
        "import_batches",
        [
          "id",
          "content_checksum",
          "idempotency_key",
          "status",
          "preview_expires_at",
          "created_at",
          "committed_at",
          "version",
          "source_filename_hash",
        ],
        [
          text(batch.id),
          text(batch.contentChecksum),
          `'restored-local-import:' || ${text(batch.id)}`,
          "'COMMITTED'",
          text(batch.committedAt),
          text(batch.createdAt),
          text(batch.committedAt),
          String(batch.version),
          nullableText(batch.sourceFilenameHash),
        ],
      ),
    );
  }
  for (const row of data.importRows) {
    statements.push(
      statement(
        "import_rows",
        [
          "id",
          "batch_id",
          "row_number",
          "raw_json",
          "canonical_fingerprint",
          "validation_status",
          "errors_json",
          "transaction_id",
          "created_at",
          "resolution",
          "match_evidence_json",
          "resolved_at",
        ],
        [
          text(row.id),
          text(row.batchId),
          String(row.rowNumber),
          json(row.raw),
          nullableText(row.canonicalFingerprint),
          text(row.validationStatus),
          json(row.errors),
          nullableText(row.transactionId),
          text(row.createdAt),
          text(row.resolution),
          row.matchEvidence === null ? "NULL" : json(row.matchEvidence),
          nullableText(row.resolvedAt),
        ],
      ),
    );
  }

  return `${statements.join(";\n")};\n`;
}

export function calculateFullJsonRestoreEvidence(value: unknown): FullJsonRestoreEvidence {
  const document = parseRestoreDocument(value);
  validateRestoreRelationships(document);
  const categories = new Map(document.data.categories.map((category) => [category.id, category]));
  const excludedTransactionIds = new Set(
    document.data.transferMatches
      .filter(({ status }) => status === "AUTO_CONFIRMED" || status === "CONFIRMED")
      .flatMap(({ leftTransactionId, rightTransactionId }) => [
        leftTransactionId,
        rightTransactionId,
      ]),
  );
  const totals = new Map<string, { incomeMinor: number; netSpendingMinor: number }>();
  for (const transaction of document.data.transactions) {
    if (transaction.status !== "POSTED" || excludedTransactionIds.has(transaction.id)) continue;
    const kind =
      transaction.categoryId === null ? undefined : categories.get(transaction.categoryId)?.kind;
    if (kind !== "INCOME" && kind !== "EXPENSE") continue;
    const total = totals.get(transaction.currency) ?? { incomeMinor: 0, netSpendingMinor: 0 };
    const personalAmount = transaction.amountMinor - transaction.reimbursementMinor;
    if (kind === "INCOME") {
      total.incomeMinor += transaction.direction === "INFLOW" ? personalAmount : -personalAmount;
    } else {
      total.netSpendingMinor +=
        transaction.direction === "OUTFLOW" ? personalAmount : -personalAmount;
    }
    totals.set(transaction.currency, total);
  }
  return {
    counts: document.recordCounts,
    foreignKeyViolations: 0,
    relationshipViolations: 0,
    reportTotals: [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, total]) => ({
        currency,
        incomeMinor: total.incomeMinor,
        netCashFlowMinor: total.incomeMinor - total.netSpendingMinor,
        netSpendingMinor: total.netSpendingMinor,
      })),
  };
}

export function verifyFullJsonRestoreEvidence(
  expected: FullJsonRestoreEvidence,
  actual: FullJsonRestoreEvidence,
): void {
  const countKeys = Object.keys(expected.counts) as Array<keyof FullJsonExport["recordCounts"]>;
  const countsMatch =
    countKeys.length === Object.keys(actual.counts).length &&
    countKeys.every((key) => actual.counts[key] === expected.counts[key]);
  const reportsMatch =
    actual.reportTotals.length === expected.reportTotals.length &&
    expected.reportTotals.every((total, index) => {
      const restored = actual.reportTotals[index];
      return (
        restored?.currency === total.currency &&
        restored.incomeMinor === total.incomeMinor &&
        restored.netCashFlowMinor === total.netCashFlowMinor &&
        restored.netSpendingMinor === total.netSpendingMinor
      );
    });
  if (
    !countsMatch ||
    actual.foreignKeyViolations !== expected.foreignKeyViolations ||
    actual.relationshipViolations !== expected.relationshipViolations ||
    !reportsMatch
  ) {
    throw new FullJsonRestoreError("RECONCILIATION_FAILED");
  }
}
