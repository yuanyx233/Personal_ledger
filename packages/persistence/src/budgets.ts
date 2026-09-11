import {
  budgetMonthSchema,
  budgetRecordSchema,
  budgetSettingSchema,
  type BudgetRecord,
} from "@ledger/domain";

const COLUMNS = `category_id AS categoryId, currency, effective_month AS effectiveMonth,
  amount_minor AS amountMinor, updated_at AS updatedAt`;

export class BudgetRepository {
  constructor(private readonly database: D1Database) {}

  async list(month: string): Promise<BudgetRecord[]> {
    budgetMonthSchema.parse(month);
    const { results } = await this.database
      .prepare(
        `
      SELECT ${COLUMNS} FROM category_budgets AS budget
      WHERE effective_month = (
        SELECT MAX(effective_month) FROM category_budgets
        WHERE category_id = budget.category_id AND currency = budget.currency AND effective_month <= ?
      ) ORDER BY currency, category_id
    `,
      )
      .bind(month)
      .all();
    return results.map((row) => budgetRecordSchema.parse(row));
  }

  async save(input: unknown, updatedAt: string): Promise<BudgetRecord | null> {
    const setting = budgetSettingSchema.parse(input);
    // INSERT ... SELECT keeps category validation and the write in one statement.
    // https://www.sqlite.org/lang_upsert.html
    const row = await this.database
      .prepare(
        `
      INSERT INTO category_budgets (category_id, currency, effective_month, amount_minor, updated_at)
      SELECT id, ?, ?, ?, ? FROM categories WHERE id = ? AND kind = 'EXPENSE' AND active = 1
      ON CONFLICT (category_id, currency, effective_month)
      DO UPDATE SET amount_minor = excluded.amount_minor, updated_at = excluded.updated_at
      RETURNING ${COLUMNS}
    `,
      )
      .bind(
        setting.currency,
        setting.effectiveMonth,
        setting.amountMinor,
        updatedAt,
        setting.categoryId,
      )
      .first();
    return row ? budgetRecordSchema.parse(row) : null;
  }
}
