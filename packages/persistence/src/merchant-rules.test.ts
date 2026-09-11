import { describe, expect, it } from "vitest";

import {
  MerchantRuleCorrectionPersistenceError,
  MerchantRuleCorrectionRepository,
  MerchantRuleManagementPersistenceError,
  MerchantRuleManagementRepository,
} from "./merchant-rules";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function recordingDatabase({
  batchError,
  batchResults = [],
  firstResults = [],
  allResults = [],
}: {
  allResults?: Array<Error | unknown[]>;
  batchError?: Error;
  batchResults?: unknown[];
  firstResults?: unknown[];
} = {}) {
  const queries: RecordedQuery[] = [];
  const queuedFirstResults = [...firstResults];
  const queuedAllResults = [...allResults];
  let batchCalls = 0;
  const database = {
    batch() {
      batchCalls += 1;
      if (batchError) return Promise.reject(batchError);
      return Promise.resolve(batchResults);
    },
    prepare(sql: string) {
      const query: RecordedQuery = { bindings: [], sql };
      queries.push(query);
      const statement = {
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return statement;
        },
        all() {
          const outcome = queuedAllResults.shift() ?? [];
          return outcome instanceof Error
            ? Promise.reject(outcome)
            : Promise.resolve({ results: outcome });
        },
        first() {
          const outcome = queuedFirstResults.shift() ?? null;
          return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { batchCalls: () => batchCalls, database, queries };
}

const NOW = "2026-07-15T13:00:00.000Z";
const TRANSACTION_ROW = {
  account_id: "account-1",
  account_label: null,
  amount_minor: 1234,
  authorized_date: "2026-07-14",
  categorization_source: "PLAID",
  category_id: "category-shopping",
  category_rule_id: null,
  created_at: "2026-07-15T12:00:00.000Z",
  currency: "CAD",
  direction: "OUTFLOW",
  id: "transaction-plaid-1",
  merchant_name: "Neighbourhood Market Store 42",
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
const RULE_ROW = {
  active: 1,
  category_id: "category-food",
  created_at: NOW,
  display_merchant: "Neighbourhood Market Store 42",
  id: "merchant-rule-1",
  normalized_merchant: "neighbourhood market",
  updated_at: NOW,
  version: 1,
};
const UPDATED_TRANSACTION_ROW = {
  ...TRANSACTION_ROW,
  categorization_source: "RULE",
  category_id: "category-food",
  category_rule_id: "merchant-rule-1",
  needs_review: 0,
  review_reason: null,
  updated_at: NOW,
  version: 2,
};
const INPUT = {
  categoryId: "category-food",
  id: "transaction-plaid-1",
  now: NOW,
  version: 1,
} as const;
const EXPANDING_MERCHANT = "\uFDFA".repeat(20);

describe("MerchantRuleCorrectionRepository", () => {
  it("creates one exact rule and updates only the selected transaction in one batch", async () => {
    const recording = recordingDatabase({
      batchResults: [{ results: [RULE_ROW] }, { results: [UPDATED_TRANSACTION_ROW] }],
      firstResults: [TRANSACTION_ROW, "category-food", null],
    });
    const repository = new MerchantRuleCorrectionRepository(recording.database, {
      createId: () => "merchant-rule-1",
    });

    await expect(repository.saveForFuture(INPUT)).resolves.toMatchObject({
      kind: "UPDATED",
      merchantRule: {
        active: true,
        categoryId: "category-food",
        normalizedMerchant: "neighbourhood market",
        version: 1,
      },
      transaction: {
        categorizationSource: "RULE",
        categoryId: "category-food",
        categoryRuleId: "merchant-rule-1",
        version: 2,
      },
    });
    expect(recording.batchCalls()).toBe(1);
    const insertRule = recording.queries.find(({ sql }) =>
      sql.includes("INSERT INTO merchant_rules"),
    );
    const updateTransaction = recording.queries.find(({ sql }) =>
      sql.includes("UPDATE transactions"),
    );
    expect(insertRule?.bindings).toContain("neighbourhood market");
    expect(insertRule?.bindings).toContain("Neighbourhood Market Store 42");
    expect(updateTransaction?.sql).toContain("WHERE id = ?");
    expect(updateTransaction?.sql).not.toContain("UPDATE transactions SET category_id");
    expect(updateTransaction?.bindings.at(-1)).toBe("transaction-plaid-1");
  });

  it("reactivates and versions an existing exact rule", async () => {
    const oldRule = { ...RULE_ROW, active: 0, category_id: "category-shopping", version: 4 };
    const updatedRule = { ...RULE_ROW, version: 5 };
    const recording = recordingDatabase({
      batchResults: [{ results: [updatedRule] }, { results: [UPDATED_TRANSACTION_ROW] }],
      firstResults: [TRANSACTION_ROW, "category-food", oldRule],
    });

    await expect(
      new MerchantRuleCorrectionRepository(recording.database).saveForFuture(INPUT),
    ).resolves.toMatchObject({
      kind: "UPDATED",
      merchantRule: { active: true, categoryId: "category-food", version: 5 },
    });
    const updateRule = recording.queries.find(({ sql }) => sql.includes("UPDATE merchant_rules"));
    expect(updateRule?.sql).toContain("version = CASE");
    expect(updateRule?.bindings).toContain(4);
  });

  it("does not rewrite an unchanged rule or transaction", async () => {
    const currentRule = { ...RULE_ROW, version: 3 };
    const currentTransaction = {
      ...UPDATED_TRANSACTION_ROW,
      category_rule_id: currentRule.id,
      version: 7,
    };
    const recording = recordingDatabase({
      firstResults: [currentTransaction, "category-food", currentRule],
    });

    await expect(
      new MerchantRuleCorrectionRepository(recording.database).saveForFuture({
        ...INPUT,
        version: 7,
      }),
    ).resolves.toMatchObject({
      kind: "NO_CHANGE",
      merchantRule: { version: 3 },
      transaction: { version: 7 },
    });
    expect(recording.batchCalls()).toBe(0);
  });

  it("reuses an unchanged exact rule while correcting only the selected transaction", async () => {
    const correctedTransaction = {
      ...UPDATED_TRANSACTION_ROW,
      category_rule_id: RULE_ROW.id,
    };
    const recording = recordingDatabase({
      batchResults: [{ results: [correctedTransaction] }],
      firstResults: [TRANSACTION_ROW, "category-food", RULE_ROW],
    });

    await expect(
      new MerchantRuleCorrectionRepository(recording.database).saveForFuture(INPUT),
    ).resolves.toMatchObject({
      kind: "UPDATED",
      merchantRule: { id: "merchant-rule-1", version: 1 },
      transaction: { categoryRuleId: "merchant-rule-1", version: 2 },
    });
    expect(recording.batchCalls()).toBe(1);
    expect(
      recording.queries.some(({ sql }) => /(?:INSERT INTO|UPDATE) merchant_rules/u.test(sql)),
    ).toBe(false);
  });

  it("rejects missing, stale, merchantless, and invalid-category targets before writing", async () => {
    const cases = [
      { expected: { kind: "NOT_FOUND" }, firstResults: [null] },
      {
        expected: { currentVersion: 3, kind: "VERSION_CONFLICT", resource: "TRANSACTION" },
        firstResults: [{ ...TRANSACTION_ROW, version: 3 }],
      },
      {
        expected: { kind: "MERCHANT_NOT_AVAILABLE" },
        firstResults: [{ ...TRANSACTION_ROW, normalized_merchant: null }],
      },
      {
        expected: { kind: "CATEGORY_NOT_FOUND" },
        firstResults: [TRANSACTION_ROW, null],
      },
    ];
    for (const testCase of cases) {
      const recording = recordingDatabase({ firstResults: testCase.firstResults });
      await expect(
        new MerchantRuleCorrectionRepository(recording.database).saveForFuture(INPUT),
      ).resolves.toEqual(testCase.expected);
      expect(recording.batchCalls()).toBe(0);
    }
  });

  it("rejects invalid input and sanitizes unexplained database failures", async () => {
    const invalid = recordingDatabase();
    await expect(
      new MerchantRuleCorrectionRepository(invalid.database).saveForFuture({
        ...INPUT,
        version: 0,
      }),
    ).rejects.toEqual(new MerchantRuleCorrectionPersistenceError("INVALID_INPUT"));

    const failing = recordingDatabase({
      batchError: new Error("private database detail"),
      firstResults: [
        TRANSACTION_ROW,
        "category-food",
        null,
        TRANSACTION_ROW,
        "category-food",
        null,
      ],
    });
    const operation = new MerchantRuleCorrectionRepository(failing.database, {
      createId: () => "merchant-rule-1",
    }).saveForFuture(INPUT);
    await expect(operation).rejects.toEqual(
      new MerchantRuleCorrectionPersistenceError("WRITE_FAILED"),
    );
    await expect(operation).rejects.not.toThrow(/private database detail/);
  });

  it("reports the current rule version when the atomic batch loses a rule race", async () => {
    const expectedRule = { ...RULE_ROW, active: 0, category_id: "category-shopping", version: 4 };
    const competingRule = { ...expectedRule, active: 1, version: 5 };
    const recording = recordingDatabase({
      batchError: new Error("version guard rejected the batch"),
      firstResults: [
        TRANSACTION_ROW,
        "category-food",
        expectedRule,
        TRANSACTION_ROW,
        "category-food",
        competingRule,
      ],
    });

    await expect(
      new MerchantRuleCorrectionRepository(recording.database).saveForFuture(INPUT),
    ).resolves.toEqual({
      currentVersion: 5,
      kind: "VERSION_CONFLICT",
      resource: "MERCHANT_RULE",
    });
  });

  it("diagnoses a transaction race when an atomic batch returns no transaction", async () => {
    const recording = recordingDatabase({
      batchResults: [{ results: [RULE_ROW] }, { results: [] }],
      firstResults: [TRANSACTION_ROW, "category-food", null, { ...TRANSACTION_ROW, version: 2 }],
    });

    await expect(
      new MerchantRuleCorrectionRepository(recording.database, {
        createId: () => "merchant-rule-1",
      }).saveForFuture(INPUT),
    ).resolves.toEqual({
      currentVersion: 2,
      kind: "VERSION_CONFLICT",
      resource: "TRANSACTION",
    });
  });

  it("sanitizes correction read failures and incomplete unexplained batch results", async () => {
    const readFailure = recordingDatabase({
      firstResults: [new Error("private database detail")],
    });
    await expect(
      new MerchantRuleCorrectionRepository(readFailure.database).saveForFuture(INPUT),
    ).rejects.toEqual(new MerchantRuleCorrectionPersistenceError("WRITE_FAILED"));

    const incomplete = recordingDatabase({
      batchResults: [{ results: [RULE_ROW] }, { results: [] }],
      firstResults: [
        TRANSACTION_ROW,
        "category-food",
        null,
        TRANSACTION_ROW,
        "category-food",
        null,
      ],
    });
    await expect(
      new MerchantRuleCorrectionRepository(incomplete.database, {
        createId: () => "merchant-rule-1",
      }).saveForFuture(INPUT),
    ).rejects.toEqual(new MerchantRuleCorrectionPersistenceError("WRITE_FAILED"));
  });
});

describe("MerchantRuleManagementRepository", () => {
  it("rejects invalid management input before accessing the database", async () => {
    const recording = recordingDatabase();
    const repository = new MerchantRuleManagementRepository(recording.database);
    const operations = [
      repository.preview({ categoryId: "", displayMerchant: "Acme" }),
      repository.create({ categoryId: "category-food", displayMerchant: "Acme", now: "later" }),
      repository.update({ id: "merchant-rule-1", now: NOW, version: 1 }),
      repository.listPage({ pageSize: 0 }),
    ];

    for (const operation of operations) {
      await expect(operation).rejects.toEqual(
        new MerchantRuleManagementPersistenceError("INVALID_INPUT"),
      );
    }
    expect(recording.queries).toHaveLength(0);
  });

  it("rejects merchants that exceed the exact-key bound after normalization", async () => {
    const preview = recordingDatabase();
    await expect(
      new MerchantRuleManagementRepository(preview.database).preview({
        categoryId: "category-food",
        displayMerchant: EXPANDING_MERCHANT,
      }),
    ).resolves.toEqual({ kind: "MERCHANT_INVALID" });

    const create = recordingDatabase();
    await expect(
      new MerchantRuleManagementRepository(create.database).create({
        categoryId: "category-food",
        displayMerchant: EXPANDING_MERCHANT,
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "MERCHANT_INVALID" });

    const update = recordingDatabase({ firstResults: [RULE_ROW] });
    await expect(
      new MerchantRuleManagementRepository(update.database).update({
        displayMerchant: EXPANDING_MERCHANT,
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ kind: "MERCHANT_INVALID" });
  });

  it("rejects inactive or system categories in preview, create, and update", async () => {
    const preview = recordingDatabase({ firstResults: [null] });
    await expect(
      new MerchantRuleManagementRepository(preview.database).preview({
        categoryId: "category-inactive",
        displayMerchant: "Acme",
      }),
    ).resolves.toEqual({ kind: "CATEGORY_NOT_FOUND" });

    const create = recordingDatabase({ firstResults: [null] });
    await expect(
      new MerchantRuleManagementRepository(create.database).create({
        categoryId: "category-inactive",
        displayMerchant: "Acme",
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "CATEGORY_NOT_FOUND" });

    const update = recordingDatabase({ firstResults: [RULE_ROW, null] });
    await expect(
      new MerchantRuleManagementRepository(update.database).update({
        categoryId: "category-inactive",
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ kind: "CATEGORY_NOT_FOUND" });
  });

  it("previews exact historical conflicts without a write statement", async () => {
    const recording = recordingDatabase({
      firstResults: [
        "category-food",
        null,
        { conflicting_transactions: 2, matching_transactions: 3 },
      ],
    });

    await expect(
      new MerchantRuleManagementRepository(recording.database).preview({
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 42",
      }),
    ).resolves.toEqual({
      existingRule: null,
      impact: {
        conflictingTransactions: 2,
        historicalTransactionsChanged: 0,
        matchingTransactions: 3,
      },
      proposedRule: {
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 42",
        normalizedMerchant: "neighbourhood market",
      },
    });
    expect(recording.queries.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(
      true,
    );
  });

  it("normalizes and creates an exact rule without any historical transaction update", async () => {
    const createdRule = {
      ...RULE_ROW,
      display_merchant: "Neighbourhood Market Store 42",
    };
    const recording = recordingDatabase({
      firstResults: [
        "category-food",
        null,
        createdRule,
        { conflicting_transactions: 2, matching_transactions: 3 },
      ],
    });

    await expect(
      new MerchantRuleManagementRepository(recording.database).create({
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 42",
        now: NOW,
      }),
    ).resolves.toMatchObject({
      impact: {
        conflictingTransactions: 2,
        historicalTransactionsChanged: 0,
        matchingTransactions: 3,
      },
      kind: "CREATED",
      merchantRule: { normalizedMerchant: "neighbourhood market", version: 1 },
    });
    expect(recording.queries.some(({ sql }) => sql.includes("UPDATE transactions"))).toBe(false);
    expect(
      recording.queries.find(({ sql }) => sql.includes("INSERT INTO merchant_rules"))?.bindings,
    ).toContain("neighbourhood market");
    expect(
      recording.queries.find(({ sql }) => sql.includes("INSERT INTO merchant_rules"))?.bindings[0],
    ).toMatch(/^merchant-rule-[0-9a-f-]{36}$/u);
  });

  it("turns a concurrent create into a conflict and sanitizes an unexplained insert failure", async () => {
    const constraintFailure = new Error("unique normalized_merchant");
    const raced = recordingDatabase({
      firstResults: ["category-food", null, constraintFailure, RULE_ROW],
    });
    await expect(
      new MerchantRuleManagementRepository(raced.database).create({
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 42",
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "NORMALIZED_MERCHANT_CONFLICT" });

    const unexplained = recordingDatabase({
      firstResults: ["category-food", null, new Error("private database detail"), null],
    });
    await expect(
      new MerchantRuleManagementRepository(unexplained.database).create({
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 42",
        now: NOW,
      }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("WRITE_FAILED"));
  });

  it("fails closed when create cannot return a persisted rule or impact", async () => {
    const missingRule = recordingDatabase({
      firstResults: ["category-food", null, null],
    });
    await expect(
      new MerchantRuleManagementRepository(missingRule.database).create({
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 42",
        now: NOW,
      }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("WRITE_FAILED"));

    const missingImpact = recordingDatabase({
      firstResults: ["category-food", null, RULE_ROW, null],
    });
    await expect(
      new MerchantRuleManagementRepository(missingImpact.database).create({
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 42",
        now: NOW,
      }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("WRITE_FAILED"));
  });

  it("updates only one versioned rule and returns an impact preview", async () => {
    const updatedRule = {
      ...RULE_ROW,
      category_id: "category-shopping",
      display_merchant: "Neighbourhood Market Store 99",
      version: 2,
    };
    const recording = recordingDatabase({
      firstResults: [
        RULE_ROW,
        "category-shopping",
        RULE_ROW,
        updatedRule,
        { conflicting_transactions: 1, matching_transactions: 2 },
      ],
    });

    await expect(
      new MerchantRuleManagementRepository(recording.database).update({
        categoryId: "category-shopping",
        displayMerchant: "Neighbourhood Market Store 99",
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toMatchObject({
      impact: { conflictingTransactions: 1, historicalTransactionsChanged: 0 },
      kind: "UPDATED",
      merchantRule: { categoryId: "category-shopping", version: 2 },
    });
    const update = recording.queries.find(({ sql }) => sql.includes("UPDATE merchant_rules"));
    expect(update?.sql).toContain("WHERE id = ? AND version = ?");
    expect(recording.queries.some(({ sql }) => sql.includes("UPDATE transactions"))).toBe(false);
  });

  it("diagnoses deletion and version changes when a guarded update loses a race", async () => {
    const deleted = recordingDatabase({ firstResults: [RULE_ROW, RULE_ROW, null, null] });
    await expect(
      new MerchantRuleManagementRepository(deleted.database).update({
        active: false,
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ kind: "NOT_FOUND" });

    const versioned = recordingDatabase({
      firstResults: [RULE_ROW, RULE_ROW, null, { ...RULE_ROW, version: 2 }],
    });
    await expect(
      new MerchantRuleManagementRepository(versioned.database).update({
        active: false,
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ currentVersion: 2, kind: "VERSION_CONFLICT" });
  });

  it("lists rules with a bounded query and opaque continuation cursor", async () => {
    const recording = recordingDatabase({
      allResults: [[RULE_ROW, { ...RULE_ROW, id: "merchant-rule-0" }]],
    });

    const page = await new MerchantRuleManagementRepository(recording.database).listPage({
      active: true,
      pageSize: 1,
    });
    expect(page).toMatchObject({
      hasMore: true,
      rules: [{ id: "merchant-rule-1" }],
    });
    expect(typeof page.nextCursor).toBe("string");
    expect(recording.queries[0]!.sql).toContain("ORDER BY updated_at DESC, id DESC LIMIT ?");
    expect(recording.queries[0]!.bindings).toEqual([1, 2]);

    const continuation = recordingDatabase({ allResults: [[]] });
    await expect(
      new MerchantRuleManagementRepository(continuation.database).listPage({
        active: true,
        cursor: page.nextCursor,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ hasMore: false, nextCursor: null, rules: [] });
    expect(continuation.queries[0]!.bindings).toEqual([
      1,
      RULE_ROW.updated_at,
      RULE_ROW.updated_at,
      RULE_ROW.id,
      2,
    ]);
  });

  it("binds inactive filters and rejects malformed or filter-mismatched cursors", async () => {
    const inactive = recordingDatabase({ allResults: [[]] });
    await expect(
      new MerchantRuleManagementRepository(inactive.database).listPage({
        active: false,
        pageSize: 25,
      }),
    ).resolves.toEqual({ hasMore: false, nextCursor: null, rules: [] });
    expect(inactive.queries[0]!.bindings).toEqual([0, 26]);

    const unfiltered = recordingDatabase({
      allResults: [[RULE_ROW, { ...RULE_ROW, id: "merchant-rule-0" }]],
    });
    const page = await new MerchantRuleManagementRepository(unfiltered.database).listPage({
      pageSize: 1,
    });
    expect(page.nextCursor).not.toBeNull();

    const mismatched = recordingDatabase();
    await expect(
      new MerchantRuleManagementRepository(mismatched.database).listPage({
        active: true,
        cursor: page.nextCursor,
        pageSize: 1,
      }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("INVALID_INPUT"));
    expect(mismatched.queries).toHaveLength(0);

    const malformed = recordingDatabase();
    await expect(
      new MerchantRuleManagementRepository(malformed.database).listPage({
        cursor: "not-a-valid-cursor",
        pageSize: 1,
      }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("INVALID_INPUT"));
    expect(malformed.queries).toHaveLength(0);
  });

  it("sanitizes preview, update, and list database failures", async () => {
    const preview = recordingDatabase({ firstResults: [new Error("private preview detail")] });
    await expect(
      new MerchantRuleManagementRepository(preview.database).preview({
        categoryId: "category-food",
        displayMerchant: "Acme",
      }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("WRITE_FAILED"));

    const update = recordingDatabase({ firstResults: [new Error("private update detail")] });
    await expect(
      new MerchantRuleManagementRepository(update.database).update({
        active: false,
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("WRITE_FAILED"));

    const list = recordingDatabase({ allResults: [new Error("private list detail")] });
    await expect(
      new MerchantRuleManagementRepository(list.database).listPage({ pageSize: 25 }),
    ).rejects.toEqual(new MerchantRuleManagementPersistenceError("WRITE_FAILED"));
  });

  it("returns explicit create conflicts and update identity/version branches", async () => {
    const duplicate = recordingDatabase({ firstResults: ["category-food", RULE_ROW] });
    await expect(
      new MerchantRuleManagementRepository(duplicate.database).create({
        categoryId: "category-food",
        displayMerchant: "Neighbourhood Market Store 99",
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "NORMALIZED_MERCHANT_CONFLICT" });

    const missing = recordingDatabase({ firstResults: [null] });
    await expect(
      new MerchantRuleManagementRepository(missing.database).update({
        active: false,
        id: "merchant-rule-missing",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ kind: "NOT_FOUND" });

    const stale = recordingDatabase({ firstResults: [{ ...RULE_ROW, version: 4 }] });
    await expect(
      new MerchantRuleManagementRepository(stale.database).update({
        active: false,
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ currentVersion: 4, kind: "VERSION_CONFLICT" });

    const collision = recordingDatabase({
      firstResults: [RULE_ROW, { ...RULE_ROW, id: "merchant-rule-other" }],
    });
    await expect(
      new MerchantRuleManagementRepository(collision.database).update({
        displayMerchant: "Neighbourhood Market Store 99",
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toEqual({ kind: "NORMALIZED_MERCHANT_CONFLICT" });
  });

  it("returns the current record for an idempotent management update", async () => {
    const recording = recordingDatabase({
      firstResults: [RULE_ROW, RULE_ROW, { conflicting_transactions: 0, matching_transactions: 1 }],
    });

    await expect(
      new MerchantRuleManagementRepository(recording.database).update({
        active: true,
        id: "merchant-rule-1",
        now: NOW,
        version: 1,
      }),
    ).resolves.toMatchObject({
      impact: { conflictingTransactions: 0, historicalTransactionsChanged: 0 },
      kind: "NO_CHANGE",
      merchantRule: { id: "merchant-rule-1", version: 1 },
    });
    expect(recording.queries.some(({ sql }) => sql.includes("UPDATE merchant_rules"))).toBe(false);
  });
});
