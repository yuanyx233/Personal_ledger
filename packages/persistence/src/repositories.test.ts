import { describe, expect, it } from "vitest";

import {
  TransactionCsvExportPersistenceError,
  TransactionQueryError,
  TransactionRepository,
} from "./repositories";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function createRecordingDatabase({
  allResults = [],
  allResultsSequence,
  firstResult = null,
  firstResultsSequence,
  runChanges = 1,
}: {
  allResults?: unknown[];
  allResultsSequence?: unknown[][];
  firstResult?: unknown;
  firstResultsSequence?: unknown[];
  runChanges?: number;
} = {}) {
  const queries: RecordedQuery[] = [];
  const queuedAllResults = allResultsSequence ? [...allResultsSequence] : undefined;
  const queuedFirstResults = firstResultsSequence ? [...firstResultsSequence] : undefined;
  const database = {
    batch(statements: D1PreparedStatement[]) {
      return Promise.resolve(
        statements.map((_, index) => ({
          meta: { changes: index === 0 ? runChanges : 1 },
          results: index === 0 && runChanges === 1 && firstResult ? [firstResult] : [],
        })),
      );
    },
    prepare(sql: string) {
      const query: RecordedQuery = { bindings: [], sql };
      queries.push(query);
      const statement = {
        all: () => Promise.resolve({ results: queuedAllResults?.shift() ?? allResults }),
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return statement;
        },
        first: () => Promise.resolve(queuedFirstResults?.shift() ?? firstResult),
        run: () => Promise.resolve({ meta: { changes: runChanges } }),
      };
      return statement;
    },
  } as unknown as D1Database;

  return { database, queries };
}

const TRANSACTION_ROW = {
  account_label: "Daily Chequing",
  amount_minor: 1234,
  authorized_date: "2026-01-14",
  categorization_source: "RULE",
  category_id: "category-1",
  category_rule_id: null,
  created_at: "2026-01-15T12:00:00.000Z",
  currency: "CAD",
  direction: "OUTFLOW",
  id: "transaction-1",
  merchant_name: "Fixture Merchant",
  needs_review: 1,
  normalized_merchant: "fixture merchant",
  payment_metadata_json:
    '{"payee":"Fixture Payee","payer":"","paymentMethod":"INTERAC","reason":"must not leak","referenceNumber":"reference-1"}',
  pending_transaction_id: null,
  posted_date: "2026-01-15",
  raw_description: "Fixture purchase",
  review_reason: "UNCLASSIFIED_MERCHANT",
  source: "CSV",
  status: "POSTED",
  updated_at: "2026-01-15T12:00:00.000Z",
  version: 3,
};

describe("typed prepared-statement repositories", () => {
  it("builds filter SQL only from fixed fragments and binds every external value", async () => {
    const recording = createRecordingDatabase({ allResults: [TRANSACTION_ROW] });
    const accountId = "account' OR 1=1 --";

    const result = await new TransactionRepository(recording.database).list({
      accountId,
      categorizationSource: "RULE",
      categoryId: "category-1",
      currency: "CAD",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      needsReview: true,
      pageSize: 25,
      sort: "AMOUNT_DESC",
      source: "CSV",
      status: "POSTED",
    });

    const query = recording.queries[0]!;
    expect(query.sql).not.toContain(accountId);
    expect(query.sql).toContain("ORDER BY amount_minor DESC, id DESC LIMIT ?");
    expect(query.bindings).toEqual([
      accountId,
      "category-1",
      "RULE",
      "CAD",
      "2026-01-01",
      "2026-01-31",
      1,
      "CSV",
      "POSTED",
      25,
    ]);
    expect(result[0]).toMatchObject({
      amountMinor: 1234,
      categoryRuleId: null,
      id: "transaction-1",
      needsReview: true,
      normalizedMerchant: "fixture merchant",
      paymentMetadata: {
        payee: "Fixture Payee",
        payer: "",
        paymentMethod: "INTERAC",
        referenceNumber: "reference-1",
      },
      version: 3,
    });
    expect(JSON.stringify(result[0])).not.toContain("must not leak");
  });

  it("binds the canonical net-spending drill-down population and scopes its cursor", async () => {
    const recording = createRecordingDatabase({
      allResults: [TRANSACTION_ROW, { ...TRANSACTION_ROW, id: "transaction-0" }],
    });
    const normalizedMerchant = "merchant' OR 1=1 --";
    const repository = new TransactionRepository(recording.database);

    const firstPage = await repository.listPage({
      currency: "CAD",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      normalizedMerchant,
      pageSize: 1,
      reportMetric: "NET_SPENDING",
    });

    const query = recording.queries[0]!;
    expect(query.sql).not.toContain(normalizedMerchant);
    expect(query.sql).toContain("normalized_merchant = ?");
    expect(query.sql).toContain("report_category.kind = 'EXPENSE'");
    expect(query.sql).toContain("status = 'POSTED'");
    expect(query.sql).not.toContain("transfer_matches");
    expect(query.bindings).toEqual(["CAD", "2026-01-01", "2026-01-31", normalizedMerchant, 2]);
    expect(firstPage.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    await expect(
      new TransactionRepository(createRecordingDatabase().database).listPage({
        currency: "CAD",
        cursor: firstPage.nextCursor!,
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        merchantMissing: true,
        pageSize: 1,
        reportMetric: "NET_SPENDING",
      }),
    ).rejects.toEqual(new TransactionQueryError("INVALID_CURSOR"));
  });

  it("exports the same prepared filter population with account, category, and rule provenance", async () => {
    const exportRow = {
      ...TRANSACTION_ROW,
      category_name: "Food",
      category_rule_display_merchant: "Fixture Merchant",
      export_account_label: "Daily Chequing",
    };
    const recording = createRecordingDatabase({ allResults: [exportRow] });
    const normalizedMerchant = "merchant' OR 1=1 --";

    const result = await new TransactionRepository(recording.database).listForCsvExport({
      accountId: "account-1",
      categorizationSource: "RULE",
      categoryId: "category-1",
      currency: "CAD",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      needsReview: true,
      normalizedMerchant,
      reportMetric: "NET_SPENDING",
      sort: "AMOUNT_DESC",
      source: "CSV",
      status: "POSTED",
    });

    const query = recording.queries[0]!;
    expect(query.sql).not.toContain(normalizedMerchant);
    expect(query.sql).toContain("WITH filtered_transactions AS");
    expect(query.sql).toContain("LEFT JOIN categories");
    expect(query.sql).toContain("LEFT JOIN merchant_rules");
    expect(query.sql).toContain("report_category.kind = 'EXPENSE'");
    expect(query.sql).toContain(
      "ORDER BY filtered_transactions.amount_minor DESC, filtered_transactions.id DESC",
    );
    expect(query.bindings).toEqual([
      "account-1",
      "category-1",
      "RULE",
      "CAD",
      "2026-01-01",
      "2026-01-31",
      1,
      normalizedMerchant,
      "CSV",
      "POSTED",
      10_001,
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        accountLabel: "Daily Chequing",
        categoryName: "Food",
        categoryRuleDisplayMerchant: "Fixture Merchant",
        id: "transaction-1",
      }),
    ]);
  });

  it("refuses pagination state and the 10,001st CSV export row without returning a truncation", async () => {
    const invalid = createRecordingDatabase();
    await expect(
      new TransactionRepository(invalid.database).listForCsvExport({ pageSize: 10 }),
    ).rejects.toThrow();
    await expect(
      new TransactionRepository(invalid.database).listForCsvExport({ cursor: "eyJ2IjoxfQ" }),
    ).rejects.toThrow();
    expect(invalid.queries).toHaveLength(0);

    const oversized = createRecordingDatabase({
      allResults: Array.from({ length: 10_001 }, (_, index) => ({
        ...TRANSACTION_ROW,
        category_name: null,
        category_rule_display_merchant: null,
        export_account_label: "Daily Chequing",
        id: `transaction-${index}`,
      })),
    });
    await expect(
      new TransactionRepository(oversized.database).listForCsvExport({}),
    ).rejects.toEqual(new TransactionCsvExportPersistenceError("ROW_LIMIT_EXCEEDED"));
  });

  it("rejects sort fragments, unknown filters, reversed ranges, and oversized pages", async () => {
    const recording = createRecordingDatabase();
    const repository = new TransactionRepository(recording.database);

    await expect(
      repository.list({ sort: "POSTED_DATE_DESC; DROP TABLE transactions; --" }),
    ).rejects.toThrow();
    await expect(repository.list({ unsafeWhere: "1=1" })).rejects.toThrow();
    await expect(
      repository.list({ dateFrom: "2026-02-01", dateTo: "2026-01-01" }),
    ).rejects.toThrow();
    await expect(repository.list({ pageSize: 101 })).rejects.toThrow();
    expect(recording.queries).toHaveLength(0);
  });

  it("uses bounded defaults when optional transaction filters are absent", async () => {
    const recording = createRecordingDatabase({
      allResults: [{ ...TRANSACTION_ROW, needs_review: 0, review_reason: null }],
    });
    const repository = new TransactionRepository(recording.database);

    const result = await repository.list({});

    expect(recording.queries[0]!.sql).not.toContain("WHERE");
    expect(recording.queries[0]!.sql).toContain("ORDER BY posted_date DESC, id DESC LIMIT ?");
    expect(recording.queries[0]!.bindings).toEqual([50]);
    expect(result[0]).toMatchObject({ needsReview: false, reviewReason: null });

    await repository.list({ dateFrom: "2026-01-01" });
    await repository.list({ dateTo: "2026-01-31" });
    expect(recording.queries[1]!.bindings).toEqual(["2026-01-01", 50]);
    expect(recording.queries[2]!.bindings).toEqual(["2026-01-31", 50]);
  });

  it("returns an opaque keyset cursor and binds it to the selected sort", async () => {
    const firstPageRows = [
      { ...TRANSACTION_ROW, id: "transaction-3", posted_date: "2026-01-17" },
      { ...TRANSACTION_ROW, id: "transaction-2", posted_date: "2026-01-16" },
      { ...TRANSACTION_ROW, id: "transaction-1", posted_date: "2026-01-15" },
    ];
    const firstPage = createRecordingDatabase({ allResults: firstPageRows });

    const page = await new TransactionRepository(firstPage.database).listPage({
      pageSize: 2,
      sort: "POSTED_DATE_DESC",
      status: "POSTED",
    });

    expect(page.transactions.map(({ id }) => id)).toEqual(["transaction-3", "transaction-2"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(firstPage.queries[0]!.bindings).toEqual(["POSTED", 3]);

    const secondPage = createRecordingDatabase({ allResults: [] });
    await expect(
      new TransactionRepository(secondPage.database).listPage({
        cursor: page.nextCursor!,
        pageSize: 2,
        sort: "POSTED_DATE_DESC",
        status: "POSTED",
      }),
    ).resolves.toEqual({ hasMore: false, nextCursor: null, transactions: [] });
    expect(secondPage.queries[0]!.sql).toContain(
      "(posted_date < ? OR (posted_date = ? AND id < ?))",
    );
    expect(secondPage.queries[0]!.bindings).toEqual([
      "POSTED",
      "2026-01-16",
      "2026-01-16",
      "transaction-2",
      3,
    ]);

    await expect(
      new TransactionRepository(createRecordingDatabase().database).listPage({
        cursor: page.nextCursor!,
        pageSize: 2,
        sort: "AMOUNT_DESC",
      }),
    ).rejects.toEqual(new TransactionQueryError("INVALID_CURSOR"));
    await expect(
      new TransactionRepository(createRecordingDatabase().database).listPage({
        cursor: page.nextCursor!,
        pageSize: 2,
        sort: "POSTED_DATE_DESC",
        status: "REMOVED",
      }),
    ).rejects.toEqual(new TransactionQueryError("INVALID_CURSOR"));
  });

  it("returns historical lifecycle and append-only category audit detail", async () => {
    const categoryAudit = {
      created_at: "2026-01-15T13:00:00.000Z",
      id: "category-audit-1",
      new_category_id: "category-1",
      new_source: "MANUAL",
      old_category_id: null,
      old_source: "UNCLASSIFIED",
      reason: "OWNER_TRANSACTION_OVERRIDE",
    };
    const recording = createRecordingDatabase({
      allResultsSequence: [[categoryAudit]],
      firstResultsSequence: [TRANSACTION_ROW, { id: "transaction-posted-replacement" }],
    });

    const detail = await new TransactionRepository(recording.database).findDetailById(
      "transaction-1",
    );

    expect(detail).toMatchObject({
      categoryAudits: [
        {
          id: "category-audit-1",
          newCategoryId: "category-1",
          newSource: "MANUAL",
          oldCategoryId: null,
          oldSource: "UNCLASSIFIED",
          reason: "OWNER_TRANSACTION_OVERRIDE",
        },
      ],
      lifecycle: {
        pendingTransactionId: null,
        replacedByTransactionId: "transaction-posted-replacement",
      },
      transaction: { id: "transaction-1" },
    });
    expect(recording.queries).toHaveLength(3);
    expect(recording.queries.flatMap(({ bindings }) => bindings)).toEqual([
      "transaction-1",
      "transaction-1",
      "transaction-1",
    ]);
  });

  it("fails closed when stored payment metadata is not a valid object", async () => {
    const recording = createRecordingDatabase({
      allResults: [{ ...TRANSACTION_ROW, payment_metadata_json: "not-json" }],
    });

    const [result] = await new TransactionRepository(recording.database).list({});

    expect(result?.paymentMetadata).toEqual({
      payee: null,
      payer: null,
      paymentMethod: null,
      referenceNumber: null,
    });
  });
});
