import { describe, expect, it } from "vitest";

import {
  TransactionCategoryOverridePersistenceError,
  TransactionCategoryOverrideRepository,
} from "./category-overrides";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function recordingDatabase({
  firstError,
  firstResults = [],
}: {
  firstError?: Error;
  firstResults?: unknown[];
} = {}) {
  const queries: RecordedQuery[] = [];
  const queuedFirstResults = [...firstResults];
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
      };
      return statement;
    },
  } as unknown as D1Database;
  return { database, queries };
}

const NOW = "2026-07-15T13:00:00.000Z";
const TRANSACTION_ROW = {
  account_id: "account-1",
  account_label: null,
  amount_minor: 1234,
  authorized_date: "2026-07-14",
  categorization_source: "RULE",
  category_id: "category-shopping",
  category_rule_id: "rule-market",
  created_at: "2026-07-15T12:00:00.000Z",
  currency: "CAD",
  direction: "OUTFLOW",
  id: "transaction-plaid-1",
  merchant_name: "Neighbourhood Market",
  needs_review: 1,
  normalized_merchant: "neighbourhood market",
  payment_metadata_json: null,
  pending_transaction_id: null,
  plaid_pfc_confidence: "HIGH",
  plaid_pfc_detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  plaid_pfc_primary: "GENERAL_MERCHANDISE",
  plaid_transaction_id: "plaid-1",
  posted_date: "2026-07-15",
  raw_description: "Neighbourhood market",
  review_reason: "RULE_CONFLICT",
  source: "PLAID",
  status: "POSTED",
  updated_at: "2026-07-15T12:00:00.000Z",
  version: 1,
};

const INPUT = {
  categoryId: "category-food",
  id: "transaction-plaid-1",
  now: NOW,
  version: 1,
} as const;

describe("TransactionCategoryOverrideRepository", () => {
  it("writes one guarded manual override and returns the canonical transaction", async () => {
    const updatedRow = {
      ...TRANSACTION_ROW,
      categorization_source: "MANUAL",
      category_id: "category-food",
      category_rule_id: null,
      needs_review: 0,
      review_reason: null,
      updated_at: NOW,
      version: 2,
    };
    const recording = recordingDatabase({ firstResults: [updatedRow] });

    await expect(
      new TransactionCategoryOverrideRepository(recording.database).override(INPUT),
    ).resolves.toMatchObject({
      kind: "UPDATED",
      transaction: {
        categorizationSource: "MANUAL",
        categoryId: "category-food",
        categoryRuleId: null,
        needsReview: false,
        reviewReason: null,
        source: "PLAID",
        version: 2,
      },
    });
    expect(recording.queries).toHaveLength(1);
    expect(recording.queries[0]!.sql).toContain("categorization_source = 'MANUAL'");
    expect(recording.queries[0]!.sql).toContain("category_rule_id = NULL");
    expect(recording.queries[0]!.sql).toContain("editable = 1");
    expect(recording.queries[0]!.sql).toContain("active = 1");
    expect(recording.queries[0]!.sql).toContain("version = ?");
    expect(recording.queries[0]!.sql).toContain("RETURNING");
    expect(recording.queries[0]!.sql).not.toContain("category-food");
    expect(recording.queries[0]!.bindings).toContain("category-food");
  });

  it("distinguishes missing, stale, invalid-category, removed, and unchanged writes", async () => {
    const missing = recordingDatabase({ firstResults: [null, null] });
    await expect(
      new TransactionCategoryOverrideRepository(missing.database).override(INPUT),
    ).resolves.toEqual({ kind: "NOT_FOUND" });

    const stale = recordingDatabase({ firstResults: [null, { ...TRANSACTION_ROW, version: 3 }] });
    await expect(
      new TransactionCategoryOverrideRepository(stale.database).override(INPUT),
    ).resolves.toEqual({ currentVersion: 3, kind: "VERSION_CONFLICT" });

    const invalidCategory = recordingDatabase({
      firstResults: [null, TRANSACTION_ROW, null],
    });
    await expect(
      new TransactionCategoryOverrideRepository(invalidCategory.database).override(INPUT),
    ).resolves.toEqual({ kind: "CATEGORY_NOT_FOUND" });
    expect(invalidCategory.queries[2]!.sql).toContain("editable = 1");

    const removed = recordingDatabase({
      firstResults: [null, { ...TRANSACTION_ROW, status: "REMOVED" }],
    });
    await expect(
      new TransactionCategoryOverrideRepository(removed.database).override(INPUT),
    ).resolves.toEqual({ kind: "NOT_FOUND" });

    const unchangedRow = {
      ...TRANSACTION_ROW,
      categorization_source: "MANUAL",
      category_id: "category-food",
      category_rule_id: null,
      needs_review: 0,
      review_reason: null,
    };
    const unchanged = recordingDatabase({
      firstResults: [null, unchangedRow, "category-food"],
    });
    await expect(
      new TransactionCategoryOverrideRepository(unchanged.database).override(INPUT),
    ).resolves.toMatchObject({ kind: "NO_CHANGE", transaction: { version: 1 } });
  });

  it("rejects invalid internal input and sanitizes database failures", async () => {
    const invalid = recordingDatabase();
    await expect(
      new TransactionCategoryOverrideRepository(invalid.database).override({
        ...INPUT,
        version: 0,
      }),
    ).rejects.toEqual(new TransactionCategoryOverridePersistenceError("INVALID_INPUT"));
    expect(invalid.queries).toHaveLength(0);

    const failing = recordingDatabase({ firstError: new Error("private database detail") });
    const operation = new TransactionCategoryOverrideRepository(failing.database).override(INPUT);
    await expect(operation).rejects.toEqual(
      new TransactionCategoryOverridePersistenceError("WRITE_FAILED"),
    );
    await expect(operation).rejects.not.toThrow(/private database detail/);
  });
});
