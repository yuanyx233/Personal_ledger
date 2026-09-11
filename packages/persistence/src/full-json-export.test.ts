import { describe, expect, it } from "vitest";

import { FullJsonExportPersistenceError, FullJsonExportRepository } from "./full-json-export";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function createRecordingDatabase(resultSets: unknown[][]) {
  const queries: RecordedQuery[] = [];
  let batchCalls = 0;
  const database = {
    batch(statements: D1PreparedStatement[]) {
      batchCalls += 1;
      return Promise.resolve(
        statements.map((_, index) => ({ meta: {}, results: resultSets[index] ?? [] })),
      );
    },
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
  } as unknown as D1Database;
  return {
    database,
    get batchCalls() {
      return batchCalls;
    },
    queries,
  };
}

const NOW = "2026-07-17T12:00:00.000Z";

const RESULT_SETS = [
  [
    {
      created_at: NOW,
      id: "connection-1",
      institution_id: "ins_1",
      institution_name: "Fixture Bank",
      updated_at: NOW,
      version: 2,
    },
  ],
  [
    {
      connection_id: "connection-1",
      created_at: NOW,
      currency: "CAD",
      display_name: "Daily Chequing",
      enabled: 1,
      id: "account-1",
      subtype: "CHECKING",
      type: "DEPOSITORY",
      updated_at: NOW,
      version: 1,
    },
  ],
  [
    {
      active: 1,
      created_at: NOW,
      editable: 1,
      id: "category-1",
      kind: "EXPENSE",
      name: "Food",
      system_key: null,
      updated_at: NOW,
      version: 1,
    },
  ],
  [
    {
      active: 1,
      category_id: "category-1",
      created_at: NOW,
      display_merchant: "Fixture Cafe",
      id: "rule-1",
      normalized_merchant: "fixture cafe",
      updated_at: NOW,
      version: 1,
    },
  ],
  [
    {
      account_id: "account-1",
      account_label: null,
      amount_minor: 1234,
      authorized_date: null,
      categorization_source: "RULE",
      category_id: "category-1",
      category_rule_id: "rule-1",
      created_at: NOW,
      currency: "CAD",
      direction: "OUTFLOW",
      id: "transaction-1",
      import_fingerprint: null,
      merchant_name: "Fixture Cafe",
      needs_review: 0,
      normalized_merchant: "fixture cafe",
      payment_metadata_json:
        '{"payee":"Cafe","payer":null,"paymentMethod":"CARD","referenceNumber":"r-1","ignored":"do-not-export"}',
      pending_transaction_id: null,
      plaid_pfc_confidence: "HIGH",
      plaid_pfc_detailed: "FOOD_AND_DRINK_COFFEE",
      plaid_pfc_primary: "FOOD_AND_DRINK",
      plaid_transaction_id: "provider-transaction-1",
      posted_date: "2026-07-17",
      raw_description: "Coffee",
      review_reason: null,
      source: "PLAID",
      status: "POSTED",
      updated_at: NOW,
      version: 3,
    },
  ],
  [
    {
      created_at: NOW,
      id: "category-audit-1",
      new_category_id: "category-1",
      new_category_rule_id: "rule-1",
      new_source: "RULE",
      old_category_id: null,
      old_category_rule_id: null,
      old_source: "UNCLASSIFIED",
      reason: "RULE_CATEGORIZATION",
      transaction_id: "transaction-1",
    },
  ],
  [
    {
      confidence: "HIGH",
      created_at: NOW,
      decision_reason: null,
      evidence_json:
        '{"amountMinor":1234,"currency":"CAD","dayDifference":0,"signals":["DESCRIPTION"]}',
      id: "transfer-match-1",
      left_transaction_id: "transaction-1",
      right_transaction_id: "transaction-2",
      status: "AUTO_CONFIRMED",
      updated_at: NOW,
      version: 1,
    },
  ],
  [
    {
      action: "CONFIRM",
      created_at: NOW,
      id: "transfer-audit-1",
      match_version: 2,
      new_status: "CONFIRMED",
      old_status: "AUTO_CONFIRMED",
      reason: "OWNER_CONFIRMED",
      transfer_match_id: "transfer-match-1",
    },
  ],
  [
    {
      committed_at: NOW,
      content_checksum: "a".repeat(64),
      created_at: NOW,
      id: "import-batch-1",
      source_filename_hash: "b".repeat(64),
      status: "COMMITTED",
      version: 2,
    },
  ],
  [
    {
      batch_id: "import-batch-1",
      canonical_fingerprint: "c".repeat(64),
      created_at: NOW,
      errors_json: '{"duplicateEvidence":null,"fieldErrors":[]}',
      id: "import-row-1",
      match_evidence_json: null,
      raw_json:
        '{"accountLabel":"Daily Chequing","amount":"12.34","category":"Food","currency":"CAD","description":"Coffee","direction":"OUTFLOW","merchant":"Fixture Cafe","postedDate":"2026-07-17"}',
      row_number: 2,
      resolution: "IMPORTED_NEW",
      resolved_at: NOW,
      transaction_id: "transaction-1",
      validation_status: "IMPORTED",
    },
  ],
  [
    {
      account_label: "Daily Chequing",
      amount_minor: 1234,
      anchor_day: 17,
      cadence: "MONTHLY",
      category_id: "category-1",
      created_at: NOW,
      currency: "CAD",
      id: "subscription-1",
      last_error_code: null,
      merchant_name: "Fixture Cafe",
      name: "Fixture plan",
      next_charge_date: "2026-08-17",
      normalized_merchant: "fixture cafe",
      status: "ACTIVE",
      updated_at: NOW,
      version: 1,
    },
  ],
  [
    {
      created_at: NOW,
      id: "occurrence-1",
      owner_decision_at: null,
      scheduled_date: "2026-07-17",
      status: "GENERATED",
      subscription_id: "subscription-1",
      transaction_id: "transaction-1",
      updated_at: NOW,
      version: 1,
    },
  ],
];

describe("full JSON export snapshot repository", () => {
  it("reads one transactional, stable, allowlisted snapshot and maps portable records", async () => {
    const recording = createRecordingDatabase(RESULT_SETS);
    const data = await new FullJsonExportRepository(recording.database).readSnapshot();

    expect(recording.batchCalls).toBe(1);
    expect(recording.queries).toHaveLength(13);
    expect(recording.queries.every(({ sql }) => /ORDER BY/.test(sql))).toBe(true);
    expect(recording.queries.every(({ bindings }) => bindings.at(-1) === 50_001)).toBe(true);
    expect(recording.queries[8]!.sql).toContain("status = 'COMMITTED'");
    expect(recording.queries[9]!.sql).toContain("batch.status = 'COMMITTED'");

    const sql = recording.queries
      .map(({ sql: statement }) => statement)
      .join("\n")
      .toLowerCase();
    for (const forbidden of [
      "access_token",
      "plaid_item_id",
      "plaid_account_id",
      "token_key_version",
      "sync_cursor",
      "provider_amount_decimal",
      "idempotency_key",
      "preview_expires_at",
      "mask",
      "sync_events",
      "sync_runs",
      "connection_requests",
      "minimal_payload",
      "webhook",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
    expect(data.transactions[0]).toMatchObject({
      amountMinor: 1234,
      paymentMetadata: {
        payee: "Cafe",
        payer: null,
        paymentMethod: "CARD",
        referenceNumber: "r-1",
      },
      plaidPersonalFinanceCategory: {
        confidenceLevel: "HIGH",
        detailed: "FOOD_AND_DRINK_COFFEE",
        primary: "FOOD_AND_DRINK",
      },
      providerTransactionId: "provider-transaction-1",
    });
    expect(JSON.stringify(data)).not.toContain("do-not-export");
    expect(data.transferMatches[0]!.evidence.reason).toBe(null);
    expect(data.importBatches).toHaveLength(1);
    expect(data.importRows[0]).toMatchObject({ batchId: "import-batch-1", rowNumber: 2 });
    expect(data.subscriptions[0]).toMatchObject({ id: "subscription-1", anchorDay: 17 });
    expect(data.subscriptionOccurrences[0]).toMatchObject({
      id: "occurrence-1",
      transactionId: "transaction-1",
    });
  });

  it("fails closed on a collection overflow or malformed stored JSON", async () => {
    const overflow = createRecordingDatabase([[RESULT_SETS[0]![0], RESULT_SETS[0]![0]]]);
    await expect(
      new FullJsonExportRepository(overflow.database, {
        maximumRecordsPerCollection: 1,
        maximumTotalRecords: 10,
      }).readSnapshot(),
    ).rejects.toEqual(new FullJsonExportPersistenceError("ROW_LIMIT_EXCEEDED"));

    const totalOverflow = createRecordingDatabase([[RESULT_SETS[0]![0]], [RESULT_SETS[1]![0]]]);
    await expect(
      new FullJsonExportRepository(totalOverflow.database, {
        maximumRecordsPerCollection: 2,
        maximumTotalRecords: 1,
      }).readSnapshot(),
    ).rejects.toEqual(new FullJsonExportPersistenceError("ROW_LIMIT_EXCEEDED"));

    const invalidSets: unknown[][] = RESULT_SETS.map((rows) => [...rows]);
    invalidSets[6] = [{ ...RESULT_SETS[6]![0], evidence_json: "not-json" }];
    await expect(
      new FullJsonExportRepository(createRecordingDatabase(invalidSets).database).readSnapshot(),
    ).rejects.toEqual(new FullJsonExportPersistenceError("INVALID_STORED_DATA"));
  });
});
