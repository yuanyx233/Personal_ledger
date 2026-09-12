import {
  calendarDateSchema,
  installmentCountSchema,
  manualTransactionCurrencySchema,
} from "@ledger/domain/api-contracts";
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
const accountLabelSchema = z.string().trim().min(1).max(160);
const descriptionSchema = z.string().trim().min(1).max(512);
const amountMinorSchema = z.int().nonnegative();
const directionSchema = z.enum(["INFLOW", "OUTFLOW"]);
const nowSchema = z.iso.datetime({ offset: true });

const mutableFields = {
  accountLabel: accountLabelSchema,
  amountMinor: amountMinorSchema,
  categoryId: identifierSchema,
  currency: manualTransactionCurrencySchema,
  description: descriptionSchema,
  direction: directionSchema,
  postedDate: calendarDateSchema,
} as const;

const createSchema = z
  .strictObject({
    accountLabel: mutableFields.accountLabel,
    amountMinor: mutableFields.amountMinor,
    reimbursementMinor: amountMinorSchema.default(0),
    categoryId: mutableFields.categoryId.optional(),
    currency: mutableFields.currency,
    description: mutableFields.description,
    direction: mutableFields.direction,
    installmentCount: installmentCountSchema.optional(),
    now: nowSchema,
    postedDate: mutableFields.postedDate,
    rememberMerchant: z.literal(true).optional(),
  })
  .refine((value) => value.reimbursementMinor <= value.amountMinor)
  .refine((value) => value.rememberMerchant !== true || value.categoryId !== undefined);

type ManualTransactionCreateInput = z.infer<typeof createSchema>;

const updateSchema = z
  .strictObject({
    accountLabel: mutableFields.accountLabel.optional(),
    amountMinor: mutableFields.amountMinor.optional(),
    reimbursementMinor: amountMinorSchema.optional(),
    categoryId: mutableFields.categoryId.optional(),
    currency: mutableFields.currency.optional(),
    description: mutableFields.description.optional(),
    direction: mutableFields.direction.optional(),
    id: identifierSchema,
    now: nowSchema,
    postedDate: mutableFields.postedDate.optional(),
    version: z.int().positive(),
  })
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, field]) => !["id", "now", "version"].includes(key) && field !== undefined,
      ),
    { message: "At least one transaction field is required." },
  );

const deleteSchema = z.strictObject({
  id: identifierSchema,
  now: nowSchema,
  version: z.int().positive(),
});

export type ManualTransactionRecord = TransactionRecord & {
  accountLabel: string;
  categorizationSource: "MANUAL" | "RULE" | "UNCLASSIFIED";
  categoryId: string;
  source: "MANUAL";
  status: "POSTED" | "REMOVED";
};

export type ManualTransactionCreateResult =
  | { kind: "CATEGORY_CONFIRMATION_REQUIRED" }
  | { kind: "CATEGORY_NOT_FOUND" }
  | {
      kind: "CREATED";
      transaction: ManualTransactionRecord;
      transactions?: ManualTransactionRecord[];
    };

export type ManualTransactionMutationResult =
  | { kind: "CATEGORY_NOT_FOUND" }
  | { kind: "NOT_FOUND" }
  | { currentVersion: number; kind: "VERSION_CONFLICT" }
  | { kind: "UPDATED"; transaction: ManualTransactionRecord };

export type ManualTransactionDeleteResult =
  | { kind: "NOT_FOUND" }
  | { currentVersion: number; kind: "VERSION_CONFLICT" }
  | { kind: "DELETED"; transaction: ManualTransactionRecord };

export type ManualTransactionPersistenceErrorCode = "INVALID_INPUT" | "WRITE_FAILED";

export class ManualTransactionPersistenceError extends Error {
  constructor(readonly code: ManualTransactionPersistenceErrorCode) {
    super(code);
    this.name = "ManualTransactionPersistenceError";
  }
}

export interface ManualTransactionRepositoryOptions {
  createId?: () => string;
  createInstallmentGroupId?: () => string;
  createRuleId?: () => string;
}

function defaultCreateId(): string {
  return `transaction-${crypto.randomUUID()}`;
}

function defaultCreateRuleId(): string {
  return `merchant-rule-${crypto.randomUUID()}`;
}

function defaultCreateInstallmentGroupId(): string {
  return `installment-${crypto.randomUUID()}`;
}

function allocateMinorUnits(total: number, count: number): number[] {
  const regularAmount = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? total - regularAmount * (count - 1) : regularAmount,
  );
}

function allocateMinorUnitsWithinCaps(total: number, caps: readonly number[]): number[] {
  let remaining = total;
  const allocated = Array.from({ length: caps.length }, () => 0);
  const regularAmount = Math.floor(total / caps.length);
  for (let index = 0; index < caps.length; index += 1) {
    const amount = Math.min(regularAmount, caps[index]!, remaining);
    allocated[index] = amount;
    remaining -= amount;
  }
  for (let index = caps.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const available = caps[index]! - allocated[index]!;
    const amount = Math.min(available, remaining);
    allocated[index]! += amount;
    remaining -= amount;
  }
  return allocated;
}

function monthlyInstallmentDates(firstDate: string, count: number): string[] {
  const [yearText, monthText, dayText] = firstDate.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  return Array.from({ length: count }, (_, offset) => {
    const absoluteMonth = monthIndex + offset;
    const targetYear = year + Math.floor(absoluteMonth / 12);
    const targetMonthIndex = absoluteMonth % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
    const targetDay = Math.min(day, lastDay);
    return `${String(targetYear).padStart(4, "0")}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
  });
}

function asManualTransaction(record: TransactionRecord | null): ManualTransactionRecord | null {
  if (
    !record ||
    record.source !== "MANUAL" ||
    record.accountLabel === null ||
    record.categoryId === null ||
    !["MANUAL", "RULE", "UNCLASSIFIED"].includes(record.categorizationSource) ||
    (record.status !== "POSTED" && record.status !== "REMOVED")
  ) {
    return null;
  }
  return record as ManualTransactionRecord;
}

export class ManualTransactionRepository {
  private readonly createId: () => string;
  private readonly createInstallmentGroupId: () => string;
  private readonly createRuleId: () => string;
  private readonly transactions: TransactionRepository;

  constructor(
    private readonly database: D1Database,
    options: ManualTransactionRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? defaultCreateId;
    this.createInstallmentGroupId =
      options.createInstallmentGroupId ?? defaultCreateInstallmentGroupId;
    this.createRuleId = options.createRuleId ?? defaultCreateRuleId;
    this.transactions = new TransactionRepository(database);
  }

  private async hasActiveCategory(categoryId: string): Promise<boolean> {
    const id = await this.database
      .prepare("SELECT id FROM categories WHERE id = ? AND active = 1")
      .bind(categoryId)
      .first<string>("id");
    return id !== null;
  }

  private async findManual(id: string): Promise<ManualTransactionRecord | null> {
    return asManualTransaction(await this.transactions.findById(id));
  }

  private async createInstallmentSchedule(
    transaction: ManualTransactionCreateInput & { installmentCount: number },
    merchantName: string,
    normalizedMerchant: string,
  ): Promise<ManualTransactionCreateResult> {
    const count = transaction.installmentCount;
    const groupId = this.createInstallmentGroupId();
    const amounts = allocateMinorUnits(transaction.amountMinor, count);
    const reimbursements = allocateMinorUnitsWithinCaps(transaction.reimbursementMinor, amounts);
    const dates = monthlyInstallmentDates(transaction.postedDate, count);
    const transactionIds = Array.from({ length: count }, () => this.createId());

    if (transaction.rememberMerchant) {
      const ruleId = this.createRuleId();
      const statements = [
        this.database
          .prepare(
            `INSERT INTO merchant_rules (
               id, normalized_merchant, display_merchant, category_id, active,
               created_at, updated_at, version
             )
             SELECT ?, ?, ?, category.id, 1, ?, ?, 1
             FROM categories AS category
             WHERE category.id = ? AND category.active = 1 AND category.editable = 1
             ON CONFLICT(normalized_merchant) DO UPDATE SET
               display_merchant = excluded.display_merchant,
               category_id = excluded.category_id,
               active = 1,
               updated_at = excluded.updated_at,
               version = merchant_rules.version + 1
             RETURNING id`,
          )
          .bind(
            ruleId,
            normalizedMerchant,
            merchantName,
            transaction.now,
            transaction.now,
            transaction.categoryId,
          ),
        ...transactionIds.map((id, index) =>
          this.database
            .prepare(
              `INSERT INTO transactions (
                 id, source, account_label, status,
                 posted_date, amount_minor, reimbursement_minor, direction, currency,
                 raw_description, merchant_name, payment_metadata_json, category_id,
                 categorization_source, category_rule_id, needs_review, review_reason,
                 normalized_merchant, installment_group_id, installment_number,
                 installment_count, created_at, updated_at, version
               )
               SELECT
                 ?, 'MANUAL', ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?, NULL,
                 merchant_rule.category_id, 'RULE', merchant_rule.id, 0, NULL, ?, ?, ?, ?, ?, ?, 1
               FROM merchant_rules AS merchant_rule
               JOIN categories AS category
                 ON category.id = merchant_rule.category_id AND category.active = 1
               WHERE merchant_rule.normalized_merchant = ?
                 AND merchant_rule.category_id = ?
                 AND merchant_rule.active = 1
               RETURNING ${TRANSACTION_COLUMNS}`,
            )
            .bind(
              id,
              transaction.accountLabel,
              dates[index],
              amounts[index],
              reimbursements[index],
              transaction.direction,
              transaction.currency,
              transaction.description,
              merchantName,
              normalizedMerchant,
              groupId,
              index + 1,
              count,
              transaction.now,
              transaction.now,
              normalizedMerchant,
              transaction.categoryId,
            ),
        ),
      ];
      const results = await this.database.batch<Record<string, unknown> | TransactionRow>(
        statements,
      );
      if (!results[0]?.results[0]) return { kind: "CATEGORY_NOT_FOUND" };
      const created = results
        .slice(1)
        .map((result) => {
          const row = result.results[0] as TransactionRow | undefined;
          return row ? asManualTransaction(toTransactionRecord(row)) : null;
        })
        .filter((record): record is ManualTransactionRecord => record !== null);
      if (created.length !== count) throw new ManualTransactionPersistenceError("WRITE_FAILED");
      return { kind: "CREATED", transaction: created[0]!, transactions: created };
    }

    const statements = transactionIds.map((id, index) =>
      this.database
        .prepare(
          `WITH active_explicit_category AS (
             SELECT id FROM categories WHERE id = ? AND active = 1
           ), matched_rule AS (
             SELECT merchant_rule.id, merchant_rule.category_id
             FROM merchant_rules AS merchant_rule
             JOIN categories AS rule_category
               ON rule_category.id = merchant_rule.category_id AND rule_category.active = 1
             WHERE merchant_rule.normalized_merchant = ? AND merchant_rule.active = 1
           ), resolution AS (
             SELECT
               CASE
                 WHEN ? IS NOT NULL THEN (SELECT id FROM active_explicit_category)
                 WHEN matched_rule.id IS NOT NULL THEN matched_rule.category_id
                 ELSE unclassified.id
               END AS category_id,
               CASE
                 WHEN ? IS NOT NULL THEN 'MANUAL'
                 WHEN matched_rule.id IS NOT NULL THEN 'RULE'
                 ELSE 'UNCLASSIFIED'
               END AS categorization_source,
               CASE WHEN ? IS NULL THEN matched_rule.id ELSE NULL END AS category_rule_id
             FROM categories AS unclassified
             LEFT JOIN matched_rule ON 1 = 1
             WHERE unclassified.system_key = 'UNCLASSIFIED'
               AND (? IS NULL OR EXISTS (SELECT 1 FROM active_explicit_category))
               AND (? IS NOT NULL OR matched_rule.id IS NOT NULL)
           )
           INSERT INTO transactions (
             id, source, account_label, status,
             posted_date, amount_minor, reimbursement_minor, direction, currency,
             raw_description, merchant_name, payment_metadata_json, category_id,
             categorization_source, category_rule_id, needs_review, review_reason,
             normalized_merchant, installment_group_id, installment_number,
             installment_count, created_at, updated_at, version
           ) SELECT
             ?, 'MANUAL', ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?, NULL, resolution.category_id,
             resolution.categorization_source, resolution.category_rule_id,
             CASE WHEN resolution.categorization_source = 'UNCLASSIFIED' THEN 1 ELSE 0 END,
             CASE WHEN resolution.categorization_source = 'UNCLASSIFIED'
               THEN 'UNCLASSIFIED_MERCHANT' ELSE NULL END,
             ?, ?, ?, ?, ?, ?, 1
           FROM resolution
           RETURNING ${TRANSACTION_COLUMNS}`,
        )
        .bind(
          transaction.categoryId ?? null,
          normalizedMerchant,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          id,
          transaction.accountLabel,
          dates[index],
          amounts[index],
          reimbursements[index],
          transaction.direction,
          transaction.currency,
          transaction.description,
          merchantName,
          normalizedMerchant,
          groupId,
          index + 1,
          count,
          transaction.now,
          transaction.now,
        ),
    );
    const results = await this.database.batch<TransactionRow>(statements);
    const created = results
      .map((result) => {
        const row = result.results[0];
        return row ? asManualTransaction(toTransactionRecord(row)) : null;
      })
      .filter((record): record is ManualTransactionRecord => record !== null);
    if (created.length === 0) {
      return {
        kind:
          transaction.categoryId === undefined
            ? "CATEGORY_CONFIRMATION_REQUIRED"
            : "CATEGORY_NOT_FOUND",
      };
    }
    if (created.length !== count) throw new ManualTransactionPersistenceError("WRITE_FAILED");
    return { kind: "CREATED", transaction: created[0]!, transactions: created };
  }

  async create(input: unknown): Promise<ManualTransactionCreateResult> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw new ManualTransactionPersistenceError("INVALID_INPUT");
    const transaction = parsed.data;

    try {
      const merchantName = transaction.description.trim().slice(0, 256);
      const normalizedMerchant = normalizeMerchantName(merchantName);
      if (!normalizedMerchant) throw new ManualTransactionPersistenceError("INVALID_INPUT");
      if (transaction.installmentCount !== undefined) {
        return await this.createInstallmentSchedule(
          transaction as ManualTransactionCreateInput & { installmentCount: number },
          merchantName,
          normalizedMerchant,
        );
      }
      const id = this.createId();
      if (transaction.rememberMerchant) {
        const ruleId = this.createRuleId();
        const statements = [
          this.database
            .prepare(
              `INSERT INTO merchant_rules (
                 id, normalized_merchant, display_merchant, category_id, active,
                 created_at, updated_at, version
               )
               SELECT ?, ?, ?, category.id, 1, ?, ?, 1
               FROM categories AS category
               WHERE category.id = ? AND category.active = 1 AND category.editable = 1
               ON CONFLICT(normalized_merchant) DO UPDATE SET
                 display_merchant = excluded.display_merchant,
                 category_id = excluded.category_id,
                 active = 1,
                 updated_at = excluded.updated_at,
                 version = merchant_rules.version + 1
               RETURNING id`,
            )
            .bind(
              ruleId,
              normalizedMerchant,
              merchantName,
              transaction.now,
              transaction.now,
              transaction.categoryId,
            ),
          this.database
            .prepare(
              `INSERT INTO transactions (
                 id, source, account_label,
                 status,
                 posted_date, amount_minor, reimbursement_minor, direction, currency,
                 raw_description, merchant_name,
                 payment_metadata_json, category_id, categorization_source,
                 category_rule_id, needs_review, review_reason, normalized_merchant,
                 created_at, updated_at, version
               )
               SELECT
                 ?, 'MANUAL', ?, 'POSTED',
                 ?, ?, ?, ?, ?, ?, ?, NULL, merchant_rule.category_id, 'RULE',
                 merchant_rule.id, 0, NULL, ?, ?, ?, 1
               FROM merchant_rules AS merchant_rule
               JOIN categories AS category
                 ON category.id = merchant_rule.category_id AND category.active = 1
               WHERE merchant_rule.normalized_merchant = ?
                 AND merchant_rule.category_id = ?
                 AND merchant_rule.active = 1
               RETURNING ${TRANSACTION_COLUMNS}`,
            )
            .bind(
              id,
              transaction.accountLabel,
              transaction.postedDate,
              transaction.amountMinor,
              transaction.reimbursementMinor,
              transaction.direction,
              transaction.currency,
              transaction.description,
              merchantName,
              normalizedMerchant,
              transaction.now,
              transaction.now,
              normalizedMerchant,
              transaction.categoryId,
            ),
        ];
        const results = await this.database.batch<Record<string, unknown> | TransactionRow>(
          statements,
        );
        if (!results[0]?.results[0]) return { kind: "CATEGORY_NOT_FOUND" };
        const row = results[1]?.results[0] as TransactionRow | undefined;
        const created = row ? asManualTransaction(toTransactionRecord(row)) : null;
        if (!created) throw new ManualTransactionPersistenceError("WRITE_FAILED");
        return { kind: "CREATED", transaction: created };
      }
      const row = await this.database
        .prepare(
          `WITH active_explicit_category AS (
             SELECT id FROM categories WHERE id = ? AND active = 1
           ), matched_rule AS (
             SELECT merchant_rule.id, merchant_rule.category_id
             FROM merchant_rules AS merchant_rule
             JOIN categories AS rule_category
               ON rule_category.id = merchant_rule.category_id AND rule_category.active = 1
             WHERE merchant_rule.normalized_merchant = ? AND merchant_rule.active = 1
           ), resolution AS (
             SELECT
               CASE
                 WHEN ? IS NOT NULL THEN (SELECT id FROM active_explicit_category)
                 WHEN matched_rule.id IS NOT NULL THEN matched_rule.category_id
                 ELSE unclassified.id
               END AS category_id,
               CASE
                 WHEN ? IS NOT NULL THEN 'MANUAL'
                 WHEN matched_rule.id IS NOT NULL THEN 'RULE'
                 ELSE 'UNCLASSIFIED'
               END AS categorization_source,
               CASE WHEN ? IS NULL THEN matched_rule.id ELSE NULL END AS category_rule_id
             FROM categories AS unclassified
             LEFT JOIN matched_rule ON 1 = 1
             WHERE unclassified.system_key = 'UNCLASSIFIED'
               AND (? IS NULL OR EXISTS (SELECT 1 FROM active_explicit_category))
               AND (? IS NOT NULL OR matched_rule.id IS NOT NULL)
           )
          INSERT INTO transactions (
            id, source, account_label,
            status,
            posted_date, amount_minor, reimbursement_minor, direction, currency,
            raw_description, merchant_name, payment_metadata_json, category_id,
            categorization_source, category_rule_id, needs_review, review_reason,
            normalized_merchant,
            created_at, updated_at, version
          ) SELECT
            ?, 'MANUAL', ?, 'POSTED',
            ?, ?, ?, ?, ?, ?, ?, NULL, resolution.category_id,
            resolution.categorization_source, resolution.category_rule_id,
            CASE WHEN resolution.categorization_source = 'UNCLASSIFIED' THEN 1 ELSE 0 END,
            CASE WHEN resolution.categorization_source = 'UNCLASSIFIED'
              THEN 'UNCLASSIFIED_MERCHANT' ELSE NULL END,
            ?, ?, ?, 1
          FROM resolution
          RETURNING ${TRANSACTION_COLUMNS}`,
        )
        .bind(
          transaction.categoryId ?? null,
          normalizedMerchant,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          transaction.categoryId ?? null,
          id,
          transaction.accountLabel,
          transaction.postedDate,
          transaction.amountMinor,
          transaction.reimbursementMinor,
          transaction.direction,
          transaction.currency,
          transaction.description,
          merchantName,
          normalizedMerchant,
          transaction.now,
          transaction.now,
        )
        .first<TransactionRow>();
      if (!row) {
        return {
          kind:
            transaction.categoryId === undefined
              ? "CATEGORY_CONFIRMATION_REQUIRED"
              : "CATEGORY_NOT_FOUND",
        };
      }
      const created = asManualTransaction(toTransactionRecord(row));
      if (!created) throw new ManualTransactionPersistenceError("WRITE_FAILED");
      return { kind: "CREATED", transaction: created };
    } catch (error) {
      if (error instanceof ManualTransactionPersistenceError) throw error;
      throw new ManualTransactionPersistenceError("WRITE_FAILED");
    }
  }

  async update(input: unknown): Promise<ManualTransactionMutationResult> {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) throw new ManualTransactionPersistenceError("INVALID_INPUT");
    const update = parsed.data;

    try {
      const assignments: string[] = [];
      const bindings: Array<string | number | null> = [];
      const add = (column: string, value: string | number | undefined) => {
        if (value === undefined) return;
        assignments.push(`${column} = ?`);
        bindings.push(value);
      };
      add("account_label", update.accountLabel);
      add("amount_minor", update.amountMinor);
      add("reimbursement_minor", update.reimbursementMinor);
      add("category_id", update.categoryId);
      add("currency", update.currency);
      add("raw_description", update.description);
      add("direction", update.direction);
      add("posted_date", update.postedDate);
      assignments.push(
        "categorization_source = 'MANUAL'",
        "updated_at = ?",
        "version = version + 1",
      );
      bindings.push(update.now, update.id, update.version);
      const categoryCondition = update.categoryId
        ? "AND EXISTS (SELECT 1 FROM categories WHERE id = ? AND active = 1)"
        : "";
      if (update.categoryId) bindings.push(update.categoryId);
      const amountCondition =
        update.amountMinor !== undefined || update.reimbursementMinor !== undefined
          ? "AND COALESCE(?, reimbursement_minor) <= COALESCE(?, amount_minor)"
          : "";
      if (amountCondition)
        bindings.push(update.reimbursementMinor ?? null, update.amountMinor ?? null);

      const row = await this.database
        .prepare(
          `UPDATE transactions SET ${assignments.join(", ")}
           WHERE id = ? AND source = 'MANUAL' AND status = 'POSTED' AND version = ?
           ${categoryCondition}
           ${amountCondition}
           RETURNING ${TRANSACTION_COLUMNS}`,
        )
        .bind(...bindings)
        .first<TransactionRow>();
      const updated = row ? asManualTransaction(toTransactionRecord(row)) : null;
      if (updated) return { kind: "UPDATED", transaction: updated };

      const latest = await this.findManual(update.id);
      if (!latest) return { kind: "NOT_FOUND" };
      if (latest.version !== update.version) {
        return { currentVersion: latest.version, kind: "VERSION_CONFLICT" };
      }
      if (latest.status !== "POSTED") return { kind: "NOT_FOUND" };
      if (update.categoryId && !(await this.hasActiveCategory(update.categoryId))) {
        return { kind: "CATEGORY_NOT_FOUND" };
      }
      if (
        (update.reimbursementMinor ?? latest.reimbursementMinor) >
        (update.amountMinor ?? latest.amountMinor)
      ) {
        throw new ManualTransactionPersistenceError("INVALID_INPUT");
      }
      throw new ManualTransactionPersistenceError("WRITE_FAILED");
    } catch (error) {
      if (error instanceof ManualTransactionPersistenceError) throw error;
      throw new ManualTransactionPersistenceError("WRITE_FAILED");
    }
  }

  async delete(input: unknown): Promise<ManualTransactionDeleteResult> {
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) throw new ManualTransactionPersistenceError("INVALID_INPUT");
    const deletion = parsed.data;

    try {
      const row = await this.database
        .prepare(
          `UPDATE transactions
           SET status = 'REMOVED', updated_at = ?, version = version + 1
           WHERE id = ? AND source = 'MANUAL' AND status = 'POSTED' AND version = ?
           RETURNING ${TRANSACTION_COLUMNS}`,
        )
        .bind(deletion.now, deletion.id, deletion.version)
        .first<TransactionRow>();
      const deleted = row ? asManualTransaction(toTransactionRecord(row)) : null;
      if (deleted) return { kind: "DELETED", transaction: deleted };

      const current = await this.findManual(deletion.id);
      if (!current) return { kind: "NOT_FOUND" };
      if (current.version !== deletion.version) {
        return { currentVersion: current.version, kind: "VERSION_CONFLICT" };
      }
      return { kind: "NOT_FOUND" };
    } catch (error) {
      if (error instanceof ManualTransactionPersistenceError) throw error;
      throw new ManualTransactionPersistenceError("WRITE_FAILED");
    }
  }
}
