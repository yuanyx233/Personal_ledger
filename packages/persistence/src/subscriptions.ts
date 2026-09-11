import {
  nextSubscriptionDate,
  normalizeMerchantName,
  subscriptionChargeSchema,
  subscriptionCreateSchema,
  subscriptionMutationSchema,
  subscriptionRecordSchema,
  torontoDate,
  type SubscriptionRecord,
} from "@ledger/domain";

const COLUMNS = `id, name, account_label AS accountLabel, amount_minor AS amountMinor,
  currency, category_id AS categoryId, cadence, anchor_day AS anchorDay,
  next_charge_date AS nextChargeDate, status, cancellation_effective_date AS cancellationEffectiveDate,
  last_error_code AS lastErrorCode, created_at AS createdAt, updated_at AS updatedAt, version`;
const GUARD = `id = ? AND version = ? AND status = 'ACTIVE' AND next_charge_date = ?
  AND (cancellation_effective_date IS NULL OR next_charge_date < cancellation_effective_date)`;

export class SubscriptionError extends Error {
  constructor(readonly code: "NOT_FOUND" | "VERSION_CONFLICT" | "VALIDATION_ERROR") {
    super(code);
  }
}

export class SubscriptionRepository {
  constructor(private readonly database: D1Database) {}

  async find(id: string): Promise<SubscriptionRecord | null> {
    const row = await this.database
      .prepare(`SELECT ${COLUMNS} FROM subscriptions WHERE id = ?`)
      .bind(id)
      .first();
    return row ? subscriptionRecordSchema.parse(row) : null;
  }

  async list() {
    const { results } = await this.database
      .prepare(
        `SELECT ${COLUMNS} FROM subscriptions
      ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END, next_charge_date, id LIMIT 501`,
      )
      .all();
    if (results.length > 500) throw new Error("Subscription list limit exceeded.");
    const subscriptions = results.map((row) => subscriptionRecordSchema.parse(row));
    const { results: charges } = await this.database
      .prepare(
        `
      SELECT occurrence.id, occurrence.subscription_id AS subscriptionId,
        occurrence.scheduled_date AS scheduledDate, occurrence.transaction_id AS transactionId,
        occurrence.status, ledger.amount_minor AS amountMinor, ledger.currency
      FROM subscription_occurrences AS occurrence
      JOIN transactions AS ledger ON ledger.id = occurrence.transaction_id
      WHERE occurrence.id IN (
        SELECT id FROM subscription_occurrences WHERE subscription_id = occurrence.subscription_id
        ORDER BY scheduled_date DESC, id DESC LIMIT 6
      ) ORDER BY occurrence.scheduled_date DESC, occurrence.id DESC LIMIT 3000
    `,
      )
      .all();
    return { subscriptions, charges: charges.map((row) => subscriptionChargeSchema.parse(row)) };
  }

  async create(input: unknown, now: string) {
    const value = subscriptionCreateSchema.parse(input);
    const id = `subscription-${value.requestId}`;
    const merchant = normalizeMerchantName(value.name);
    if (!merchant) throw new SubscriptionError("VALIDATION_ERROR");
    const existing = await this.find(id);
    if (existing) return existing;
    await this.database
      .prepare(
        `
      INSERT INTO subscriptions (id, name, merchant_name, normalized_merchant, account_label,
        amount_minor, currency, category_id, cadence, anchor_day, next_charge_date,
        status, created_at, updated_at, version)
      SELECT ?, ?, ?, ?, ?, ?, ?, id, 'MONTHLY', ?, ?, 'ACTIVE', ?, ?, 1
      FROM categories WHERE id = ? AND active = 1 AND kind = 'EXPENSE'
        AND (SELECT COUNT(*) FROM subscriptions) < 500
      ON CONFLICT(id) DO NOTHING
    `,
      )
      .bind(
        id,
        value.name,
        value.name,
        merchant,
        value.accountLabel,
        value.amountMinor,
        value.currency,
        Number(value.nextChargeDate.slice(8)),
        value.nextChargeDate,
        now,
        now,
        value.categoryId,
      )
      .run();
    const created = await this.find(id);
    if (!created) throw new SubscriptionError("VALIDATION_ERROR");
    return created;
  }

  async mutate(id: string, input: unknown, now: string) {
    const value = subscriptionMutationSchema.parse(input);
    const current = await this.find(id);
    if (!current) throw new SubscriptionError("NOT_FOUND");
    if (current.version !== value.version) throw new SubscriptionError("VERSION_CONFLICT");
    let removedCount = 0;
    let changed: unknown;
    if (value.action === "CANCEL") {
      // The delete and plan update share one atomic D1 batch. A stale request cannot delete charges.
      const results = await this.database.batch([
        this.database
          .prepare(
            `UPDATE transactions SET status = 'REMOVED', updated_at = ?, version = version + 1
          WHERE status = 'POSTED' AND id IN (
            SELECT transaction_id FROM subscription_occurrences WHERE subscription_id = ? AND scheduled_date >= ?
          ) AND EXISTS (SELECT 1 FROM subscriptions WHERE id = ? AND version = ?) RETURNING id`,
          )
          .bind(now, id, value.effectiveDate, id, value.version),
        this.database
          .prepare(
            `UPDATE subscriptions SET cancellation_effective_date = ?,
          status = CASE WHEN ? <= ? AND next_charge_date >= ? THEN 'CANCELLED' ELSE 'ACTIVE' END,
          last_error_code = NULL, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? RETURNING id`,
          )
          .bind(
            value.effectiveDate,
            value.effectiveDate,
            torontoDate(new Date(now)),
            value.effectiveDate,
            now,
            id,
            value.version,
          ),
      ]);
      removedCount = results[0]!.results.length;
      changed = results[1]!.results[0];
    } else if (value.action === "RESUME") {
      if (current.status === "ACTIVE" && current.cancellationEffectiveDate === null)
        throw new SubscriptionError("VALIDATION_ERROR");
      changed = await this.database
        .prepare(
          `UPDATE subscriptions SET status = 'ACTIVE',
        next_charge_date = ?, anchor_day = ?, cancellation_effective_date = NULL,
        last_error_code = NULL, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? RETURNING id`,
        )
        .bind(value.nextChargeDate, Number(value.nextChargeDate.slice(8)), now, id, value.version)
        .first();
    } else {
      const merchant = normalizeMerchantName(value.name);
      // Editing does not rewind already processed dates or turn a cancellation into a resumption.
      if (!merchant || value.nextChargeDate < current.nextChargeDate)
        throw new SubscriptionError("VALIDATION_ERROR");
      changed = await this.database
        .prepare(
          `UPDATE subscriptions SET name = ?, merchant_name = ?, normalized_merchant = ?,
        account_label = ?, amount_minor = ?, currency = ?, category_id = ?,
        next_charge_date = ?, anchor_day = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM categories WHERE id = ? AND active = 1 AND kind = 'EXPENSE')
        RETURNING id`,
        )
        .bind(
          value.name,
          value.name,
          merchant,
          value.accountLabel,
          value.amountMinor,
          value.currency,
          value.categoryId,
          value.nextChargeDate,
          value.nextChargeDate === current.nextChargeDate
            ? current.anchorDay
            : Number(value.nextChargeDate.slice(8)),
          now,
          id,
          value.version,
          value.categoryId,
        )
        .first();
    }
    if (!changed) {
      const latest = await this.find(id);
      throw new SubscriptionError(
        latest?.version !== value.version ? "VERSION_CONFLICT" : "VALIDATION_ERROR",
      );
    }
    return { subscription: (await this.find(id))!, removedCount };
  }

  async generateOne(plan: SubscriptionRecord, now: string): Promise<boolean> {
    const date = plan.nextChargeDate;
    if (
      plan.status !== "ACTIVE" ||
      date > torontoDate(new Date(now)) ||
      (plan.cancellationEffectiveDate !== null && date >= plan.cancellationEffectiveDate)
    )
      return false;
    const transactionId = `transaction-${crypto.randomUUID()}`;
    const next = nextSubscriptionDate(date, plan.anchorDay, plan.cadence);
    const guard = [plan.id, plan.version, date];
    // Every write is guarded until the final cursor advance. D1 rolls back the complete batch on failure.
    const results = await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO transactions (id, source, account_label, status, posted_date,
        amount_minor, direction, currency, raw_description, merchant_name, normalized_merchant,
        category_id, categorization_source, needs_review, created_at, updated_at, version)
        SELECT ?, 'MANUAL', account_label, 'POSTED', next_charge_date, amount_minor, 'OUTFLOW', currency,
          name, merchant_name, normalized_merchant, category_id, 'MANUAL', 0, ?, ?, 1
        FROM subscriptions WHERE ${GUARD}
          AND NOT EXISTS (SELECT 1 FROM subscription_occurrences WHERE subscription_id = ? AND scheduled_date = ?)`,
        )
        .bind(transactionId, now, now, ...guard, plan.id, date),
      this.database
        .prepare(
          `UPDATE transactions SET status = 'POSTED', amount_minor = ?, reimbursement_minor = 0,
        account_label = ?, currency = ?, category_id = ?, raw_description = ?, merchant_name = ?,
        normalized_merchant = ?, posted_date = ?, direction = 'OUTFLOW', categorization_source = 'MANUAL',
        category_rule_id = NULL, needs_review = 0, review_reason = NULL, updated_at = ?, version = version + 1
        WHERE status = 'REMOVED' AND id = (
          SELECT transaction_id FROM subscription_occurrences WHERE subscription_id = ? AND scheduled_date = ? AND status = 'NOT_CHARGED'
        ) AND EXISTS (SELECT 1 FROM subscriptions WHERE ${GUARD})`,
        )
        .bind(
          plan.amountMinor,
          plan.accountLabel,
          plan.currency,
          plan.categoryId,
          plan.name,
          plan.name,
          normalizeMerchantName(plan.name),
          date,
          now,
          plan.id,
          date,
          ...guard,
        ),
      this.database
        .prepare(
          `INSERT INTO subscription_occurrences (id, subscription_id, scheduled_date,
        transaction_id, status, created_at, updated_at, version)
        SELECT ?, id, next_charge_date, COALESCE((SELECT transaction_id FROM subscription_occurrences
          WHERE subscription_id = ? AND scheduled_date = ?), ?), 'GENERATED', ?, ?, 1
        FROM subscriptions WHERE ${GUARD}
        ON CONFLICT(subscription_id, scheduled_date) DO UPDATE SET status = 'GENERATED',
          owner_decision_at = NULL, updated_at = excluded.updated_at, version = subscription_occurrences.version + 1
        WHERE subscription_occurrences.status = 'NOT_CHARGED'`,
        )
        .bind(
          `subscription-occurrence-${crypto.randomUUID()}`,
          plan.id,
          date,
          transactionId,
          now,
          now,
          ...guard,
        ),
      this.database
        .prepare(
          `UPDATE subscriptions SET next_charge_date = ?, updated_at = ?, version = version + 1,
        last_error_code = NULL WHERE ${GUARD} RETURNING id`,
        )
        .bind(next, now, ...guard),
    ]);
    return results[3]!.results.length === 1;
  }

  async generateDue(now: string, onlyId?: string): Promise<number> {
    const today = torontoDate(new Date(now));
    const { results } = await this.database
      .prepare(
        `SELECT ${COLUMNS} FROM subscriptions
      WHERE status = 'ACTIVE' AND next_charge_date <= ? ${onlyId ? "AND id = ?" : ""}
      ORDER BY next_charge_date, id LIMIT 100`,
      )
      .bind(today, ...(onlyId ? [onlyId] : []))
      .all();
    let generated = 0;
    let attempts = 0;
    for (const row of results) {
      let plan: SubscriptionRecord | null = subscriptionRecordSchema.parse(row);
      for (let count = 0; plan && count < 8 && attempts < 8; count++) {
        if (
          plan.nextChargeDate > today ||
          (plan.cancellationEffectiveDate !== null &&
            plan.nextChargeDate >= plan.cancellationEffectiveDate)
        )
          break;
        attempts++;
        if (!(await this.generateOne(plan, now))) break;
        generated++;
        plan = await this.find(plan.id);
      }
      if (attempts >= 8) break;
    }
    // Pending pre-cancellation dates remain eligible for catch-up; only completed plans close.
    await this.database
      .prepare(
        `UPDATE subscriptions SET status = 'CANCELLED', updated_at = ?, version = version + 1
      WHERE status = 'ACTIVE' AND cancellation_effective_date <= ? AND next_charge_date >= cancellation_effective_date
      ${onlyId ? "AND id = ?" : ""}`,
      )
      .bind(now, today, ...(onlyId ? [onlyId] : []))
      .run();
    return generated;
  }
}
