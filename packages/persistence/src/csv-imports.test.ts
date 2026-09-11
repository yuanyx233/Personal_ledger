import {
  canonicalImportRowKey,
  type CsvImportPreview,
  type CsvImportPreviewRow,
} from "@ledger/domain";
import { describe, expect, it } from "vitest";

import {
  CsvImportCommitPersistenceError,
  CsvImportCommitRepository,
  CsvImportPreviewPersistenceError,
  CsvImportPreviewRepository,
  type CommitCsvImportInput,
} from "./csv-imports";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function recordingDatabase({
  allError,
  allRows = [],
  batchError,
  firstError,
  firstRow = null,
}: {
  allError?: Error;
  allRows?: unknown[];
  batchError?: Error;
  firstError?: Error;
  firstRow?: unknown;
} = {}) {
  const queries: RecordedQuery[] = [];
  const batches: RecordedQuery[][] = [];
  const database = {
    batch(statements: Array<{ __query: RecordedQuery }>) {
      batches.push(statements.map(({ __query }) => __query));
      return batchError ? Promise.reject(batchError) : Promise.resolve([]);
    },
    prepare(sql: string) {
      const query: RecordedQuery = { bindings: [], sql };
      queries.push(query);
      const statement = {
        __query: query,
        all() {
          return allError ? Promise.reject(allError) : Promise.resolve({ results: allRows });
        },
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return statement;
        },
        first() {
          return firstError ? Promise.reject(firstError) : Promise.resolve(firstRow);
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { batches, database, queries };
}

function scriptedCommitDatabase({
  allError,
  allSuccess = true,
  allRows = [],
  batchChanges = [],
  batchError,
  firstError,
  firstRows = [],
}: {
  allError?: Error;
  allSuccess?: boolean;
  allRows?: unknown[][];
  batchChanges?: number[];
  batchError?: Error;
  firstError?: Error;
  firstRows?: unknown[];
}) {
  const queries: RecordedQuery[] = [];
  const batches: RecordedQuery[][] = [];
  let allIndex = 0;
  let firstIndex = 0;
  const database = {
    batch(statements: Array<{ __query: RecordedQuery }>) {
      batches.push(statements.map(({ __query }) => __query));
      return batchError
        ? Promise.reject(batchError)
        : Promise.resolve(
            statements.map((_, index) => ({ meta: { changes: batchChanges[index] ?? 1 } })),
          );
    },
    prepare(sql: string) {
      const query: RecordedQuery = { bindings: [], sql };
      queries.push(query);
      const statement = {
        __query: query,
        all() {
          return allError
            ? Promise.reject(allError)
            : Promise.resolve({ success: allSuccess, results: allRows[allIndex++] ?? [] });
        },
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return statement;
        },
        first() {
          return firstError
            ? Promise.reject(firstError)
            : Promise.resolve(firstRows[firstIndex++] ?? null);
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { batches, database, queries };
}

const RAW = {
  accountLabel: "Daily Chequing",
  amount: "12.34",
  category: null,
  currency: "CAD",
  description: "Fixture transaction",
  direction: "OUTFLOW",
  merchant: null,
  postedDate: "2026-01-15",
} as const;
const DUPLICATE_KEY = canonicalImportRowKey({
  accountLabel: RAW.accountLabel,
  amountMinor: 1234,
  currency: RAW.currency,
  description: RAW.description,
  direction: RAW.direction,
  postedDate: RAW.postedDate,
});
const PREVIEW: CsvImportPreview = {
  adapter: "GENERIC_V1",
  columns: ["Date", "Description", "Amount", "Direction", "Currency", "Account"],
  counts: { duplicate: 0, invalid: 0, total: 1, valid: 1 },
  rows: [
    {
      canonicalFingerprint: "a".repeat(64),
      duplicateEvidence: null,
      duplicateKey: DUPLICATE_KEY,
      errors: [],
      existingMatch: null,
      raw: RAW,
      rowNumber: 2,
      status: "VALID",
    },
  ],
};

function previewRow(
  rowNumber: number,
  raw: Partial<CsvImportPreviewRow["raw"]> = {},
): CsvImportPreviewRow {
  return {
    ...PREVIEW.rows[0]!,
    raw: { ...RAW, ...raw },
    rowNumber,
  };
}

function existingTransactionCandidate(
  rowNumber: number,
  overrides: Partial<{
    category_rule_id: string | null;
    merchant_name: string | null;
    normalized_merchant: string | null;
    owner_rule_active: number | null;
    posted_date: string;
    raw_description: string;
    subscription_name: string | null;
    subscription_normalized_merchant: string | null;
    subscription_occurrence_id: string | null;
    subscription_scheduled_date: string | null;
    transaction_id: string;
    transaction_source: string;
    transaction_version: number;
  }> = {},
) {
  return {
    category_rule_id: null,
    merchant_name: null,
    normalized_merchant: null,
    owner_rule_active: 0,
    posted_date: RAW.postedDate,
    raw_description: RAW.description,
    row_number: rowNumber,
    subscription_name: null,
    subscription_normalized_merchant: null,
    subscription_occurrence_id: null,
    subscription_scheduled_date: null,
    transaction_id: `transaction-${rowNumber}`,
    transaction_source: "MANUAL",
    transaction_version: 1,
    ...overrides,
  };
}

describe("CsvImportPreviewRepository", () => {
  it("uses one prepared JSON candidate join and compares normalized duplicate keys in code", async () => {
    const recording = recordingDatabase({
      allRows: [
        {
          account_label: RAW.accountLabel,
          amount_minor: 1234,
          candidate_key: DUPLICATE_KEY,
          currency: RAW.currency,
          direction: RAW.direction,
          posted_date: RAW.postedDate,
          raw_description: RAW.description,
        },
      ],
    });

    await expect(
      new CsvImportPreviewRepository(recording.database).findSuspectedDuplicateKeys(PREVIEW.rows),
    ).resolves.toEqual(new Set([DUPLICATE_KEY]));
    expect(recording.queries).toHaveLength(1);
    expect(recording.queries[0]!.sql).toContain("FROM json_each(?)");
    expect(recording.queries[0]!.sql).not.toContain(RAW.description);
    expect(recording.queries[0]!.bindings).toHaveLength(1);
  });

  it("returns only bounded active category ids and names as import references", async () => {
    const recording = recordingDatabase({
      allRows: [
        { id: "category-food", name: "Food" },
        { id: "category-income", name: "Income" },
      ],
    });
    await expect(
      new CsvImportPreviewRepository(recording.database).listActiveCategoryReferences(),
    ).resolves.toEqual(new Set(["category-food", "Food", "category-income", "Income"]));
    expect(recording.queries[0]!.sql).toContain("active = 1");
    expect(recording.queries[0]!.sql).toContain("editable = 1");
    expect(recording.queries[0]!.sql).toContain("LIMIT 1000");
  });

  it("returns no candidates without SQL and ignores malformed stored money dimensions", async () => {
    const empty = recordingDatabase();
    await expect(
      new CsvImportPreviewRepository(empty.database).findSuspectedDuplicateKeys([
        { ...PREVIEW.rows[0]!, duplicateKey: null, status: "INVALID" },
      ]),
    ).resolves.toEqual(new Set());
    expect(empty.queries).toHaveLength(0);

    const malformed = recordingDatabase({
      allRows: [
        {
          account_label: RAW.accountLabel,
          amount_minor: 1234,
          candidate_key: DUPLICATE_KEY,
          currency: "EUR",
          direction: "SIDEWAYS",
          posted_date: RAW.postedDate,
          raw_description: RAW.description,
        },
      ],
    });
    await expect(
      new CsvImportPreviewRepository(malformed.database).findSuspectedDuplicateKeys(PREVIEW.rows),
    ).resolves.toEqual(new Set());
  });

  it("maps category and duplicate-candidate read failures to a stable error", async () => {
    for (const operation of [
      (repository: CsvImportPreviewRepository) => repository.listActiveCategoryReferences(),
      (repository: CsvImportPreviewRepository) =>
        repository.findSuspectedDuplicateKeys(PREVIEW.rows),
    ]) {
      const repository = new CsvImportPreviewRepository(
        recordingDatabase({ allError: new Error("private read detail") }).database,
      );
      await expect(operation(repository)).rejects.toEqual(
        new CsvImportPreviewPersistenceError("READ_FAILED"),
      );
    }
  });

  it("auto-matches one unclaimed manual transaction by exact description", async () => {
    const recording = recordingDatabase({
      allRows: [existingTransactionCandidate(2, { normalized_merchant: "different merchant" })],
    });

    const matches = await new CsvImportPreviewRepository(recording.database).findExistingMatches([
      previewRow(2),
    ]);

    expect(matches.get(2)).toEqual({
      candidates: [
        {
          dateDistanceDays: 0,
          description: RAW.description,
          evidence: "DESCRIPTION_EXACT",
          postedDate: RAW.postedDate,
          subscriptionName: null,
          subscriptionOccurrenceId: null,
          transactionId: "transaction-2",
          transactionVersion: 1,
        },
      ],
      disposition: "AUTO_MERGE_EXISTING",
    });
    expect(recording.queries).toHaveLength(1);
    expect(recording.queries[0]!.sql).toContain("ledger_transaction.source");
    expect(recording.queries[0]!.sql).toContain("committed_row.resolution");
    expect(recording.queries[0]!.sql).not.toContain(RAW.description);
  });

  it("uses merchant and owner-rule evidence independently of old subscription metadata", async () => {
    const longDescription = "x".repeat(700);
    const recording = recordingDatabase({
      allRows: [
        existingTransactionCandidate(2, {
          normalized_merchant: "apple",
          posted_date: "2026-01-23",
          raw_description: longDescription,
          subscription_name: "iCloud+",
          subscription_normalized_merchant: "apple",
          subscription_occurrence_id: "occurrence-apple-2026-01",
          subscription_scheduled_date: "2026-01-22",
          transaction_id: "transaction-subscription",
        }),
        existingTransactionCandidate(3, {
          normalized_merchant: "netflix",
          owner_rule_active: 1,
          posted_date: "2026-01-17",
          raw_description: "NETFLIX.COM",
          transaction_id: "transaction-owner-rule",
        }),
      ],
    });

    const matches = await new CsvImportPreviewRepository(recording.database).findExistingMatches([
      previewRow(2, {
        description: "APPLE.COM/BILL",
        merchant: "Apple",
        postedDate: "2026-01-22",
      }),
      previewRow(3, {
        description: "NETFLIX PAYMENT",
        merchant: "Netflix",
        postedDate: "2026-01-15",
      }),
    ]);

    expect(matches.get(2)?.candidates[0]).toMatchObject({
      dateDistanceDays: 1,
      evidence: "MERCHANT_EXACT",
      subscriptionName: null,
      subscriptionOccurrenceId: null,
    });
    expect(matches.get(2)?.candidates[0]?.description).toHaveLength(512);
    expect(matches.get(3)?.candidates[0]).toMatchObject({
      dateDistanceDays: 2,
      evidence: "OWNER_RULE_EXACT",
      transactionId: "transaction-owner-rule",
    });
  });

  it("requires review for ambiguous, shared, same-file, or non-manual conflicts", async () => {
    const recording = recordingDatabase({
      allRows: [
        existingTransactionCandidate(2, { transaction_id: "ambiguous-a" }),
        existingTransactionCandidate(2, { transaction_id: "ambiguous-b" }),
        existingTransactionCandidate(3, { transaction_id: "shared" }),
        existingTransactionCandidate(4, { transaction_id: "shared" }),
        existingTransactionCandidate(5, { transaction_id: "same-file" }),
        existingTransactionCandidate(6, { transaction_id: "manual-with-conflict" }),
        existingTransactionCandidate(6, {
          transaction_id: "csv-conflict",
          transaction_source: "CSV",
        }),
      ],
    });
    const sameFile = {
      ...previewRow(5),
      duplicateEvidence: "SUSPECTED_SAME_FILE" as const,
      status: "DUPLICATE" as const,
    };

    const matches = await new CsvImportPreviewRepository(recording.database).findExistingMatches([
      previewRow(2),
      previewRow(3),
      previewRow(4),
      sameFile,
      previewRow(6),
    ]);

    expect(matches.get(2)).toMatchObject({
      candidates: [{ transactionId: "ambiguous-a" }, { transactionId: "ambiguous-b" }],
      disposition: "SUSPECTED_EXISTING",
    });
    for (const rowNumber of [3, 4, 5, 6]) {
      expect(matches.get(rowNumber)?.disposition).toBe("SUSPECTED_EXISTING");
    }
  });

  it("ignores invalid inputs and unrelated candidates without querying unnecessarily", async () => {
    const noQuery = recordingDatabase();
    const invalidDimensions = [
      { ...previewRow(2), status: "INVALID" as const },
      previewRow(3, { amount: "not-money" }),
      previewRow(4, { currency: "EUR" }),
      previewRow(5, { direction: "SIDEWAYS" }),
    ];
    await expect(
      new CsvImportPreviewRepository(noQuery.database).findExistingMatches(invalidDimensions),
    ).resolves.toEqual(new Map());
    expect(noQuery.queries).toHaveLength(0);

    const unrelated = recordingDatabase({
      allRows: [
        existingTransactionCandidate(999),
        existingTransactionCandidate(2, {
          normalized_merchant: "different merchant",
          posted_date: "2026-01-16",
          raw_description: "Different description",
        }),
        existingTransactionCandidate(2, {
          transaction_id: "non-manual-only",
          transaction_source: "PLAID",
        }),
      ],
    });
    await expect(
      new CsvImportPreviewRepository(unrelated.database).findExistingMatches([previewRow(2)]),
    ).resolves.toEqual(new Map());
  });

  it("maps existing-match query failures to a stable read error", async () => {
    const repository = new CsvImportPreviewRepository(
      recordingDatabase({ allError: new Error("private matching detail") }).database,
    );
    await expect(repository.findExistingMatches([previewRow(2)])).rejects.toEqual(
      new CsvImportPreviewPersistenceError("READ_FAILED"),
    );
  });

  it("stages canonical rows in bounded JSON chunks without retaining the original CSV", async () => {
    const recording = recordingDatabase();
    const result = await new CsvImportPreviewRepository(recording.database, {
      createId: () => "import-preview-test",
    }).stagePreview({
      contentChecksum: "b".repeat(64),
      expiresAt: "2026-07-15T12:30:00.000Z",
      now: "2026-07-15T12:00:00.000Z",
      preview: PREVIEW,
      sourceFileNameHash: "d".repeat(64),
    });

    expect(result).toEqual({
      expiresAt: "2026-07-15T12:30:00.000Z",
      id: "import-preview-test",
      kind: "CREATED",
      version: 1,
    });
    expect(recording.batches).toHaveLength(1);
    expect(recording.batches[0]).toHaveLength(2);
    expect(recording.batches[0]![0]!.sql).toContain("source_filename_hash");
    const stagedRows = JSON.parse(recording.batches[0]![1]!.bindings[2] as string) as Array<{
      rawJson: string;
    }>;
    expect(JSON.parse(stagedRows[0]!.rawJson)).toEqual(RAW);
    expect(stagedRows[0]!.rawJson).not.toContain("Date,Description");
  });

  it("replays an unexpired checksum without issuing a staging batch", async () => {
    const recording = recordingDatabase({
      allRows: [
        {
          canonical_fingerprint: "a".repeat(64),
          errors_json: JSON.stringify({ duplicateEvidence: null, fieldErrors: [] }),
          match_evidence_json: null,
          raw_json: JSON.stringify(RAW),
          resolution: "UNRESOLVED",
          resolved_at: null,
          row_number: 2,
          transaction_id: null,
          validation_status: "VALID",
        },
      ],
      firstRow: {
        id: "import-preview-existing",
        preview_expires_at: "2026-07-15T12:30:00.000Z",
        status: "PREVIEWED",
        version: 3,
      },
    });
    await expect(
      new CsvImportPreviewRepository(recording.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).resolves.toMatchObject({ id: "import-preview-existing", kind: "REPLAYED", version: 3 });
    expect(recording.batches).toHaveLength(0);
  });

  it("replays the persisted match evidence instead of a newly recalculated preview", async () => {
    const persistedMatch = {
      candidates: [
        {
          dateDistanceDays: 0,
          description: "Original staged candidate",
          evidence: "DESCRIPTION_EXACT",
          postedDate: "2026-01-15",
          subscriptionName: null,
          subscriptionOccurrenceId: null,
          transactionId: "transaction-original",
          transactionVersion: 1,
        },
      ],
      disposition: "AUTO_MERGE_EXISTING",
    } as const;
    const recording = recordingDatabase({
      allRows: [
        {
          canonical_fingerprint: "a".repeat(64),
          errors_json: JSON.stringify({
            duplicateEvidence: "SUSPECTED_EXISTING",
            fieldErrors: [],
          }),
          match_evidence_json: JSON.stringify(persistedMatch),
          raw_json: JSON.stringify(RAW),
          resolution: "UNRESOLVED",
          resolved_at: null,
          row_number: 2,
          transaction_id: null,
          validation_status: "DUPLICATE",
        },
      ],
      firstRow: {
        id: "import-preview-existing",
        preview_expires_at: "2026-07-15T12:30:00.000Z",
        status: "PREVIEWED",
        version: 3,
      },
    });
    const recalculatedPreview: CsvImportPreview = {
      ...PREVIEW,
      rows: [
        {
          ...PREVIEW.rows[0]!,
          existingMatch: {
            candidates: [
              {
                ...persistedMatch.candidates[0],
                description: "Different current candidate",
                transactionId: "transaction-current",
                transactionVersion: 2,
              },
            ],
            disposition: "AUTO_MERGE_EXISTING",
          },
        },
      ],
    };

    const result = await new CsvImportPreviewRepository(recording.database).stagePreview({
      contentChecksum: "b".repeat(64),
      expiresAt: "2026-07-15T12:30:00.000Z",
      now: "2026-07-15T12:00:00.000Z",
      preview: recalculatedPreview,
      sourceFileNameHash: "d".repeat(64),
    });

    expect(result).toMatchObject({
      id: "import-preview-existing",
      kind: "REPLAYED",
      preview: {
        counts: { duplicate: 1, invalid: 0, total: 1, valid: 0 },
        rows: [
          {
            duplicateEvidence: "SUSPECTED_EXISTING",
            existingMatch: persistedMatch,
            rowNumber: 2,
            status: "DUPLICATE",
          },
        ],
      },
      version: 3,
    });
    expect(recording.batches).toHaveLength(0);
  });

  it("reconstructs persisted invalid rows during an unexpired replay", async () => {
    const fieldErrors = [{ code: "INVALID_AMOUNT", field: "amount" }] as const;
    const recording = recordingDatabase({
      allRows: [
        {
          ...STAGED_VALID_ROW,
          canonical_fingerprint: null,
          errors_json: JSON.stringify({ duplicateEvidence: null, fieldErrors }),
          raw_json: JSON.stringify({ ...RAW, amount: "not-money" }),
          validation_status: "INVALID",
        },
      ],
      firstRow: {
        id: "import-preview-existing",
        preview_expires_at: "2026-07-15T12:30:00.000Z",
        status: "PREVIEWED",
        version: 3,
      },
    });

    await expect(
      new CsvImportPreviewRepository(recording.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).resolves.toMatchObject({
      kind: "REPLAYED",
      preview: {
        counts: { duplicate: 0, invalid: 1, total: 1, valid: 0 },
        rows: [
          {
            canonicalFingerprint: null,
            errors: fieldErrors,
            rowNumber: 2,
            status: "INVALID",
          },
        ],
      },
    });
  });

  it.each([
    ["resolved row", { resolution: "IMPORTED_NEW" }],
    ["linked row", { transaction_id: "transaction-already-linked" }],
    [
      "committed fingerprint evidence",
      {
        errors_json: JSON.stringify({
          duplicateEvidence: "FINGERPRINT_ALREADY_COMMITTED",
          fieldErrors: [],
        }),
      },
    ],
    ["malformed field errors", { errors_json: "not-json" }],
    ["malformed match evidence", { match_evidence_json: JSON.stringify({ candidates: [] }) }],
  ])("rejects corrupted persisted preview state: %s", async (_label, overrides) => {
    const recording = recordingDatabase({
      allRows: [{ ...STAGED_VALID_ROW, ...overrides }],
      firstRow: {
        id: "import-preview-existing",
        preview_expires_at: "2026-07-15T12:30:00.000Z",
        status: "PREVIEWED",
        version: 3,
      },
    });

    await expect(
      new CsvImportPreviewRepository(recording.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).rejects.toEqual(new CsvImportPreviewPersistenceError("READ_FAILED"));
    expect(recording.batches).toHaveLength(0);
  });

  it("sanitizes an unexpired replay row read failure", async () => {
    const recording = recordingDatabase({
      allError: new Error("private staged row detail"),
      firstRow: {
        id: "import-preview-existing",
        preview_expires_at: "2026-07-15T12:30:00.000Z",
        status: "PREVIEWED",
        version: 3,
      },
    });
    await expect(
      new CsvImportPreviewRepository(recording.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).rejects.toEqual(new CsvImportPreviewPersistenceError("READ_FAILED"));
  });

  it("never replaces a committed batch with preview staging rows", async () => {
    const recording = recordingDatabase({
      firstRow: {
        id: "import-preview-committed",
        preview_expires_at: "2026-07-15T11:30:00.000Z",
        status: "COMMITTED",
        version: 2,
      },
    });
    await expect(
      new CsvImportPreviewRepository(recording.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).rejects.toEqual(new CsvImportPreviewPersistenceError("CONFLICT"));
    expect(recording.batches).toHaveLength(0);
  });

  it("refreshes expired staging atomically and sanitizes batch failures", async () => {
    const existing = {
      id: "import-preview-expired",
      preview_expires_at: "2026-07-15T11:30:00.000Z",
      status: "PREVIEWED",
      version: 2,
    };
    const refreshed = recordingDatabase({ firstRow: existing });
    await expect(
      new CsvImportPreviewRepository(refreshed.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).resolves.toMatchObject({ kind: "REFRESHED", version: 3 });
    expect(refreshed.batches[0]![0]!.sql).toContain("DELETE FROM import_rows");
    expect(refreshed.batches[0]![1]!.sql).toContain("UPDATE import_batches");

    const failed = recordingDatabase({ batchError: new Error("private write detail") });
    await expect(
      new CsvImportPreviewRepository(failed.database, {
        createId: () => "import-preview-failed",
      }).stagePreview({
        contentChecksum: "c".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).rejects.toEqual(new CsvImportPreviewPersistenceError("WRITE_FAILED"));
  });

  it("rejects inconsistent counts before SQL and sanitizes database failures", async () => {
    const invalid = recordingDatabase();
    await expect(
      new CsvImportPreviewRepository(invalid.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: { ...PREVIEW, counts: { ...PREVIEW.counts, total: 2 } },
        sourceFileNameHash: "d".repeat(64),
      }),
    ).rejects.toEqual(new CsvImportPreviewPersistenceError("INVALID_INPUT"));
    expect(invalid.queries).toHaveLength(0);

    const failed = recordingDatabase({ firstError: new Error("private database detail") });
    await expect(
      new CsvImportPreviewRepository(failed.database).stagePreview({
        contentChecksum: "b".repeat(64),
        expiresAt: "2026-07-15T12:30:00.000Z",
        now: "2026-07-15T12:00:00.000Z",
        preview: PREVIEW,
        sourceFileNameHash: "d".repeat(64),
      }),
    ).rejects.toEqual(new CsvImportPreviewPersistenceError("READ_FAILED"));
  });
});

const COMMIT_NOW = "2026-07-15T12:00:00.000Z";
const COMMIT_BATCH = {
  committed_at: null,
  content_checksum: "c".repeat(64),
  id: "import-preview-unit",
  idempotency_key: `preview:${"c".repeat(64)}`,
  preview_expires_at: "2026-07-15T12:30:00.000Z",
  source_filename_hash: "d".repeat(64),
  status: "PREVIEWED",
  version: 1,
};
const COMMIT_KEY = "csv-unit-commit-key-0001";
const STAGED_VALID_ROW = {
  canonical_fingerprint: "a".repeat(64),
  errors_json: JSON.stringify({ duplicateEvidence: null, fieldErrors: [] }),
  match_evidence_json: null,
  raw_json: JSON.stringify(RAW),
  resolution: "UNRESOLVED",
  resolved_at: null,
  row_number: 2,
  transaction_id: null,
  validation_status: "VALID",
};
const COMMITTED_BATCH = {
  ...COMMIT_BATCH,
  committed_at: COMMIT_NOW,
  idempotency_key: COMMIT_KEY,
  status: "COMMITTED",
  version: 2,
};
const COMMITTED_IMPORTED_ROW = {
  ...STAGED_VALID_ROW,
  resolution: "IMPORTED_NEW",
  resolved_at: COMMIT_NOW,
  transaction_id: "csv-import-preview-unit-2",
  validation_status: "IMPORTED",
};

function stagedMatchRow({
  disposition,
  rowNumber,
  transactionId,
  transactionVersion = 1,
}: {
  disposition: "AUTO_MERGE_EXISTING" | "SUSPECTED_EXISTING";
  rowNumber: number;
  transactionId: string;
  transactionVersion?: number;
}) {
  return {
    ...STAGED_VALID_ROW,
    canonical_fingerprint: String(rowNumber).repeat(64).slice(0, 64),
    errors_json: JSON.stringify({
      duplicateEvidence: "SUSPECTED_EXISTING",
      fieldErrors: [],
    }),
    match_evidence_json: JSON.stringify({
      candidates: [
        {
          dateDistanceDays: 0,
          description: RAW.description,
          evidence: "DESCRIPTION_EXACT",
          postedDate: RAW.postedDate,
          subscriptionName: null,
          subscriptionOccurrenceId: null,
          transactionId,
          transactionVersion,
        },
      ],
      disposition,
    }),
    row_number: rowNumber,
    validation_status: "DUPLICATE",
  };
}

function commitInput(overrides: Partial<CommitCsvImportInput> = {}): CommitCsvImportInput {
  return {
    batchId: COMMIT_BATCH.id,
    idempotencyKey: COMMIT_KEY,
    now: COMMIT_NOW,
    reviewDecisions: [],
    version: 1 as CommitCsvImportInput["version"],
    ...overrides,
  };
}

describe("CsvImportCommitRepository", () => {
  it("uses prepared atomic statements and returns persisted row-level provenance", async () => {
    const recording = scriptedCommitDatabase({
      allRows: [[STAGED_VALID_ROW], [COMMITTED_IMPORTED_ROW]],
      batchChanges: [1, 1, 1, 1],
      firstRows: [COMMIT_BATCH, null, COMMITTED_BATCH],
    });
    const result = await new CsvImportCommitRepository(recording.database).commit(commitInput());

    expect(result).toMatchObject({
      importBatch: {
        counts: {
          autoMerged: 0,
          importedNew: 1,
          ownerMerged: 0,
          skippedDuplicate: 0,
          skippedInvalid: 0,
          total: 1,
        },
        id: COMMIT_BATCH.id,
        rows: [
          {
            duplicateEvidence: null,
            outcome: "IMPORTED_NEW",
            rowNumber: 2,
            transactionId: COMMITTED_IMPORTED_ROW.transaction_id,
          },
        ],
        sourceFileNameHash: COMMIT_BATCH.source_filename_hash,
        status: "COMMITTED",
        version: 2,
      },
      replayed: false,
    });
    expect(recording.batches).toHaveLength(1);
    expect(recording.batches[0]).toHaveLength(4);
    expect(recording.batches[0]![0]!.sql).toContain("status = 'COMMITTING'");
    expect(recording.batches[0]![1]!.sql).toContain("ON CONFLICT(import_fingerprint) DO NOTHING");
    expect(recording.batches[0]![2]!.sql).toContain("FINGERPRINT_ALREADY_COMMITTED");
    expect(recording.batches[0]![3]!.sql).toContain("'ATOMIC_ABORT'");
    expect(recording.batches[0]!.every(({ sql }) => !sql.includes(RAW.description))).toBe(true);
  });

  it("loads family rules once for a mixed import and keeps unknown merchants unmatched", async () => {
    const descriptions = ["AMZN Mktp CA*NEW123", "T&T SUPERMARKET #038 TORONTO", "Unknown shop"];
    const staged = descriptions.map((description, index) => ({
      ...STAGED_VALID_ROW,
      row_number: index + 2,
      raw_json: JSON.stringify({ ...RAW, description }),
    }));
    const recording = scriptedCommitDatabase({
      allRows: [
        staged,
        [
          { id: "amazon-a", normalized_merchant: "amzn mktp ca*old1" },
          { id: "amazon-b", normalized_merchant: "amazon.ca*old2" },
          { id: "unknown", normalized_merchant: "Unknown shop" },
        ],
        [COMMITTED_IMPORTED_ROW],
      ],
      firstRows: [COMMIT_BATCH, null, COMMITTED_BATCH],
    });
    await new CsvImportCommitRepository(recording.database).commit(commitInput());
    const insert = recording.batches[0]!.find(({ sql }) =>
      sql.includes("INSERT INTO transactions"),
    )!;
    const payload = JSON.parse(insert.bindings[0] as string) as Array<{
      familyRuleIds: string[];
      defaultCategoryId: string | null;
    }>;
    expect(
      payload.map(({ familyRuleIds, defaultCategoryId }) => ({ familyRuleIds, defaultCategoryId })),
    ).toEqual([
      { familyRuleIds: ["amazon-a", "amazon-b"], defaultCategoryId: "category-expense-shopping" },
      { familyRuleIds: [], defaultCategoryId: "category-expense-food" },
      { familyRuleIds: [], defaultCategoryId: null },
    ]);
    expect(
      recording.queries.filter(
        ({ sql }) => sql === "SELECT id, normalized_merchant FROM merchant_rules WHERE active = 1",
      ),
    ).toHaveLength(1);
  });

  it("does not commit when the family-rule catalog cannot be read", async () => {
    const recording = scriptedCommitDatabase({
      allSuccess: false,
      allRows: [
        [
          {
            ...STAGED_VALID_ROW,
            raw_json: JSON.stringify({ ...RAW, merchant: "Amazon.ca*NEW123" }),
          },
        ],
      ],
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(recording.database).commit(commitInput()),
    ).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(recording.batches).toHaveLength(0);
  });

  it("reconstructs a committed replay with imported, invalid, and duplicate outcomes", async () => {
    const invalid = {
      ...STAGED_VALID_ROW,
      canonical_fingerprint: null,
      raw_json: JSON.stringify({ ...RAW, amount: "bad" }),
      row_number: 3,
      resolution: "SKIPPED_INVALID",
      resolved_at: COMMIT_NOW,
      validation_status: "INVALID",
    };
    const duplicate = {
      ...STAGED_VALID_ROW,
      errors_json: JSON.stringify({ duplicateEvidence: "EXACT_REPEAT", fieldErrors: [] }),
      row_number: 4,
      resolution: "SKIPPED_DUPLICATE",
      resolved_at: COMMIT_NOW,
      transaction_id: COMMITTED_IMPORTED_ROW.transaction_id,
      validation_status: "DUPLICATE",
    };
    const recording = scriptedCommitDatabase({
      allRows: [[COMMITTED_IMPORTED_ROW, invalid, duplicate]],
      firstRows: [COMMITTED_BATCH],
    });
    const result = await new CsvImportCommitRepository(recording.database).commit(commitInput());
    expect(result.replayed).toBe(true);
    expect(result.importBatch.counts).toEqual({
      autoMerged: 0,
      importedNew: 1,
      ownerMerged: 0,
      skippedDuplicate: 1,
      skippedInvalid: 1,
      total: 3,
    });
    expect(result.importBatch.rows.map(({ outcome }) => outcome)).toEqual([
      "IMPORTED_NEW",
      "SKIPPED_INVALID",
      "SKIPPED_DUPLICATE",
    ]);
    expect(recording.batches).toHaveLength(0);
  });

  it("commits automatic and owner-approved links without creating new transactions", async () => {
    const automatic = stagedMatchRow({
      disposition: "AUTO_MERGE_EXISTING",
      rowNumber: 2,
      transactionId: "manual-automatic",
    });
    const owner = stagedMatchRow({
      disposition: "SUSPECTED_EXISTING",
      rowNumber: 3,
      transactionId: "manual-owner",
      transactionVersion: 4,
    });
    const committedAutomatic = {
      ...automatic,
      resolution: "AUTO_MERGED",
      resolved_at: COMMIT_NOW,
      transaction_id: "manual-automatic",
      validation_status: "IMPORTED",
    };
    const committedOwner = {
      ...owner,
      resolution: "OWNER_MERGED",
      resolved_at: COMMIT_NOW,
      transaction_id: "manual-owner",
      validation_status: "IMPORTED",
    };
    const recording = scriptedCommitDatabase({
      allRows: [
        [automatic, owner],
        [committedAutomatic, committedOwner],
      ],
      batchChanges: [1, 1, 1],
      firstRows: [COMMIT_BATCH, null, COMMITTED_BATCH],
    });

    const result = await new CsvImportCommitRepository(recording.database).commit(
      commitInput({
        reviewDecisions: [
          {
            action: "MERGE_EXISTING",
            candidateTransactionId: "manual-owner",
            candidateVersion: 4 as CommitCsvImportInput["version"],
            rowNumber: 3,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      importBatch: {
        counts: {
          autoMerged: 1,
          importedNew: 0,
          ownerMerged: 1,
          skippedDuplicate: 0,
          skippedInvalid: 0,
          total: 2,
        },
        rows: [
          { outcome: "AUTO_MERGED", transactionId: "manual-automatic" },
          { outcome: "OWNER_MERGED", transactionId: "manual-owner" },
        ],
      },
      replayed: false,
    });
    expect(recording.batches[0]).toHaveLength(3);
    expect(recording.batches[0]!.some(({ sql }) => sql.includes("INSERT INTO transactions"))).toBe(
      false,
    );
    const mergeRows = JSON.parse(recording.batches[0]![0]!.bindings[9] as string) as Array<{
      resolution: string;
      transactionId: string;
    }>;
    expect(mergeRows).toEqual([
      expect.objectContaining({
        resolution: "AUTO_MERGED",
        transactionId: "manual-automatic",
      }),
      expect.objectContaining({ resolution: "OWNER_MERGED", transactionId: "manual-owner" }),
    ]);
  });

  it("rejects a merge candidate that was not staged or has a stale version", async () => {
    const suspected = stagedMatchRow({
      disposition: "SUSPECTED_EXISTING",
      rowNumber: 2,
      transactionId: "manual-owner",
      transactionVersion: 4,
    });
    for (const decision of [
      {
        action: "MERGE_EXISTING" as const,
        candidateTransactionId: "manual-other",
        candidateVersion: 4 as CommitCsvImportInput["version"],
        rowNumber: 2,
      },
      {
        action: "MERGE_EXISTING" as const,
        candidateTransactionId: "manual-owner",
        candidateVersion: 3 as CommitCsvImportInput["version"],
        rowNumber: 2,
      },
    ]) {
      const recording = scriptedCommitDatabase({
        allRows: [[suspected]],
        firstRows: [COMMIT_BATCH, null],
      });
      await expect(
        new CsvImportCommitRepository(recording.database).commit(
          commitInput({ reviewDecisions: [decision] }),
        ),
      ).rejects.toEqual(new CsvImportCommitPersistenceError("INVALID_INPUT"));
      expect(recording.batches).toHaveLength(0);
    }
  });

  it("rejects two staged rows that would claim the same transaction", async () => {
    const automatic = stagedMatchRow({
      disposition: "AUTO_MERGE_EXISTING",
      rowNumber: 2,
      transactionId: "manual-shared",
    });
    const owner = stagedMatchRow({
      disposition: "SUSPECTED_EXISTING",
      rowNumber: 3,
      transactionId: "manual-shared",
    });
    const recording = scriptedCommitDatabase({
      allRows: [[automatic, owner]],
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(recording.database).commit(
        commitInput({
          reviewDecisions: [
            {
              action: "MERGE_EXISTING",
              candidateTransactionId: "manual-shared",
              candidateVersion: 1 as CommitCsvImportInput["version"],
              rowNumber: 3,
            },
          ],
        }),
      ),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("INVALID_INPUT"));
    expect(recording.batches).toHaveLength(0);
  });

  it("requires decisions for exactly the suspected rows before issuing a write", async () => {
    const suspected = {
      ...STAGED_VALID_ROW,
      errors_json: JSON.stringify({
        duplicateEvidence: "SUSPECTED_EXISTING",
        fieldErrors: [],
      }),
      validation_status: "DUPLICATE",
    };
    for (const decisions of [
      [],
      [{ action: "IMPORT_NEW" as const, rowNumber: 3 }],
      [
        { action: "SKIP" as const, rowNumber: 2 },
        { action: "IMPORT_NEW" as const, rowNumber: 3 },
      ],
    ]) {
      const recording = scriptedCommitDatabase({
        allRows: [[suspected]],
        firstRows: [COMMIT_BATCH, null],
      });
      await expect(
        new CsvImportCommitRepository(recording.database).commit(
          commitInput({ reviewDecisions: decisions }),
        ),
      ).rejects.toEqual(new CsvImportCommitPersistenceError("INVALID_INPUT"));
      expect(recording.batches).toHaveLength(0);
    }
  });

  it("imports a reviewed same-file occurrence with a stable owner-new fingerprint", async () => {
    const sameFile = {
      ...STAGED_VALID_ROW,
      canonical_fingerprint: "b".repeat(64),
      errors_json: JSON.stringify({
        duplicateEvidence: "SUSPECTED_SAME_FILE",
        fieldErrors: [],
      }),
      row_number: 3,
      validation_status: "DUPLICATE",
    };
    const committedSameFile = {
      ...sameFile,
      transaction_id: "csv-import-preview-unit-3",
      resolution: "IMPORTED_NEW",
      resolved_at: COMMIT_NOW,
      validation_status: "IMPORTED",
    };
    const recording = scriptedCommitDatabase({
      allRows: [[sameFile], [committedSameFile]],
      batchChanges: [1, 1, 1, 1],
      firstRows: [COMMIT_BATCH, null, COMMITTED_BATCH],
    });

    await expect(
      new CsvImportCommitRepository(recording.database).commit(
        commitInput({
          reviewDecisions: [{ action: "IMPORT_NEW", rowNumber: 3 }],
        }),
      ),
    ).resolves.toMatchObject({
      importBatch: {
        counts: {
          autoMerged: 0,
          importedNew: 1,
          ownerMerged: 0,
          skippedDuplicate: 0,
          skippedInvalid: 0,
          total: 1,
        },
        rows: [
          {
            duplicateEvidence: "SUSPECTED_SAME_FILE",
            outcome: "IMPORTED_NEW",
            rowNumber: 3,
          },
        ],
      },
    });
    const inserted = JSON.parse(recording.batches[0]![1]!.bindings[0] as string) as Array<{
      fingerprint: string;
    }>;
    expect(inserted[0]!.fingerprint).toBe(
      "99ebf9e8c4da6239b883301d407f5d035cfd328f15a6789631e31180381e5051",
    );
    expect(recording.batches[0]![2]!.bindings[0]).toContain(inserted[0]!.fingerprint);
  });

  it.each([
    ["NOT_FOUND", null, {}],
    ["VERSION_CONFLICT", { ...COMMIT_BATCH, version: 2 }, {}],
    ["PREVIEW_EXPIRED", { ...COMMIT_BATCH, preview_expires_at: "2026-07-15T11:59:59.000Z" }, {}],
    [
      "IDEMPOTENCY_CONFLICT",
      { ...COMMITTED_BATCH, idempotency_key: "different-commit-key-0001" },
      {},
    ],
    ["CONFLICT", { ...COMMIT_BATCH, status: "COMMITTING" }, {}],
    ["READ_FAILED", { ...COMMIT_BATCH, source_filename_hash: null }, {}],
  ])("returns %s for a non-committable batch", async (code, batch, overrides) => {
    const recording = scriptedCommitDatabase({ firstRows: [batch] });
    await expect(
      new CsvImportCommitRepository(recording.database).commit(commitInput(overrides)),
    ).rejects.toMatchObject({ code });
    expect(recording.batches).toHaveLength(0);
  });

  it("rejects a key owned by another batch and sanitizes read/write failures", async () => {
    const owned = scriptedCommitDatabase({
      firstRows: [COMMIT_BATCH, { ...COMMIT_BATCH, id: "import-preview-other" }],
    });
    await expect(
      new CsvImportCommitRepository(owned.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("IDEMPOTENCY_CONFLICT"));

    const readFailed = scriptedCommitDatabase({
      firstError: new Error("private read detail"),
    });
    await expect(
      new CsvImportCommitRepository(readFailed.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("READ_FAILED"));

    const writeFailed = scriptedCommitDatabase({
      allRows: [[STAGED_VALID_ROW]],
      batchError: new Error("private write detail"),
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(writeFailed.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("WRITE_FAILED"));
  });

  it("returns a concurrent committed result when the atomic guard loses the race", async () => {
    const recording = scriptedCommitDatabase({
      allRows: [[STAGED_VALID_ROW], [COMMITTED_IMPORTED_ROW]],
      batchChanges: [0, 0, 0, 0],
      firstRows: [COMMIT_BATCH, null, COMMITTED_BATCH, COMMITTED_BATCH],
    });
    await expect(
      new CsvImportCommitRepository(recording.database).commit(commitInput()),
    ).resolves.toMatchObject({ replayed: true });
  });

  it.each([
    [
      "IDEMPOTENCY_CONFLICT",
      [
        COMMIT_BATCH,
        null,
        COMMIT_BATCH,
        { ...COMMIT_BATCH, id: "import-preview-other", idempotency_key: COMMIT_KEY },
      ],
    ],
    ["CONFLICT", [COMMIT_BATCH, null, COMMIT_BATCH, null]],
  ])("maps a lost atomic guard to %s from current database state", async (code, firstRows) => {
    const recording = scriptedCommitDatabase({
      allRows: [[STAGED_VALID_ROW]],
      batchChanges: [0, 0, 0, 0],
      firstRows,
    });
    await expect(
      new CsvImportCommitRepository(recording.database).commit(commitInput()),
    ).rejects.toMatchObject({ code });
  });

  it("maps finalization and committed readback failures to stable errors", async () => {
    const finalizeFailed = scriptedCommitDatabase({
      allRows: [[STAGED_VALID_ROW]],
      batchChanges: [1, 1, 1, 0],
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(finalizeFailed.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("WRITE_FAILED"));

    const vanished = scriptedCommitDatabase({
      allRows: [[STAGED_VALID_ROW]],
      batchChanges: [1, 1, 1, 1],
      firstRows: [COMMIT_BATCH, null, null],
    });
    await expect(
      new CsvImportCommitRepository(vanished.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("READ_FAILED"));
  });

  it("rejects malformed committed metadata and row outcomes on idempotent replay", async () => {
    for (const batch of [
      { ...COMMITTED_BATCH, committed_at: null },
      { ...COMMITTED_BATCH, content_checksum: "not-a-checksum" },
      { ...COMMITTED_BATCH, source_filename_hash: null },
    ]) {
      const recording = scriptedCommitDatabase({ firstRows: [batch] });
      await expect(
        new CsvImportCommitRepository(recording.database).commit(commitInput()),
      ).rejects.toEqual(new CsvImportCommitPersistenceError("READ_FAILED"));
    }

    for (const row of [
      { ...COMMITTED_IMPORTED_ROW, resolution: "UNRESOLVED" },
      { ...COMMITTED_IMPORTED_ROW, transaction_id: null },
    ]) {
      const recording = scriptedCommitDatabase({
        allRows: [[row]],
        firstRows: [COMMITTED_BATCH],
      });
      await expect(
        new CsvImportCommitRepository(recording.database).commit(commitInput()),
      ).rejects.toEqual(new CsvImportCommitPersistenceError("READ_FAILED"));
    }
  });

  it("rejects malformed selected money and generated transaction identifiers", async () => {
    const malformedMoney = scriptedCommitDatabase({
      allRows: [[{ ...STAGED_VALID_ROW, raw_json: JSON.stringify({ ...RAW, amount: "bad" }) }]],
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(malformedMoney.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("READ_FAILED"));

    const invalidId = scriptedCommitDatabase({
      allRows: [[STAGED_VALID_ROW]],
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(invalidId.database, {
        createTransactionId: () => "",
      }).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("INVALID_INPUT"));
  });

  it("sanitizes an import-row listing failure", async () => {
    const recording = scriptedCommitDatabase({
      allError: new Error("private import row detail"),
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(recording.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("READ_FAILED"));
  });

  it("rejects malformed API identifiers and malformed staged rows", async () => {
    const noSql = scriptedCommitDatabase({});
    await expect(
      new CsvImportCommitRepository(noSql.database).commit(
        commitInput({ idempotencyKey: "short" }),
      ),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("INVALID_INPUT"));
    expect(noSql.queries).toHaveLength(0);

    const malformed = scriptedCommitDatabase({
      allRows: [[{ ...STAGED_VALID_ROW, raw_json: "not-json" }]],
      firstRows: [COMMIT_BATCH, null],
    });
    await expect(
      new CsvImportCommitRepository(malformed.database).commit(commitInput()),
    ).rejects.toEqual(new CsvImportCommitPersistenceError("READ_FAILED"));
  });
});
