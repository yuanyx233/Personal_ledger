import {
  csvImportCommitResponseSchema,
  csvImportPreviewResponseSchema,
  type CsvImportColumnMapping,
} from "@ledger/domain";
import {
  transactionCategoryOverrideResponseSchema,
  transactionDetailResponseSchema,
  transactionListResponseSchema,
} from "@ledger/domain/api-contracts";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";
import { clearCategoryAudits } from "./support/category-audits";

const NOW = "2026-08-31T16:00:00.000Z";
const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-reconciliation",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  () => new Date(NOW),
);

const MAPPING: CsvImportColumnMapping = {
  accountLabel: "Account",
  amount: "Amount",
  currency: "Currency",
  description: "Description",
  direction: "Direction",
  merchant: "Merchant",
  postedDate: "Date",
};

interface ExistingCandidateContract {
  subscriptionOccurrenceId: string | null;
  transactionId: string;
  transactionVersion: number;
}

interface PreviewRowContract {
  existingMatch: {
    candidates: ExistingCandidateContract[];
    disposition: "AUTO_MERGE_EXISTING" | "SUSPECTED_EXISTING";
  } | null;
  rowNumber: number;
}

interface PreviewResponseContract {
  data: {
    preview: {
      id: string;
      reviewRows: PreviewRowContract[];
      rows: PreviewRowContract[];
      version: number;
    };
  };
  meta: { rowsTruncated: boolean };
}

interface CommitResponseContract {
  data: {
    importBatch: {
      counts: {
        autoMerged: number;
        importedNew: number;
        ownerMerged: number;
        skippedDuplicate: number;
        skippedInvalid: number;
        total: number;
      };
      rows: Array<{
        outcome:
          "AUTO_MERGED" | "IMPORTED_NEW" | "OWNER_MERGED" | "SKIPPED_DUPLICATE" | "SKIPPED_INVALID";
        rowNumber: number;
        transactionId: string | null;
      }>;
    };
  };
}

interface ReviewDecision {
  action: "IMPORT_NEW" | "MERGE_EXISTING" | "SKIP";
  candidateTransactionId?: string;
  candidateVersion?: number;
  rowNumber: number;
}

let csrfToken = "";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function readRequest(pathAndQuery: string): Request {
  return new Request(`https://ledger.example/api/v1${pathAndQuery}`);
}

function previewRequest(csv: string, fileName: string): Request {
  return new Request("https://ledger.example/api/v1/imports/csv", {
    body: JSON.stringify({
      contentBase64: base64(new TextEncoder().encode(csv)),
      fileName,
      mapping: MAPPING,
    }),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://ledger.example",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrfToken,
    },
    method: "POST",
  });
}

function commitRequest(input: {
  decisions?: ReviewDecision[];
  id: string;
  idempotencyKey: string;
  version: number;
}): Request {
  return new Request(`https://ledger.example/api/v1/imports/${input.id}/commit`, {
    body: JSON.stringify({
      reviewDecisions: input.decisions ?? [],
      version: input.version,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
      Origin: "https://ledger.example",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrfToken,
    },
    method: "POST",
  });
}

async function preview(csv: string, fileName: string): Promise<PreviewResponseContract> {
  const response = await worker.fetch(previewRequest(csv, fileName), workerEnv);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  return csvImportPreviewResponseSchema.parse(body);
}

async function commit(input: {
  decisions?: ReviewDecision[];
  id: string;
  idempotencyKey: string;
  version: number;
}): Promise<CommitResponseContract> {
  const response = await worker.fetch(commitRequest(input), workerEnv);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return csvImportCommitResponseSchema.parse(body);
}

async function insertManualTransaction(input: {
  accountLabel?: string;
  amountMinor: number;
  categoryId?: string;
  description: string;
  id: string;
  merchantName?: string | null;
  normalizedMerchant?: string | null;
  postedDate: string;
}): Promise<void> {
  await cloudflareEnv.DB.prepare(
    `INSERT INTO transactions (
       id, source, account_label, status, posted_date, amount_minor, direction, currency,
       raw_description, merchant_name, normalized_merchant, category_id,
       categorization_source, needs_review, review_reason, created_at, updated_at, version
     ) VALUES (?, 'MANUAL', ?, 'POSTED', ?, ?, 'OUTFLOW', 'CAD', ?, ?, ?, ?,
       'MANUAL', 0, NULL, ?, ?, 1)`,
  )
    .bind(
      input.id,
      input.accountLabel ?? "RBC Credit",
      input.postedDate,
      input.amountMinor,
      input.description,
      input.merchantName ?? null,
      input.normalizedMerchant ?? null,
      input.categoryId ?? "category-expense-food",
      NOW,
      NOW,
    )
    .run();
}

function oneRowCsv(input: {
  accountLabel?: string;
  amount: string;
  description: string;
  merchant?: string;
  postedDate: string;
}): string {
  return [
    "Date,Description,Merchant,Amount,Direction,Currency,Account",
    [
      input.postedDate,
      input.description,
      input.merchant ?? "",
      input.amount,
      "OUTFLOW",
      "CAD",
      input.accountLabel ?? "RBC Credit",
    ].join(","),
  ].join("\n");
}

function rowByNumber(rows: PreviewRowContract[], rowNumber: number): PreviewRowContract {
  const row = rows.find((candidate) => candidate.rowNumber === rowNumber);
  expect(row, `missing staged row ${rowNumber}`).toBeDefined();
  return row!;
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

beforeEach(async () => {
  await clearCategoryAudits(cloudflareEnv.DB);
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare("DELETE FROM import_rows"),
    cloudflareEnv.DB.prepare("DELETE FROM import_batches"),
    cloudflareEnv.DB.prepare("DELETE FROM subscription_occurrences"),
    cloudflareEnv.DB.prepare("DELETE FROM subscriptions"),
    cloudflareEnv.DB.prepare("DELETE FROM transactions"),
  ]);
});

describe("CSV import reconciliation with the canonical ledger", () => {
  it("auto-merges the unique exact merchant candidate within three days without mutating it", async () => {
    await insertManualTransaction({
      amountMinor: 1845,
      categoryId: "category-expense-shopping",
      description: "Owner note that must be preserved",
      id: "manual-merchant-match",
      merchantName: "Coffee House",
      normalizedMerchant: "coffee house",
      postedDate: "2026-08-20",
    });
    const original = await cloudflareEnv.DB.prepare(
      `SELECT source, category_id, raw_description, version
       FROM transactions WHERE id = 'manual-merchant-match'`,
    ).first();
    const staged = await preview(
      oneRowCsv({
        amount: "18.45",
        description: "COFFEE HSE TERMINAL 001",
        merchant: "Coffee House",
        postedDate: "2026-08-22",
      }),
      "merchant-exact.csv",
    );
    const stagedRow = rowByNumber(staged.data.preview.rows, 2);

    expect(stagedRow.existingMatch).toMatchObject({
      candidates: [{ transactionId: "manual-merchant-match", transactionVersion: 1 }],
      disposition: "AUTO_MERGE_EXISTING",
    });

    const committed = await commit({
      id: staged.data.preview.id,
      idempotencyKey: "reconcile-auto-merchant-0001",
      version: staged.data.preview.version,
    });
    expect(committed.data.importBatch.counts).toEqual({
      autoMerged: 1,
      importedNew: 0,
      ownerMerged: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      total: 1,
    });
    expect(committed.data.importBatch.rows).toEqual([
      expect.objectContaining({
        outcome: "AUTO_MERGED",
        rowNumber: 2,
        transactionId: "manual-merchant-match",
      }),
    ]);
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).resolves.toBe(1);
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT transaction_id, resolution FROM import_rows WHERE row_number = 2",
      ).first(),
    ).resolves.toEqual({
      resolution: "AUTO_MERGED",
      transaction_id: "manual-merchant-match",
    });
    await expect(
      cloudflareEnv.DB.prepare(
        `SELECT source, category_id, raw_description, version
         FROM transactions WHERE id = 'manual-merchant-match'`,
      ).first(),
    ).resolves.toEqual(original);
  });

  it("auto-merges the unique same-day exact description when no merchant is available", async () => {
    await insertManualTransaction({
      amountMinor: 6420,
      categoryId: "category-expense-bills",
      description: "Monthly parking invoice 441",
      id: "manual-description-match",
      postedDate: "2026-08-17",
    });
    const staged = await preview(
      oneRowCsv({
        amount: "64.20",
        description: "Monthly parking invoice 441",
        postedDate: "2026-08-17",
      }),
      "description-exact.csv",
    );

    expect(rowByNumber(staged.data.preview.rows, 2).existingMatch).toMatchObject({
      candidates: [{ transactionId: "manual-description-match", transactionVersion: 1 }],
      disposition: "AUTO_MERGE_EXISTING",
    });
    const committed = await commit({
      id: staged.data.preview.id,
      idempotencyKey: "reconcile-auto-description-0001",
      version: staged.data.preview.version,
    });
    expect(committed.data.importBatch.counts.autoMerged).toBe(1);
    expect(committed.data.importBatch.rows[0]).toMatchObject({
      outcome: "AUTO_MERGED",
      transactionId: "manual-description-match",
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("requires review when a unique manual candidate competes with exact CSV and PLAID targets", async () => {
    const header = "Date,Description,Merchant,Amount,Direction,Currency,Account";
    const collisionRow =
      "2026-08-18,EXACT COLLISION,Collision Merchant,40.00,OUTFLOW,CAD,RBC Credit";
    const original = await preview([header, collisionRow].join("\n"), "collision-original.csv");
    await commit({
      id: original.data.preview.id,
      idempotencyKey: "reconcile-collision-original-0001",
      version: original.data.preview.version,
    });
    await insertManualTransaction({
      amountMinor: 4000,
      description: "EXACT COLLISION",
      id: "manual-collision-candidate",
      merchantName: "Collision Merchant",
      normalizedMerchant: "collision merchant",
      postedDate: "2026-08-18",
    });
    await cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
         id, source, account_label, plaid_transaction_id, status, posted_date,
         amount_minor, direction, currency, raw_description, merchant_name,
         normalized_merchant, category_id, categorization_source, needs_review,
         created_at, updated_at, version
       ) VALUES (
         'plaid-collision-target', 'PLAID', 'RBC Credit', 'plaid-collision-target',
         'POSTED', '2026-08-18', 4000, 'OUTFLOW', 'CAD', 'EXACT COLLISION',
         'Collision Merchant', 'collision merchant', 'category-expense-food',
         'PLAID', 0, ?, ?, 1
       )`,
    )
      .bind(NOW, NOW)
      .run();

    const staged = await preview(
      [
        header,
        collisionRow,
        "2026-08-19,ACTUALLY NEW,Another Merchant,41.00,OUTFLOW,CAD,RBC Credit",
      ].join("\n"),
      "collision-followup.csv",
    );
    expect(rowByNumber(staged.data.preview.rows, 2).existingMatch).toMatchObject({
      candidates: [{ transactionId: "manual-collision-candidate" }],
      disposition: "SUSPECTED_EXISTING",
    });

    const missingDecision = await worker.fetch(
      commitRequest({
        id: staged.data.preview.id,
        idempotencyKey: "reconcile-collision-followup-0001",
        version: staged.data.preview.version,
      }),
      workerEnv,
    );
    expect(missingDecision.status).toBe(422);
  });

  it("requires an explicit staged candidate for an ambiguous owner merge", async () => {
    for (const [id, postedDate] of [
      ["manual-candidate-a", "2026-08-20"],
      ["manual-candidate-b", "2026-08-22"],
    ] as const) {
      await insertManualTransaction({
        amountMinor: 2500,
        description: `Owner transaction ${id}`,
        id,
        merchantName: "Ambiguous Cafe",
        normalizedMerchant: "ambiguous cafe",
        postedDate,
      });
    }
    await insertManualTransaction({
      amountMinor: 9900,
      description: "Not a staged candidate",
      id: "manual-not-staged",
      merchantName: "Ambiguous Cafe",
      normalizedMerchant: "ambiguous cafe",
      postedDate: "2026-08-21",
    });
    const staged = await preview(
      oneRowCsv({
        amount: "25.00",
        description: "AMBIGUOUS CAFE CARD PURCHASE",
        merchant: "Ambiguous Cafe",
        postedDate: "2026-08-21",
      }),
      "ambiguous-owner-merge.csv",
    );
    const stagedRow = rowByNumber(staged.data.preview.rows, 2);
    expect(stagedRow.existingMatch).toMatchObject({ disposition: "SUSPECTED_EXISTING" });
    expect(
      stagedRow.existingMatch?.candidates.map(({ transactionId }) => transactionId).sort(),
    ).toEqual(["manual-candidate-a", "manual-candidate-b"]);

    const missingDecision = await worker.fetch(
      commitRequest({
        id: staged.data.preview.id,
        idempotencyKey: "reconcile-owner-missing-0001",
        version: staged.data.preview.version,
      }),
      workerEnv,
    );
    expect(missingDecision.status).toBe(422);

    const unstagedCandidate = await worker.fetch(
      commitRequest({
        decisions: [
          {
            action: "MERGE_EXISTING",
            candidateTransactionId: "manual-not-staged",
            candidateVersion: 1,
            rowNumber: 2,
          },
        ],
        id: staged.data.preview.id,
        idempotencyKey: "reconcile-owner-unstaged-0001",
        version: staged.data.preview.version,
      }),
      workerEnv,
    );
    expect(unstagedCandidate.status).toBe(422);

    const committed = await commit({
      decisions: [
        {
          action: "MERGE_EXISTING",
          candidateTransactionId: "manual-candidate-b",
          candidateVersion: 1,
          rowNumber: 2,
        },
      ],
      id: staged.data.preview.id,
      idempotencyKey: "reconcile-owner-valid-0001",
      version: staged.data.preview.version,
    });
    expect(committed.data.importBatch.counts.ownerMerged).toBe(1);
    expect(committed.data.importBatch.rows[0]).toMatchObject({
      outcome: "OWNER_MERGED",
      transactionId: "manual-candidate-b",
    });
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT transaction_id, resolution FROM import_rows WHERE row_number = 2",
      ).first(),
    ).resolves.toEqual({
      resolution: "OWNER_MERGED",
      transaction_id: "manual-candidate-b",
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).resolves.toBe(3);
  });

  it("exposes an owner-confirmed CSV transaction through list, detail, and category correction APIs", async () => {
    for (const [id, postedDate] of [
      ["manual-import-candidate-a", "2026-08-20"],
      ["manual-import-candidate-b", "2026-08-22"],
    ] as const) {
      await insertManualTransaction({
        amountMinor: 3100,
        description: `Owner transaction ${id}`,
        id,
        merchantName: "Keep Both Market",
        normalizedMerchant: "keep both market",
        postedDate,
      });
    }
    const staged = await preview(
      oneRowCsv({
        amount: "31.00",
        description: "KEEP BOTH MARKET PURCHASE",
        merchant: "Keep Both Market",
        postedDate: "2026-08-21",
      }),
      "ambiguous-import-new.csv",
    );

    const committed = await commit({
      decisions: [{ action: "IMPORT_NEW", rowNumber: 2 }],
      id: staged.data.preview.id,
      idempotencyKey: "reconcile-owner-import-new-0001",
      version: staged.data.preview.version,
    });
    expect(committed.data.importBatch.counts.importedNew).toBe(1);
    expect(committed.data.importBatch.rows[0]).toMatchObject({ outcome: "IMPORTED_NEW" });
    const importedId = committed.data.importBatch.rows[0]!.transactionId;
    expect(importedId).toMatch(/^csv-/);
    await expect(
      cloudflareEnv.DB.prepare("SELECT source FROM transactions WHERE id = ?")
        .bind(importedId)
        .first<string>("source"),
    ).resolves.toBe("CSV");
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).resolves.toBe(3);

    const listResponse = await worker.fetch(
      readRequest("/transactions?pageSize=10&source=CSV"),
      workerEnv,
    );
    const list = transactionListResponseSchema.parse(await listResponse.json());
    expect(listResponse.status).toBe(200);
    expect(list.data.transactions.map(({ id }) => id)).toContain(importedId);

    const detailResponse = await worker.fetch(
      readRequest(`/transactions/${encodeURIComponent(importedId!)}`),
      workerEnv,
    );
    const detail = transactionDetailResponseSchema.parse(await detailResponse.json());
    expect(detailResponse.status).toBe(200);
    expect(detail.data.transaction).toMatchObject({ id: importedId, source: "CSV", version: 1 });

    const correctionResponse = await worker.fetch(
      new Request(`https://ledger.example/api/v1/transactions/${encodeURIComponent(importedId!)}`, {
        body: JSON.stringify({ categoryId: "category-expense-transportation", version: 1 }),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://ledger.example",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": csrfToken,
        },
        method: "PATCH",
      }),
      workerEnv,
    );
    const corrected = transactionCategoryOverrideResponseSchema.parse(
      await correctionResponse.json(),
    );
    expect(correctionResponse.status).toBe(200);
    expect(corrected.data.transaction).toMatchObject({
      categorizationSource: "MANUAL",
      categoryId: "category-expense-transportation",
      id: importedId,
      needsReview: false,
      source: "CSV",
      version: 2,
    });
  });

  it("returns and accepts a required review decision beyond the first 100 preview rows", async () => {
    for (const [id, postedDate] of [
      ["manual-late-candidate-a", "2026-08-20"],
      ["manual-late-candidate-b", "2026-08-22"],
    ] as const) {
      await insertManualTransaction({
        amountMinor: 90909,
        description: `Late candidate ${id}`,
        id,
        merchantName: "Late Review Merchant",
        normalizedMerchant: "late review merchant",
        postedDate,
      });
    }
    const csv = [
      "Date,Description,Merchant,Amount,Direction,Currency,Account",
      ...Array.from(
        { length: 100 },
        (_, index) =>
          `2026-07-${String((index % 28) + 1).padStart(2, "0")},Unmatched ${index},Merchant ${index},${index + 1}.01,OUTFLOW,CAD,RBC Credit`,
      ),
      "2026-08-21,LATE REVIEW ROW,Late Review Merchant,909.09,OUTFLOW,CAD,RBC Credit",
    ].join("\n");
    const staged = await preview(csv, "review-after-row-100.csv");

    expect(staged.meta.rowsTruncated).toBe(true);
    expect(staged.data.preview.rows).toHaveLength(100);
    expect(staged.data.preview.rows.some(({ rowNumber }) => rowNumber === 102)).toBe(false);
    const lateReview = rowByNumber(staged.data.preview.reviewRows, 102);
    expect(lateReview.existingMatch).toMatchObject({ disposition: "SUSPECTED_EXISTING" });
    const selected = lateReview.existingMatch!.candidates.find(
      ({ transactionId }) => transactionId === "manual-late-candidate-a",
    );
    expect(selected).toBeDefined();

    await insertManualTransaction({
      amountMinor: 90909,
      description: "Candidate added after staging",
      id: "manual-late-current-only",
      merchantName: "Late Review Merchant",
      normalizedMerchant: "late review merchant",
      postedDate: "2026-08-21",
    });
    const replayResponse = await worker.fetch(
      previewRequest(csv, "review-after-row-100.csv"),
      workerEnv,
    );
    expect(replayResponse.status).toBe(200);
    const replayed = csvImportPreviewResponseSchema.parse(await replayResponse.json());
    expect(replayed.meta.replayed).toBe(true);
    expect(replayed.data.preview.reviewRows).toEqual(staged.data.preview.reviewRows);
    await cloudflareEnv.DB.prepare("DELETE FROM transactions WHERE id = ?")
      .bind("manual-late-current-only")
      .run();

    const committed = await commit({
      decisions: [
        {
          action: "MERGE_EXISTING",
          candidateTransactionId: selected!.transactionId,
          candidateVersion: selected!.transactionVersion,
          rowNumber: 102,
        },
      ],
      id: staged.data.preview.id,
      idempotencyKey: "reconcile-late-review-0001",
      version: staged.data.preview.version,
    });
    expect(committed.data.importBatch.counts).toMatchObject({ importedNew: 100, ownerMerged: 1 });
    expect(
      committed.data.importBatch.rows.find(({ rowNumber }) => rowNumber === 102),
    ).toMatchObject({
      outcome: "OWNER_MERGED",
      transactionId: "manual-late-candidate-a",
    });
  });

  it("matches historical manual transactions independently of retired subscription metadata", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO subscriptions (
         id, name, merchant_name, normalized_merchant, account_label, amount_minor,
         currency, category_id, cadence, anchor_day, next_charge_date, status,
         last_error_code, created_at, updated_at, version
       ) VALUES (
         'subscription-reconcile', 'Cloud storage', 'APPLE.COM/BILL TORONTO ON',
         'apple.com/bill toronto on', 'RBC Credit', 1149, 'CAD',
         'category-expense-bills', 'MONTHLY', 22, '2026-09-22', 'ACTIVE',
         NULL, ?, ?, 1
       )`,
    )
      .bind(NOW, NOW)
      .run();
    await insertManualTransaction({
      amountMinor: 1149,
      categoryId: "category-expense-bills",
      description: "Cloud storage",
      id: "manual-subscription-occurrence",
      merchantName: "APPLE.COM/BILL TORONTO ON",
      normalizedMerchant: "apple.com/bill toronto on",
      postedDate: "2026-08-22",
    });
    await cloudflareEnv.DB.prepare(
      `INSERT INTO subscription_occurrences (
         id, subscription_id, scheduled_date, transaction_id, status,
         owner_decision_at, created_at, updated_at, version
       ) VALUES (
         'occurrence-reconcile', 'subscription-reconcile', '2026-08-22',
         'manual-subscription-occurrence', 'GENERATED', NULL, ?, ?, 1
       )`,
    )
      .bind(NOW, NOW)
      .run();
    const staged = await preview(
      oneRowCsv({
        amount: "11.49",
        description: "APPLE BILL 0822",
        merchant: "APPLE.COM/BILL TORONTO ON",
        postedDate: "2026-08-22",
      }),
      "subscription-charge.csv",
    );
    const stagedRow = rowByNumber(staged.data.preview.rows, 2);

    expect(stagedRow.existingMatch).toMatchObject({
      candidates: [
        {
          subscriptionOccurrenceId: null,
          transactionId: "manual-subscription-occurrence",
          transactionVersion: 1,
        },
      ],
      disposition: "AUTO_MERGE_EXISTING",
    });
    const committed = await commit({
      id: staged.data.preview.id,
      idempotencyKey: "reconcile-auto-subscription-0001",
      version: staged.data.preview.version,
    });
    expect(committed.data.importBatch.rows[0]).toMatchObject({
      outcome: "AUTO_MERGED",
      transactionId: "manual-subscription-occurrence",
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).resolves.toBe(1);
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT transaction_id, resolution FROM import_rows WHERE row_number = 2",
      ).first(),
    ).resolves.toEqual({
      resolution: "AUTO_MERGED",
      transaction_id: "manual-subscription-occurrence",
    });
  });
});
