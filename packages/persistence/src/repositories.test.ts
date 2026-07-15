import { describe, expect, it } from "vitest";

import {
  AccountRepository,
  ConnectionRepository,
  TransactionRepository,
  createRepositories,
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

const CONNECTION_ROW = {
  access_token_ciphertext: "access-sandbox-fixture-token-that-must-never-leak",
  access_token_iv: "private-iv-material",
  id: "connection-1",
  institution_id: "ins_42",
  institution_name: "Fixture Bank",
  last_error_code: null,
  last_success_at: "2026-01-15T12:00:00.000Z",
  plaid_item_id: "item-1",
  status: "HEALTHY",
  sync_cursor: "cursor-1",
  token_key_version: 7,
  version: 2,
};

const ACCOUNT_ROW = {
  connection_id: "connection-1",
  currency: "CAD",
  display_name: "Daily Chequing",
  enabled: 1,
  id: "account-1",
  mask: "1234",
  plaid_account_id: "plaid-account-1",
  subtype: "CHECKING",
  type: "DEPOSITORY",
  version: 1,
};

const TRANSACTION_ROW = {
  account_id: "account-1",
  account_label: null,
  amount_minor: 1234,
  authorized_date: "2026-01-14",
  categorization_source: "PLAID",
  category_id: "category-1",
  created_at: "2026-01-15T12:00:00.000Z",
  currency: "CAD",
  direction: "OUTFLOW",
  id: "transaction-1",
  merchant_name: "Fixture Merchant",
  needs_review: 1,
  pending_transaction_id: null,
  plaid_transaction_id: "plaid-transaction-1",
  posted_date: "2026-01-15",
  raw_description: "Fixture purchase",
  review_reason: "UNCLASSIFIED_MERCHANT",
  source: "PLAID",
  status: "POSTED",
  updated_at: "2026-01-15T12:00:00.000Z",
  version: 3,
};

describe("typed prepared-statement repositories", () => {
  it("creates the reviewed repository boundary", () => {
    const { database } = createRecordingDatabase();
    const repositories = createRepositories(database);

    expect(repositories.accounts).toBeInstanceOf(AccountRepository);
    expect(repositories.connections).toBeInstanceOf(ConnectionRepository);
    expect(repositories.transactions).toBeInstanceOf(TransactionRepository);
  });

  it("binds Plaid Item identity and maps connection rows", async () => {
    const { database, queries } = createRecordingDatabase({ firstResult: CONNECTION_ROW });
    const itemId = "item' OR 1=1 --";

    const result = await new ConnectionRepository(database).findByPlaidItemId(itemId);

    expect(queries[0]!.sql).not.toContain(itemId);
    expect(queries[0]!.bindings).toEqual([itemId]);
    expect(result).toEqual({
      id: "connection-1",
      institutionId: "ins_42",
      institutionName: "Fixture Bank",
      lastErrorCode: null,
      lastSuccessAt: "2026-01-15T12:00:00.000Z",
      plaidItemId: "item-1",
      status: "HEALTHY",
      syncCursor: "cursor-1",
      version: 2,
    });
    expect(queries[0]!.sql).not.toContain("access_token");
    expect(queries[0]!.sql).not.toContain("token_key_version");
    expect(JSON.stringify(result)).not.toContain("fixture-token-that-must-never-leak");
    expect(JSON.stringify(result)).not.toContain("private-iv-material");
  });

  it("returns null when a prepared connection lookup has no row", async () => {
    const { database } = createRecordingDatabase();

    await expect(
      new ConnectionRepository(database).findByPlaidItemId("missing-item"),
    ).resolves.toBe(null);
  });

  it("allowlists sync status and binds candidate limits", async () => {
    const recording = createRecordingDatabase({ allResults: [CONNECTION_ROW] });
    const repository = new ConnectionRepository(recording.database);

    await expect(
      repository.listSyncCandidates({
        before: "2026-01-15T12:00:00.000Z",
        status: "HEALTHY' OR 1=1 --",
      }),
    ).rejects.toThrow();
    expect(recording.queries).toHaveLength(0);

    const result = await repository.listSyncCandidates({
      before: "2026-01-15T12:00:00.000Z",
      limit: 10,
      status: "HEALTHY",
    });
    expect(recording.queries[0]!.bindings).toEqual(["HEALTHY", "2026-01-15T12:00:00.000Z", 10]);
    expect(result[0]?.id).toBe("connection-1");

    await repository.listSyncCandidates({
      before: "2026-01-15T12:00:00.000Z",
      status: "HEALTHY",
    });
    expect(recording.queries[1]!.bindings).toEqual(["HEALTHY", "2026-01-15T12:00:00.000Z", 25]);
  });

  it("binds account identity and maps integer booleans", async () => {
    const recording = createRecordingDatabase({ allResults: [ACCOUNT_ROW] });
    const connectionId = "connection' UNION SELECT 1 --";

    const result = await new AccountRepository(recording.database).listEnabled(connectionId);

    expect(recording.queries[0]!.sql).not.toContain(connectionId);
    expect(recording.queries[0]!.bindings).toEqual([connectionId]);
    expect(result[0]).toMatchObject({ enabled: true, id: "account-1", subtype: "CHECKING" });

    const disabled = createRecordingDatabase({ allResults: [{ ...ACCOUNT_ROW, enabled: 0 }] });
    await expect(
      new AccountRepository(disabled.database).listEnabled("connection-1"),
    ).resolves.toMatchObject([{ enabled: false }]);
  });

  it("builds the connection/account read model without secret columns", async () => {
    const secondConnection = {
      ...CONNECTION_ROW,
      id: "connection-2",
      institution_id: "ins_43",
      plaid_item_id: "item-2",
    };
    const recording = createRecordingDatabase({
      allResultsSequence: [[CONNECTION_ROW, secondConnection], [ACCOUNT_ROW]],
    });

    const result = await new ConnectionRepository(recording.database).listWithAccounts();

    expect(result).toMatchObject([
      { accounts: [{ id: "account-1" }], connection: { id: "connection-1" } },
      { accounts: [], connection: { id: "connection-2" } },
    ]);
    expect(recording.queries.map(({ sql }) => sql).join("\n")).not.toContain("access_token");
  });

  it("updates account enablement with optimistic version checks", async () => {
    const updated = createRecordingDatabase({
      firstResult: { ...ACCOUNT_ROW, enabled: 0, version: 2 },
    });
    await expect(
      new AccountRepository(updated.database).updateEnabled({
        enabled: false,
        id: "account-1",
        now: "2026-07-15T12:00:00.000Z",
        version: 1,
      }),
    ).resolves.toMatchObject({ account: { enabled: false, version: 2 }, kind: "UPDATED" });
    expect(updated.queries[0]!.bindings).toEqual([0, "2026-07-15T12:00:00.000Z", "account-1", 1]);

    const conflict = createRecordingDatabase({
      firstResult: { ...ACCOUNT_ROW, version: 3 },
      runChanges: 0,
    });
    await expect(
      new AccountRepository(conflict.database).updateEnabled({
        enabled: true,
        id: "account-1",
        now: "2026-07-15T12:00:00.000Z",
        version: 1,
      }),
    ).resolves.toEqual({ currentVersion: 3, kind: "VERSION_CONFLICT" });

    const missing = createRecordingDatabase({ firstResult: null, runChanges: 0 });
    await expect(
      new AccountRepository(missing.database).updateEnabled({
        enabled: true,
        id: "account-missing",
        now: "2026-07-15T12:00:00.000Z",
        version: 1,
      }),
    ).resolves.toEqual({ kind: "NOT_FOUND" });
  });

  it("builds filter SQL only from fixed fragments and binds every external value", async () => {
    const recording = createRecordingDatabase({ allResults: [TRANSACTION_ROW] });
    const accountId = "account' OR 1=1 --";

    const result = await new TransactionRepository(recording.database).list({
      accountId,
      categorizationSource: "PLAID",
      categoryId: "category-1",
      currency: "CAD",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      needsReview: true,
      pageSize: 25,
      sort: "AMOUNT_DESC",
      source: "PLAID",
      status: "POSTED",
    });

    const query = recording.queries[0]!;
    expect(query.sql).not.toContain(accountId);
    expect(query.sql).toContain("ORDER BY amount_minor DESC, id DESC LIMIT ?");
    expect(query.bindings).toEqual([
      accountId,
      "category-1",
      "PLAID",
      "CAD",
      "2026-01-01",
      "2026-01-31",
      1,
      "PLAID",
      "POSTED",
      25,
    ]);
    expect(result[0]).toMatchObject({
      amountMinor: 1234,
      id: "transaction-1",
      needsReview: true,
      version: 3,
    });
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
});
