import { cursorSchema } from "@ledger/domain/api-contracts";
import { normalizeMerchantName } from "@ledger/domain";
import * as z from "zod";

import {
  TRANSACTION_COLUMNS,
  TransactionRepository,
  toTransactionRecord,
  type TransactionRecord,
  type TransactionRow,
} from "./repositories";

const identifierSchema = z.string().min(1).max(160);
const correctionSchema = z.strictObject({
  categoryId: identifierSchema,
  id: identifierSchema,
  now: z.iso.datetime({ offset: true }),
  version: z.int().positive(),
});

const MERCHANT_RULE_COLUMNS = `
  id, normalized_merchant, display_merchant, category_id, active,
  created_at, updated_at, version
`;

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

export interface MerchantRuleRecord {
  active: boolean;
  categoryId: string;
  createdAt: string;
  displayMerchant: string;
  id: string;
  normalizedMerchant: string;
  updatedAt: string;
  version: number;
}

export type MerchantRuleCorrectionResult =
  | { kind: "CATEGORY_NOT_FOUND" }
  | { kind: "MERCHANT_NOT_AVAILABLE" }
  | { kind: "NOT_FOUND" }
  | {
      currentVersion: number;
      kind: "VERSION_CONFLICT";
      resource: "MERCHANT_RULE" | "TRANSACTION";
    }
  | {
      kind: "NO_CHANGE" | "UPDATED";
      merchantRule: MerchantRuleRecord;
      transaction: TransactionRecord;
    };

export type MerchantRuleCorrectionPersistenceErrorCode = "INVALID_INPUT" | "WRITE_FAILED";

export class MerchantRuleCorrectionPersistenceError extends Error {
  constructor(readonly code: MerchantRuleCorrectionPersistenceErrorCode) {
    super(code);
    this.name = "MerchantRuleCorrectionPersistenceError";
  }
}

export interface MerchantRuleCorrectionRepositoryOptions {
  createId?: () => string;
}

function defaultCreateId(): string {
  return `merchant-rule-${crypto.randomUUID()}`;
}

function toMerchantRuleRecord(row: MerchantRuleRow): MerchantRuleRecord {
  return {
    active: row.active === 1,
    categoryId: row.category_id,
    createdAt: row.created_at,
    displayMerchant: row.display_merchant,
    id: row.id,
    normalizedMerchant: row.normalized_merchant,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export class MerchantRuleCorrectionRepository {
  private readonly createId: () => string;
  private readonly transactions: TransactionRepository;

  constructor(
    private readonly database: D1Database,
    options: MerchantRuleCorrectionRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? defaultCreateId;
    this.transactions = new TransactionRepository(database);
  }

  private async hasEditableCategory(categoryId: string): Promise<boolean> {
    const id = await this.database
      .prepare(
        "SELECT id FROM categories WHERE id = ? AND active = 1 AND (editable = 1 OR system_key = 'TRANSFER')",
      )
      .bind(categoryId)
      .first<string>("id");
    return id !== null;
  }

  private async findByNormalizedMerchant(
    normalizedMerchant: string,
  ): Promise<MerchantRuleRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT ${MERCHANT_RULE_COLUMNS}
         FROM merchant_rules WHERE normalized_merchant = ?`,
      )
      .bind(normalizedMerchant)
      .first<MerchantRuleRow>();
    return row ? toMerchantRuleRecord(row) : null;
  }

  private async diagnose(
    correction: z.infer<typeof correctionSchema>,
    expectedRule: MerchantRuleRecord | null,
  ): Promise<Exclude<MerchantRuleCorrectionResult, { kind: "NO_CHANGE" | "UPDATED" }> | null> {
    const current = await this.transactions.findById(correction.id);
    if (!current || current.status === "REMOVED") return { kind: "NOT_FOUND" };
    if (current.version !== correction.version) {
      return {
        currentVersion: current.version,
        kind: "VERSION_CONFLICT",
        resource: "TRANSACTION",
      };
    }
    if (!current.normalizedMerchant) return { kind: "MERCHANT_NOT_AVAILABLE" };
    if (!(await this.hasEditableCategory(correction.categoryId))) {
      return { kind: "CATEGORY_NOT_FOUND" };
    }
    const currentRule = await this.findByNormalizedMerchant(current.normalizedMerchant);
    if (
      (expectedRule === null && currentRule !== null) ||
      (expectedRule !== null && currentRule?.version !== expectedRule.version)
    ) {
      return {
        currentVersion: currentRule?.version ?? expectedRule?.version ?? 1,
        kind: "VERSION_CONFLICT",
        resource: "MERCHANT_RULE",
      };
    }
    return null;
  }

  async saveForFuture(input: unknown): Promise<MerchantRuleCorrectionResult> {
    const parsed = correctionSchema.safeParse(input);
    if (!parsed.success) throw new MerchantRuleCorrectionPersistenceError("INVALID_INPUT");
    const correction = parsed.data;

    try {
      const transaction = await this.transactions.findById(correction.id);
      if (!transaction || transaction.status === "REMOVED") return { kind: "NOT_FOUND" };
      if (transaction.version !== correction.version) {
        return {
          currentVersion: transaction.version,
          kind: "VERSION_CONFLICT",
          resource: "TRANSACTION",
        };
      }
      if (!transaction.normalizedMerchant) return { kind: "MERCHANT_NOT_AVAILABLE" };
      if (!(await this.hasEditableCategory(correction.categoryId))) {
        return { kind: "CATEGORY_NOT_FOUND" };
      }

      const existingRule = await this.findByNormalizedMerchant(transaction.normalizedMerchant);
      const displayMerchant = (
        transaction.merchantName?.trim() || transaction.normalizedMerchant
      ).slice(0, 256);
      const ruleId = existingRule?.id ?? this.createId();
      const ruleNeedsChange =
        !existingRule ||
        !existingRule.active ||
        existingRule.categoryId !== correction.categoryId ||
        existingRule.displayMerchant !== displayMerchant;
      const transactionNeedsChange =
        transaction.categoryId !== correction.categoryId ||
        transaction.categorizationSource !== "RULE" ||
        transaction.categoryRuleId !== ruleId ||
        transaction.needsReview ||
        transaction.reviewReason !== null;

      if (!ruleNeedsChange && !transactionNeedsChange) {
        return { kind: "NO_CHANGE", merchantRule: existingRule, transaction };
      }

      const statements: D1PreparedStatement[] = [];
      if (!existingRule) {
        statements.push(
          this.database
            .prepare(
              `INSERT INTO merchant_rules (
                id, normalized_merchant, display_merchant, category_id, active,
                created_at, updated_at, version
              ) VALUES (?, ?, ?, ?, 1, ?, ?, 1)
              RETURNING ${MERCHANT_RULE_COLUMNS}`,
            )
            .bind(
              ruleId,
              transaction.normalizedMerchant,
              displayMerchant,
              correction.categoryId,
              correction.now,
              correction.now,
            ),
        );
      } else if (ruleNeedsChange) {
        statements.push(
          this.database
            .prepare(
              `UPDATE merchant_rules
               SET display_merchant = ?, category_id = ?, active = 1, updated_at = ?,
                   version = CASE WHEN version = ? THEN version + 1 ELSE 0 END
               WHERE id = ?
               RETURNING ${MERCHANT_RULE_COLUMNS}`,
            )
            .bind(
              displayMerchant,
              correction.categoryId,
              correction.now,
              existingRule.version,
              existingRule.id,
            ),
        );
      }

      const finalRuleVersion = existingRule ? existingRule.version + (ruleNeedsChange ? 1 : 0) : 1;
      statements.push(
        this.database
          .prepare(
            `UPDATE transactions
             SET category_id = ?, categorization_source = 'RULE', category_rule_id = ?,
                 needs_review = 0, review_reason = NULL, updated_at = ?,
                 version = CASE
                   WHEN version = ? AND status != 'REMOVED' AND normalized_merchant = ?
                     AND EXISTS (
                       SELECT 1 FROM merchant_rules
                       WHERE id = ? AND normalized_merchant = ? AND category_id = ?
                         AND active = 1 AND version = ?
                     )
                   THEN version + 1 ELSE 0
                 END
             WHERE id = ?
             RETURNING ${TRANSACTION_COLUMNS}`,
          )
          .bind(
            correction.categoryId,
            ruleId,
            correction.now,
            correction.version,
            transaction.normalizedMerchant,
            ruleId,
            transaction.normalizedMerchant,
            correction.categoryId,
            finalRuleVersion,
            correction.id,
          ),
      );

      let results: D1Result<MerchantRuleRow | TransactionRow>[];
      try {
        results = await this.database.batch<MerchantRuleRow | TransactionRow>(statements);
      } catch {
        const diagnosis = await this.diagnose(correction, existingRule);
        if (diagnosis) return diagnosis;
        throw new MerchantRuleCorrectionPersistenceError("WRITE_FAILED");
      }

      const transactionResult = results.at(-1)?.results[0] as TransactionRow | undefined;
      if (!transactionResult) {
        const diagnosis = await this.diagnose(correction, existingRule);
        if (diagnosis) return diagnosis;
        throw new MerchantRuleCorrectionPersistenceError("WRITE_FAILED");
      }
      const updatedTransaction = toTransactionRecord(transactionResult);
      const ruleResult = ruleNeedsChange
        ? (results[0]?.results[0] as MerchantRuleRow | undefined)
        : undefined;
      const merchantRule = ruleResult ? toMerchantRuleRecord(ruleResult) : existingRule;
      if (!merchantRule) throw new MerchantRuleCorrectionPersistenceError("WRITE_FAILED");

      return { kind: "UPDATED", merchantRule, transaction: updatedTransaction };
    } catch (error) {
      if (error instanceof MerchantRuleCorrectionPersistenceError) throw error;
      throw new MerchantRuleCorrectionPersistenceError("WRITE_FAILED");
    }
  }
}

const managementCreateSchema = z.strictObject({
  categoryId: identifierSchema,
  displayMerchant: z.string().trim().min(1).max(256),
  now: z.iso.datetime({ offset: true }),
});

const managementUpdateSchema = z
  .strictObject({
    active: z.boolean().optional(),
    categoryId: identifierSchema.optional(),
    displayMerchant: z.string().trim().min(1).max(256).optional(),
    id: identifierSchema,
    now: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .refine(
    (value) =>
      value.active !== undefined ||
      value.categoryId !== undefined ||
      value.displayMerchant !== undefined,
  );

const managementPreviewSchema = z.strictObject({
  categoryId: identifierSchema,
  displayMerchant: z.string().trim().min(1).max(256),
});

const managementListSchema = z.strictObject({
  active: z.boolean().optional(),
  cursor: cursorSchema.optional(),
  pageSize: z.int().min(1).max(100),
});

const merchantRuleCursorSchema = z.strictObject({
  active: z.boolean().nullable(),
  id: identifierSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.literal(1),
});

export interface MerchantRuleImpactRecord {
  conflictingTransactions: number;
  historicalTransactionsChanged: 0;
  matchingTransactions: number;
}

export interface MerchantRulePreviewRecord {
  existingRule: MerchantRuleRecord | null;
  impact: MerchantRuleImpactRecord;
  proposedRule: {
    categoryId: string;
    displayMerchant: string;
    normalizedMerchant: string;
  };
}

export interface MerchantRulePage {
  hasMore: boolean;
  nextCursor: string | null;
  rules: MerchantRuleRecord[];
}

export type MerchantRuleCreateResult =
  | { kind: "CATEGORY_NOT_FOUND" }
  | { kind: "MERCHANT_INVALID" }
  | { kind: "NORMALIZED_MERCHANT_CONFLICT" }
  | { impact: MerchantRuleImpactRecord; kind: "CREATED"; merchantRule: MerchantRuleRecord };

export type MerchantRuleUpdateResult =
  | { kind: "CATEGORY_NOT_FOUND" }
  | { kind: "MERCHANT_INVALID" }
  | { kind: "NORMALIZED_MERCHANT_CONFLICT" }
  | { kind: "NOT_FOUND" }
  | { currentVersion: number; kind: "VERSION_CONFLICT" }
  | {
      impact: MerchantRuleImpactRecord;
      kind: "NO_CHANGE" | "UPDATED";
      merchantRule: MerchantRuleRecord;
    };

export type MerchantRuleManagementPersistenceErrorCode = "INVALID_INPUT" | "WRITE_FAILED";

export class MerchantRuleManagementPersistenceError extends Error {
  constructor(readonly code: MerchantRuleManagementPersistenceErrorCode) {
    super(code);
    this.name = "MerchantRuleManagementPersistenceError";
  }
}

export interface MerchantRuleManagementRepositoryOptions {
  createId?: () => string;
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

function decodeMerchantRuleCursor(value: string, active: boolean | undefined) {
  try {
    const cursor = merchantRuleCursorSchema.parse(JSON.parse(decodeBase64Url(value)) as unknown);
    if (cursor.active !== (active ?? null)) {
      throw new MerchantRuleManagementPersistenceError("INVALID_INPUT");
    }
    return cursor;
  } catch (error) {
    if (error instanceof MerchantRuleManagementPersistenceError) throw error;
    throw new MerchantRuleManagementPersistenceError("INVALID_INPUT");
  }
}

function encodeMerchantRuleCursor(rule: MerchantRuleRecord, active: boolean | undefined): string {
  return cursorSchema.parse(
    encodeBase64Url(
      JSON.stringify({
        active: active ?? null,
        id: rule.id,
        updatedAt: rule.updatedAt,
        version: 1,
      }),
    ),
  );
}

export class MerchantRuleManagementRepository {
  private readonly createId: () => string;

  constructor(
    private readonly database: D1Database,
    options: MerchantRuleManagementRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? defaultCreateId;
  }

  private async hasEditableCategory(categoryId: string): Promise<boolean> {
    const id = await this.database
      .prepare(
        "SELECT id FROM categories WHERE id = ? AND active = 1 AND (editable = 1 OR system_key = 'TRANSFER')",
      )
      .bind(categoryId)
      .first<string>("id");
    return id !== null;
  }

  private async findById(id: string): Promise<MerchantRuleRecord | null> {
    const row = await this.database
      .prepare(`SELECT ${MERCHANT_RULE_COLUMNS} FROM merchant_rules WHERE id = ?`)
      .bind(id)
      .first<MerchantRuleRow>();
    return row ? toMerchantRuleRecord(row) : null;
  }

  private async findByNormalizedMerchant(
    normalizedMerchant: string,
  ): Promise<MerchantRuleRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT ${MERCHANT_RULE_COLUMNS}
         FROM merchant_rules WHERE normalized_merchant = ?`,
      )
      .bind(normalizedMerchant)
      .first<MerchantRuleRow>();
    return row ? toMerchantRuleRecord(row) : null;
  }

  private async impact(
    normalizedMerchant: string,
    categoryId: string,
    ruleId: string | null,
  ): Promise<MerchantRuleImpactRecord> {
    const row = await this.database
      .prepare(
        `SELECT
           COUNT(*) AS matching_transactions,
           COALESCE(SUM(CASE
             WHEN category_id IS NOT ? OR categorization_source != 'RULE'
               OR category_rule_id IS NOT ? THEN 1 ELSE 0
           END), 0) AS conflicting_transactions
         FROM transactions
         WHERE normalized_merchant = ? AND status != 'REMOVED'`,
      )
      .bind(categoryId, ruleId, normalizedMerchant)
      .first<{ conflicting_transactions: number; matching_transactions: number }>();
    if (!row) throw new MerchantRuleManagementPersistenceError("WRITE_FAILED");
    return {
      conflictingTransactions: row.conflicting_transactions,
      historicalTransactionsChanged: 0,
      matchingTransactions: row.matching_transactions,
    };
  }

  async preview(input: unknown): Promise<MerchantRulePreviewRecord | { kind: string }> {
    const parsed = managementPreviewSchema.safeParse(input);
    if (!parsed.success) throw new MerchantRuleManagementPersistenceError("INVALID_INPUT");
    const preview = parsed.data;
    const normalizedMerchant = normalizeMerchantName(preview.displayMerchant);
    if (!normalizedMerchant) return { kind: "MERCHANT_INVALID" };

    try {
      if (!(await this.hasEditableCategory(preview.categoryId))) {
        return { kind: "CATEGORY_NOT_FOUND" };
      }
      const existingRule = await this.findByNormalizedMerchant(normalizedMerchant);
      return {
        existingRule,
        impact: await this.impact(normalizedMerchant, preview.categoryId, existingRule?.id ?? null),
        proposedRule: {
          categoryId: preview.categoryId,
          displayMerchant: preview.displayMerchant,
          normalizedMerchant,
        },
      };
    } catch (error) {
      if (error instanceof MerchantRuleManagementPersistenceError) throw error;
      throw new MerchantRuleManagementPersistenceError("WRITE_FAILED");
    }
  }

  async create(input: unknown): Promise<MerchantRuleCreateResult> {
    const parsed = managementCreateSchema.safeParse(input);
    if (!parsed.success) throw new MerchantRuleManagementPersistenceError("INVALID_INPUT");
    const creation = parsed.data;
    const normalizedMerchant = normalizeMerchantName(creation.displayMerchant);
    if (!normalizedMerchant) return { kind: "MERCHANT_INVALID" };

    try {
      if (!(await this.hasEditableCategory(creation.categoryId))) {
        return { kind: "CATEGORY_NOT_FOUND" };
      }
      if (await this.findByNormalizedMerchant(normalizedMerchant)) {
        return { kind: "NORMALIZED_MERCHANT_CONFLICT" };
      }
      const row = await this.database
        .prepare(
          `INSERT INTO merchant_rules (
            id, normalized_merchant, display_merchant, category_id, active,
            created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, 1, ?, ?, 1)
          RETURNING ${MERCHANT_RULE_COLUMNS}`,
        )
        .bind(
          this.createId(),
          normalizedMerchant,
          creation.displayMerchant,
          creation.categoryId,
          creation.now,
          creation.now,
        )
        .first<MerchantRuleRow>();
      if (!row) throw new MerchantRuleManagementPersistenceError("WRITE_FAILED");
      const merchantRule = toMerchantRuleRecord(row);
      return {
        impact: await this.impact(normalizedMerchant, creation.categoryId, merchantRule.id),
        kind: "CREATED",
        merchantRule,
      };
    } catch (error) {
      if (error instanceof MerchantRuleManagementPersistenceError) throw error;
      if (await this.findByNormalizedMerchant(normalizedMerchant)) {
        return { kind: "NORMALIZED_MERCHANT_CONFLICT" };
      }
      throw new MerchantRuleManagementPersistenceError("WRITE_FAILED");
    }
  }

  async update(input: unknown): Promise<MerchantRuleUpdateResult> {
    const parsed = managementUpdateSchema.safeParse(input);
    if (!parsed.success) throw new MerchantRuleManagementPersistenceError("INVALID_INPUT");
    const update = parsed.data;

    try {
      const current = await this.findById(update.id);
      if (!current) return { kind: "NOT_FOUND" };
      if (current.version !== update.version) {
        return { currentVersion: current.version, kind: "VERSION_CONFLICT" };
      }
      const displayMerchant = update.displayMerchant ?? current.displayMerchant;
      const normalizedMerchant = normalizeMerchantName(displayMerchant);
      if (!normalizedMerchant) return { kind: "MERCHANT_INVALID" };
      const categoryId = update.categoryId ?? current.categoryId;
      if (update.categoryId && !(await this.hasEditableCategory(categoryId))) {
        return { kind: "CATEGORY_NOT_FOUND" };
      }
      const conflictingRule = await this.findByNormalizedMerchant(normalizedMerchant);
      if (conflictingRule && conflictingRule.id !== current.id) {
        return { kind: "NORMALIZED_MERCHANT_CONFLICT" };
      }
      const active = update.active ?? current.active;
      if (
        active === current.active &&
        categoryId === current.categoryId &&
        displayMerchant === current.displayMerchant
      ) {
        return {
          impact: await this.impact(normalizedMerchant, categoryId, current.id),
          kind: "NO_CHANGE",
          merchantRule: current,
        };
      }

      const row = await this.database
        .prepare(
          `UPDATE merchant_rules
           SET normalized_merchant = ?, display_merchant = ?, category_id = ?, active = ?,
               updated_at = ?, version = version + 1
           WHERE id = ? AND version = ?
           RETURNING ${MERCHANT_RULE_COLUMNS}`,
        )
        .bind(
          normalizedMerchant,
          displayMerchant,
          categoryId,
          active ? 1 : 0,
          update.now,
          update.id,
          update.version,
        )
        .first<MerchantRuleRow>();
      if (!row) {
        const latest = await this.findById(update.id);
        if (!latest) return { kind: "NOT_FOUND" };
        return { currentVersion: latest.version, kind: "VERSION_CONFLICT" };
      }
      const merchantRule = toMerchantRuleRecord(row);
      return {
        impact: await this.impact(normalizedMerchant, categoryId, merchantRule.id),
        kind: "UPDATED",
        merchantRule,
      };
    } catch (error) {
      if (error instanceof MerchantRuleManagementPersistenceError) throw error;
      throw new MerchantRuleManagementPersistenceError("WRITE_FAILED");
    }
  }

  async listPage(input: unknown): Promise<MerchantRulePage> {
    const query = managementListSchema.safeParse(input);
    if (!query.success) throw new MerchantRuleManagementPersistenceError("INVALID_INPUT");
    const conditions: string[] = [];
    const bindings: Array<string | number> = [];
    if (query.data.active !== undefined) {
      conditions.push("active = ?");
      bindings.push(query.data.active ? 1 : 0);
    }
    if (query.data.cursor) {
      const cursor = decodeMerchantRuleCursor(query.data.cursor, query.data.active);
      conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    try {
      const result = await this.database
        .prepare(
          `SELECT ${MERCHANT_RULE_COLUMNS} FROM merchant_rules
           ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .bind(...bindings, query.data.pageSize + 1)
        .all<MerchantRuleRow>();
      const records = result.results.map(toMerchantRuleRecord);
      const hasMore = records.length > query.data.pageSize;
      const rules = hasMore ? records.slice(0, query.data.pageSize) : records;
      return {
        hasMore,
        nextCursor:
          hasMore && rules.at(-1)
            ? encodeMerchantRuleCursor(rules.at(-1)!, query.data.active)
            : null,
        rules,
      };
    } catch (error) {
      if (error instanceof MerchantRuleManagementPersistenceError) throw error;
      throw new MerchantRuleManagementPersistenceError("WRITE_FAILED");
    }
  }
}
