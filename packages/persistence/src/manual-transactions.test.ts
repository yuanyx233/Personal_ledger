import { describe, expect, it } from "vitest";

import {
  ManualTransactionPersistenceError,
  ManualTransactionRepository,
} from "./manual-transactions";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function recordingDatabase({
  firstError,
  firstResults = [],
  runChanges = [],
  runError,
}: {
  firstError?: Error;
  firstResults?: unknown[];
  runChanges?: number[];
  runError?: Error;
} = {}) {
  const queries: RecordedQuery[] = [];
  const queuedFirstResults = [...firstResults];
  const queuedRunChanges = [...runChanges];
  const database = {
    prepare(sql: string) {
      const query: RecordedQuery = { bindings: [], sql };
      queries.push(query);
      const statement = {
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return statement;
        },
        first() {
          if (firstError) return Promise.reject(firstError);
          return Promise.resolve(queuedFirstResults.shift() ?? null);
        },
        run() {
          if (runError) return Promise.reject(runError);
          return Promise.resolve({ meta: { changes: queuedRunChanges.shift() ?? 1 } });
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { database, queries };
}

const NOW = "2026-07-15T12:00:00.000Z";
const MANUAL_ROW = {
  account_id: null,
  account_label: "Cash wallet",
  amount_minor: 1234,
  authorized_date: null,
  categorization_source: "MANUAL",
  category_id: "category-expense",
  category_rule_id: null,
  created_at: NOW,
  currency: "CAD",
  direction: "OUTFLOW",
  id: "transaction-manual-1",
  merchant_name: "Neighbourhood market",
  needs_review: 0,
  normalized_merchant: "neighbourhood market",
  payment_metadata_json: null,
  pending_transaction_id: null,
  plaid_transaction_id: null,
  plaid_pfc_confidence: null,
  plaid_pfc_detailed: null,
  plaid_pfc_primary: null,
  posted_date: "2026-07-15",
  raw_description: "Neighbourhood market",
  review_reason: null,
  source: "MANUAL",
  status: "POSTED",
  updated_at: NOW,
  version: 1,
};

const CREATE_INPUT = {
  accountLabel: "Cash wallet",
  amountMinor: 1234,
  categoryId: "category-expense",
  currency: "CAD",
  description: "Neighbourhood market",
  direction: "OUTFLOW",
  now: NOW,
  postedDate: "2026-07-15",
} as const;

describe("ManualTransactionRepository", () => {
  it("atomically creates a confirmed transaction and its exact merchant rule", async () => {
    const queries: RecordedQuery[] = [];
    let batchCalls = 0;
    const confirmedRow = {
      ...MANUAL_ROW,
      categorization_source: "RULE",
      category_id: "category-expense-shopping",
      category_rule_id: "merchant-rule-ikea",
      merchant_name: "IKEA",
      normalized_merchant: "ikea",
      raw_description: "IKEA",
    };
    const database = {
      prepare(sql: string) {
        const query: RecordedQuery = { bindings: [], sql };
        queries.push(query);
        const statement = {
          bind(...bindings: unknown[]) {
            query.bindings = bindings;
            return statement;
          },
        };
        return statement;
      },
      batch() {
        batchCalls += 1;
        return Promise.resolve([
          { results: [{ id: "merchant-rule-ikea" }] },
          { results: [confirmedRow] },
        ]);
      },
    } as unknown as D1Database;

    await expect(
      new ManualTransactionRepository(database, {
        createId: () => "transaction-manual-1",
        createRuleId: () => "merchant-rule-ikea",
      }).create({
        ...CREATE_INPUT,
        categoryId: "category-expense-shopping",
        description: "IKEA",
        rememberMerchant: true,
      }),
    ).resolves.toMatchObject({
      kind: "CREATED",
      transaction: {
        categorizationSource: "RULE",
        categoryId: "category-expense-shopping",
        categoryRuleId: "merchant-rule-ikea",
        normalizedMerchant: "ikea",
      },
    });
    expect(batchCalls).toBe(1);
    expect(queries).toHaveLength(2);
    expect(queries[0]!.sql).toContain("merchant_rules");
    expect(queries[0]!.sql).toContain("ON CONFLICT(normalized_merchant)");
    expect(queries[1]!.sql).toContain("INSERT INTO transactions");
    expect(queries[1]!.sql).toContain("'RULE'");
  });

  it("binds an exact manual create and returns the canonical record", async () => {
    const recording = recordingDatabase({ firstResults: [MANUAL_ROW] });
    const repository = new ManualTransactionRepository(recording.database, {
      createId: () => "transaction-manual-1",
    });

    await expect(repository.create(CREATE_INPUT)).resolves.toEqual({
      kind: "CREATED",
      transaction: {
        accountId: null,
        accountLabel: "Cash wallet",
        amountMinor: 1234,
        reimbursementMinor: 0,
        authorizedDate: null,
        categorizationSource: "MANUAL",
        categoryId: "category-expense",
        categoryRuleId: null,
        createdAt: NOW,
        currency: "CAD",
        direction: "OUTFLOW",
        id: "transaction-manual-1",
        merchantName: "Neighbourhood market",
        needsReview: false,
        normalizedMerchant: "neighbourhood market",
        paymentMetadata: {
          payee: null,
          payer: null,
          paymentMethod: null,
          referenceNumber: null,
        },
        pendingTransactionId: null,
        plaidPersonalFinanceCategory: null,
        plaidTransactionId: null,
        postedDate: "2026-07-15",
        rawDescription: "Neighbourhood market",
        reviewReason: null,
        source: "MANUAL",
        status: "POSTED",
        updatedAt: NOW,
        version: 1,
      },
    });
    expect(recording.queries).toHaveLength(1);
    expect(recording.queries[0]!.sql).toContain("'MANUAL'");
    expect(recording.queries[0]!.sql).toContain("FROM categories");
    expect(recording.queries[0]!.sql).toContain("active = 1");
    expect(recording.queries[0]!.sql).toContain("RETURNING");
    expect(recording.queries[0]!.sql).not.toContain("Neighbourhood market");
    expect(recording.queries[0]!.bindings).toContain("Neighbourhood market");
  });

  it("creates an uncategorized quick transaction once and derives a rule-ready merchant", async () => {
    const unclassifiedRow = {
      ...MANUAL_ROW,
      categorization_source: "UNCLASSIFIED",
      category_id: "category-system-unclassified",
      category_rule_id: null,
      merchant_name: "Neighbourhood   Market",
      needs_review: 1,
      raw_description: "  Neighbourhood   Market  ",
      review_reason: "UNCLASSIFIED_MERCHANT",
    };
    const recording = recordingDatabase({ firstResults: [unclassifiedRow] });

    await expect(
      new ManualTransactionRepository(recording.database, {
        createId: () => "transaction-manual-1",
      }).create({
        accountLabel: "RBC Credit",
        amountMinor: 1234,
        currency: "CAD",
        description: "  Neighbourhood   Market  ",
        direction: "OUTFLOW",
        now: NOW,
        postedDate: "2026-07-15",
      }),
    ).resolves.toMatchObject({
      kind: "CREATED",
      transaction: {
        categorizationSource: "UNCLASSIFIED",
        categoryId: "category-system-unclassified",
        merchantName: "Neighbourhood   Market",
        needsReview: true,
        normalizedMerchant: "neighbourhood market",
      },
    });
    expect(recording.queries).toHaveLength(1);
    expect(recording.queries[0]!.sql).toContain("merchant_rules");
    expect(recording.queries[0]!.sql).toContain("UNCLASSIFIED_MERCHANT");
    expect(recording.queries[0]!.bindings).not.toContain(undefined);
  });

  it("returns a category error before writing an inactive or missing category", async () => {
    const recording = recordingDatabase({ firstResults: [null] });

    await expect(
      new ManualTransactionRepository(recording.database).create(CREATE_INPUT),
    ).resolves.toEqual({ kind: "CATEGORY_NOT_FOUND" });
    expect(recording.queries).toHaveLength(1);
  });

  it("generates a bounded canonical id by default", async () => {
    const recording = recordingDatabase({ firstResults: [MANUAL_ROW] });

    await expect(
      new ManualTransactionRepository(recording.database).create(CREATE_INPUT),
    ).resolves.toMatchObject({ kind: "CREATED" });
    expect(
      recording.queries[0]!.bindings.find(
        (binding): binding is string =>
          typeof binding === "string" && binding.startsWith("transaction-"),
      ),
    ).toMatch(/^transaction-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("builds partial updates from allowlisted columns and reports stale versions", async () => {
    const updatedRow = {
      ...MANUAL_ROW,
      amount_minor: 1,
      raw_description: "Corrected",
      updated_at: "2026-07-15T13:00:00.000Z",
      version: 2,
    };
    const updated = recordingDatabase({ firstResults: [updatedRow] });

    await expect(
      new ManualTransactionRepository(updated.database).update({
        amountMinor: 1,
        description: "Corrected",
        id: "transaction-manual-1",
        now: "2026-07-15T13:00:00.000Z",
        version: 1,
      }),
    ).resolves.toMatchObject({ kind: "UPDATED", transaction: { amountMinor: 1, version: 2 } });
    expect(updated.queries[0]!.sql).toContain("amount_minor = ?");
    expect(updated.queries[0]!.sql).toContain("raw_description = ?");
    expect(updated.queries[0]!.sql).toContain("RETURNING");
    expect(updated.queries[0]!.sql).not.toContain("Corrected");
    expect(updated.queries[0]!.bindings).toEqual([
      1,
      "Corrected",
      "2026-07-15T13:00:00.000Z",
      "transaction-manual-1",
      1,
      null,
      1,
    ]);

    const stale = recordingDatabase({
      firstResults: [null, { ...MANUAL_ROW, version: 3 }],
    });
    await expect(
      new ManualTransactionRepository(stale.database).update({
        description: "Stale",
        id: "transaction-manual-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ currentVersion: 3, kind: "VERSION_CONFLICT" });

    const missingCategory = recordingDatabase({
      firstResults: [null, MANUAL_ROW, null],
    });
    await expect(
      new ManualTransactionRepository(missingCategory.database).update({
        categoryId: "category-missing",
        id: "transaction-manual-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ kind: "CATEGORY_NOT_FOUND" });
    expect(missingCategory.queries[0]!.sql).toContain("active = 1");
  });

  it("soft-deletes manual records while refusing a non-manual identity", async () => {
    const deleted = recordingDatabase({
      firstResults: [{ ...MANUAL_ROW, status: "REMOVED", version: 2 }],
    });
    await expect(
      new ManualTransactionRepository(deleted.database).delete({
        id: "transaction-manual-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toMatchObject({ kind: "DELETED", transaction: { status: "REMOVED", version: 2 } });

    const plaid = recordingDatabase({
      firstResults: [null, { ...MANUAL_ROW, source: "PLAID", plaid_transaction_id: "plaid-1" }],
    });
    await expect(
      new ManualTransactionRepository(plaid.database).delete({
        id: "transaction-manual-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ kind: "NOT_FOUND" });

    const stale = recordingDatabase({
      firstResults: [null, { ...MANUAL_ROW, version: 3 }],
    });
    await expect(
      new ManualTransactionRepository(stale.database).delete({
        id: "transaction-manual-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ currentVersion: 3, kind: "VERSION_CONFLICT" });

    const deletedElsewhere = recordingDatabase({
      firstResults: [null, { ...MANUAL_ROW, status: "REMOVED", version: 2 }],
    });
    await expect(
      new ManualTransactionRepository(deletedElsewhere.database).update({
        description: "Stale after delete",
        id: "transaction-manual-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ currentVersion: 2, kind: "VERSION_CONFLICT" });
  });

  it("rejects invalid internal inputs before any query", async () => {
    for (const operation of [
      (repository: ManualTransactionRepository) =>
        repository.create({ ...CREATE_INPUT, amountMinor: 12.34 }),
      (repository: ManualTransactionRepository) =>
        repository.update({ id: "transaction-manual-1", now: NOW, version: 1 }),
      (repository: ManualTransactionRepository) =>
        repository.delete({ id: "transaction-manual-1", now: NOW, version: 0 }),
    ]) {
      const recording = recordingDatabase();
      await expect(operation(new ManualTransactionRepository(recording.database))).rejects.toEqual(
        new ManualTransactionPersistenceError("INVALID_INPUT"),
      );
      expect(recording.queries).toHaveLength(0);
    }
  });

  it("sanitizes database failures", async () => {
    const recording = recordingDatabase({ firstError: new Error("private database detail") });

    const operation = new ManualTransactionRepository(recording.database).create(CREATE_INPUT);

    await expect(operation).rejects.toEqual(new ManualTransactionPersistenceError("WRITE_FAILED"));
    await expect(operation).rejects.not.toThrow(/private database detail/);
  });
});
