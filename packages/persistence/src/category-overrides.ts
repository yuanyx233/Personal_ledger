import * as z from "zod";

import {
  TRANSACTION_COLUMNS,
  TransactionRepository,
  toTransactionRecord,
  type TransactionRecord,
  type TransactionRow,
} from "./repositories";

const identifierSchema = z.string().min(1).max(160);
const overrideSchema = z.strictObject({
  categoryId: identifierSchema,
  id: identifierSchema,
  now: z.iso.datetime({ offset: true }),
  version: z.int().positive(),
});

export type TransactionCategoryOverrideResult =
  | { kind: "CATEGORY_NOT_FOUND" }
  | { kind: "NOT_FOUND" }
  | { kind: "NO_CHANGE"; transaction: TransactionRecord }
  | { currentVersion: number; kind: "VERSION_CONFLICT" }
  | { kind: "UPDATED"; transaction: TransactionRecord };

export type TransactionCategoryOverridePersistenceErrorCode = "INVALID_INPUT" | "WRITE_FAILED";

export class TransactionCategoryOverridePersistenceError extends Error {
  constructor(readonly code: TransactionCategoryOverridePersistenceErrorCode) {
    super(code);
    this.name = "TransactionCategoryOverridePersistenceError";
  }
}

export class TransactionCategoryOverrideRepository {
  private readonly transactions: TransactionRepository;

  constructor(private readonly database: D1Database) {
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

  async override(input: unknown): Promise<TransactionCategoryOverrideResult> {
    const parsed = overrideSchema.safeParse(input);
    if (!parsed.success) {
      throw new TransactionCategoryOverridePersistenceError("INVALID_INPUT");
    }
    const override = parsed.data;

    try {
      const row = await this.database
        .prepare(
          `UPDATE transactions
           SET category_id = ?, categorization_source = 'MANUAL', category_rule_id = NULL,
               needs_review = 0, review_reason = NULL, updated_at = ?, version = version + 1
           WHERE id = ? AND status != 'REMOVED' AND version = ?
             AND EXISTS (
               SELECT 1 FROM categories
               WHERE id = ? AND active = 1 AND (editable = 1 OR system_key = 'TRANSFER')
             )
             AND (
               category_id IS NOT ? OR categorization_source != 'MANUAL'
               OR category_rule_id IS NOT NULL OR needs_review != 0 OR review_reason IS NOT NULL
             )
           RETURNING ${TRANSACTION_COLUMNS}`,
        )
        .bind(
          override.categoryId,
          override.now,
          override.id,
          override.version,
          override.categoryId,
          override.categoryId,
        )
        .first<TransactionRow>();
      if (row) return { kind: "UPDATED", transaction: toTransactionRecord(row) };

      const current = await this.transactions.findById(override.id);
      if (!current || current.status === "REMOVED") return { kind: "NOT_FOUND" };
      if (current.version !== override.version) {
        return { currentVersion: current.version, kind: "VERSION_CONFLICT" };
      }
      if (!(await this.hasEditableCategory(override.categoryId))) {
        return { kind: "CATEGORY_NOT_FOUND" };
      }
      if (
        current.categoryId === override.categoryId &&
        current.categorizationSource === "MANUAL" &&
        current.categoryRuleId === null &&
        !current.needsReview &&
        current.reviewReason === null
      ) {
        return { kind: "NO_CHANGE", transaction: current };
      }
      throw new TransactionCategoryOverridePersistenceError("WRITE_FAILED");
    } catch (error) {
      if (error instanceof TransactionCategoryOverridePersistenceError) throw error;
      throw new TransactionCategoryOverridePersistenceError("WRITE_FAILED");
    }
  }
}
