import { normalizeMerchantName } from "@ledger/domain";
import * as z from "zod";

export interface CategoryRecord {
  active: boolean;
  createdAt: string;
  editable: boolean;
  id: string;
  kind: "INCOME" | "EXPENSE" | "TRANSFER" | "UNCLASSIFIED";
  name: string;
  systemKey: "TRANSFER" | "UNCLASSIFIED" | null;
  updatedAt: string;
  version: number;
}

interface CategoryRow {
  active: number;
  created_at: string;
  editable: number;
  id: string;
  kind: CategoryRecord["kind"];
  name: string;
  system_key: CategoryRecord["systemKey"];
  updated_at: string;
  version: number;
}

interface CategorySuggestionRow extends CategoryRow {
  merchant_match_count: number;
}

const categoryCreateSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine(
      (value) =>
        !/[<>]/u.test(value) &&
        ![...value].some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
        }),
    ),
  now: z.iso.datetime({ offset: true }),
});

function normalizeCategoryName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-CA");
}

function toCategoryRecord(row: CategoryRow): CategoryRecord {
  return {
    active: row.active === 1,
    createdAt: row.created_at,
    editable: row.editable === 1,
    id: row.id,
    kind: row.kind,
    name: row.name,
    systemKey: row.system_key,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export type CategoryCreateResult =
  | { category: CategoryRecord; kind: "CREATED" }
  | { category: CategoryRecord; kind: "NAME_CONFLICT" };

export type MerchantCategoryPreview = {
  category: CategoryRecord;
  kind: "KNOWN_MERCHANT" | "NEW_MERCHANT";
};

export interface CategoryRepositoryOptions {
  createId?: () => string;
}

const CATEGORY_COLUMNS = `
  id, name, kind, system_key, editable, active, created_at, updated_at, version
`;

export class CategoryRepository {
  private readonly createId: () => string;

  constructor(
    private readonly database: D1Database,
    options: CategoryRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? (() => `category-${crypto.randomUUID()}`);
  }

  async list(): Promise<CategoryRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT id, name, kind, system_key, editable, active,
                created_at, updated_at, version
         FROM categories
         ORDER BY kind ASC, name ASC, id ASC`,
      )
      .all<CategoryRow>();

    return result.results.map(toCategoryRecord);
  }

  async previewMerchant(input: {
    description: string;
    ignoreExactRule?: boolean;
    preferredCategoryId: string | null;
  }): Promise<MerchantCategoryPreview | null> {
    const normalizedMerchant = normalizeMerchantName(input.description);
    if (
      normalizedMerchant === null ||
      (input.preferredCategoryId !== null && !/^.{1,160}$/u.test(input.preferredCategoryId))
    ) {
      throw new TypeError("Invalid merchant preview query.");
    }

    if (input.ignoreExactRule !== true) {
      const exact = await this.database
        .prepare(
          `SELECT category.id, category.name, category.kind, category.system_key,
                  category.editable, category.active, category.created_at,
                  category.updated_at, category.version
           FROM merchant_rules AS merchant_rule
           JOIN categories AS category
             ON category.id = merchant_rule.category_id AND category.active = 1
           WHERE merchant_rule.normalized_merchant = ? AND merchant_rule.active = 1`,
        )
        .bind(normalizedMerchant)
        .first<CategoryRow>();
      if (exact) return { category: toCategoryRecord(exact), kind: "KNOWN_MERCHANT" };
    }

    const suggested = await this.database
      .prepare(
        `WITH ranked_categories AS (
           SELECT category.id, category.name, category.kind, category.system_key,
                  category.editable, category.active, category.created_at,
                  category.updated_at, category.version,
                  SUM(CASE
                    WHEN ledger_transaction.normalized_merchant = ?
                     AND ledger_transaction.categorization_source IN ('MANUAL', 'RULE')
                     AND ledger_transaction.status = 'POSTED'
                    THEN 1 ELSE 0 END) AS merchant_match_count,
                  COUNT(ledger_transaction.id) AS usage_count
           FROM categories AS category
           LEFT JOIN transactions AS ledger_transaction
             ON ledger_transaction.category_id = category.id
            AND ledger_transaction.status = 'POSTED'
           WHERE category.kind = 'EXPENSE'
             AND category.editable = 1
             AND category.active = 1
           GROUP BY category.id
         )
         SELECT ${CATEGORY_COLUMNS}, merchant_match_count
         FROM ranked_categories
         ORDER BY
           CASE
             WHEN ? IS NOT NULL AND id = ? THEN 0
             WHEN merchant_match_count > 0 THEN 1
             ELSE 2
           END,
           merchant_match_count DESC, usage_count DESC, name ASC, id ASC
         LIMIT 1`,
      )
      .bind(normalizedMerchant, input.preferredCategoryId, input.preferredCategoryId)
      .first<CategorySuggestionRow>();
    return suggested ? { category: toCategoryRecord(suggested), kind: "NEW_MERCHANT" } : null;
  }

  private async findByNormalizedName(normalizedName: string): Promise<CategoryRecord | null> {
    const row = await this.database
      .prepare(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE normalized_name = ?`)
      .bind(normalizedName)
      .first<CategoryRow>();
    return row ? toCategoryRecord(row) : null;
  }

  async createExpense(input: unknown): Promise<CategoryCreateResult> {
    const parsed = categoryCreateSchema.parse(input);
    const displayName = parsed.name.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const normalizedName = normalizeCategoryName(displayName);
    const existing = await this.findByNormalizedName(normalizedName);
    if (existing) return { category: existing, kind: "NAME_CONFLICT" };

    try {
      const row = await this.database
        .prepare(
          `INSERT INTO categories (
             id, name, normalized_name, kind, system_key, editable, active,
             created_at, updated_at, version
           ) VALUES (?, ?, ?, 'EXPENSE', NULL, 1, 1, ?, ?, 1)
           RETURNING ${CATEGORY_COLUMNS}`,
        )
        .bind(this.createId(), displayName, normalizedName, parsed.now, parsed.now)
        .first<CategoryRow>();
      if (!row) throw new Error("category insert returned no row");
      return { category: toCategoryRecord(row), kind: "CREATED" };
    } catch (error) {
      const raced = await this.findByNormalizedName(normalizedName);
      if (raced) return { category: raced, kind: "NAME_CONFLICT" };
      throw error;
    }
  }
}
