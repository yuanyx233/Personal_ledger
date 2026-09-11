import {
  csvImportCommitResponseSchema,
  csvImportFileNameHash,
  csvImportPreviewResponseSchema,
  fullJsonExportSchema,
  type CsvImportColumnMapping,
} from "@ledger/domain";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;
let currentTime = "2026-07-15T12:00:00.000Z";
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  () => new Date(currentTime),
);

const MAPPING: CsvImportColumnMapping = {
  accountLabel: "Account",
  amount: "Amount",
  currency: "Currency",
  description: "Description",
  direction: "Direction",
  postedDate: "Date",
};
const CSV = [
  "Date,Description,Amount,Direction,Currency,Account",
  "2026-01-15,Existing purchase,12.34,OUTFLOW,CAD,Daily Chequing",
  "2026-01-16,New purchase,20.00,OUTFLOW,CAD,Daily Chequing",
  "2026-01-17,Bad amount,20.999,OUTFLOW,CAD,Daily Chequing",
  "2026-01-16,New purchase,20.00,OUTFLOW,CAD,Daily Chequing",
].join("\n");

let csrfToken: string;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function previewRequest(
  content: Uint8Array = new TextEncoder().encode(CSV),
  mapping: CsvImportColumnMapping | null = MAPPING,
): Request {
  return new Request("https://ledger.example/api/v1/imports/csv", {
    body: JSON.stringify({
      contentBase64: base64(content),
      fileName: "bank.csv",
      ...(mapping === null ? {} : { mapping }),
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
  decisions?: ReadonlyArray<
    | { action: "IMPORT_NEW" | "SKIP"; rowNumber: number }
    | {
        action: "MERGE_EXISTING";
        candidateTransactionId: string;
        candidateVersion: number;
        rowNumber: number;
      }
  >;
  id: string;
  idempotencyKey?: string;
  version: number;
}): Request {
  return new Request(`https://ledger.example/api/v1/imports/${input.id}/commit`, {
    body: JSON.stringify({
      reviewDecisions: input.decisions ?? [],
      version: input.version,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey ?? "csv-commit-request-0001",
      Origin: "https://ledger.example",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrfToken,
    },
    method: "POST",
  });
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

beforeEach(async () => {
  currentTime = "2026-07-15T12:00:00.000Z";
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare("DELETE FROM import_rows"),
    cloudflareEnv.DB.prepare("DELETE FROM import_batches"),
    cloudflareEnv.DB.prepare("DELETE FROM transactions"),
    cloudflareEnv.DB.prepare("DELETE FROM merchant_rules"),
    cloudflareEnv.DB.prepare("DELETE FROM categories WHERE id = 'category-import-custom'"),
  ]);
  await cloudflareEnv.DB.prepare(
    `INSERT INTO transactions (
       id, source, account_id, account_label, plaid_transaction_id,
       pending_transaction_id, import_fingerprint, status, authorized_date,
       posted_date, amount_minor, direction, currency, provider_amount_decimal,
       raw_description, merchant_name, payment_metadata_json, category_id,
       categorization_source, category_rule_id, needs_review, review_reason,
       created_at, updated_at, version
     ) VALUES (
       'existing-transaction', 'MANUAL', NULL, 'Daily Chequing', NULL,
       NULL, NULL, 'POSTED', NULL, '2026-01-15', 1234, 'OUTFLOW', 'CAD', NULL,
       'Existing purchase', NULL, NULL, NULL, 'UNCLASSIFIED', NULL, 1,
       'UNCLASSIFIED_MERCHANT', ?, ?, 1
     )`,
  )
    .bind(currentTime, currentTime)
    .run();
});

describe("two-phase CSV import preview", () => {
  it("rejects unsupported methods and non-contract JSON before parsing CSV", async () => {
    const readResponse = await worker.fetch(
      new Request("https://ledger.example/api/v1/imports/csv"),
      workerEnv,
    );
    expect(readResponse.status).toBe(405);

    const invalidRequest = previewRequest();
    const invalidResponse = await worker.fetch(
      new Request(invalidRequest.url, {
        body: "{}",
        headers: invalidRequest.headers,
        method: "POST",
      }),
      workerEnv,
    );
    expect(invalidResponse.status).toBe(422);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("stages an expiring no-ledger-write preview with valid, invalid, and duplicate counts", async () => {
    const response = await worker.fetch(previewRequest(), workerEnv);
    const parsed = csvImportPreviewResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(parsed.data.preview).toMatchObject({
      adapter: "GENERIC_V1",
      counts: { duplicate: 2, invalid: 1, total: 4, valid: 1 },
      expiresAt: "2026-07-15T12:30:00.000Z",
      fileName: "bank.csv",
      mapping: MAPPING,
      status: "PREVIEWED",
    });
    expect(
      parsed.data.preview.rows.map(({ duplicateEvidence, status }) => ({
        duplicateEvidence,
        status,
      })),
    ).toEqual([
      { duplicateEvidence: "SUSPECTED_EXISTING", status: "DUPLICATE" },
      { duplicateEvidence: null, status: "VALID" },
      { duplicateEvidence: null, status: "INVALID" },
      { duplicateEvidence: "SUSPECTED_SAME_FILE", status: "DUPLICATE" },
    ]);
    expect(parsed.meta).toEqual({
      ledgerTransactionsCreated: 0,
      replayed: false,
      rowsTruncated: false,
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(1);
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM import_batches").first("count"),
    ).resolves.toBe(1);
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM import_rows").first("count"),
    ).resolves.toBe(4);
  });

  it("auto-detects RBC rows, excludes bank identifiers, and replays a sanitized checksum", async () => {
    const header =
      "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$";
    const firstCsv = new TextEncoder().encode(
      [
        header,
        "Visa,4512345678901234,8/22/2026,987654,APPLE.COM/BILL,TORONTO ON,-11.49,",
        "Visa,4512345678901234,8/22/2026,987655,APPLE.COM/BILL,TORONTO ON,-11.49,",
      ].join("\n"),
    );
    const firstResponse = await worker.fetch(previewRequest(firstCsv, null), workerEnv);
    const firstText = await firstResponse.text();
    const first = csvImportPreviewResponseSchema.parse(JSON.parse(firstText)).data.preview;

    expect(firstResponse.status).toBe(201);
    expect(first).toMatchObject({
      adapter: "RBC_CA_V1",
      counts: { duplicate: 1, invalid: 0, total: 2, valid: 1 },
      mapping: null,
    });
    expect(first.rows.map(({ duplicateEvidence }) => duplicateEvidence)).toEqual([
      null,
      "SUSPECTED_SAME_FILE",
    ]);
    expect(first.rows[0]!.canonicalFingerprint).not.toBe(first.rows[1]!.canonicalFingerprint);
    expect(firstText).not.toContain("4512345678901234");
    expect(firstText).not.toContain("987654");
    expect(firstText).not.toContain("987655");
    expect(firstText).not.toContain("Account Number");
    expect(firstText).not.toContain("Cheque Number");
    const stagedRows = await cloudflareEnv.DB.prepare(
      "SELECT raw_json, errors_json FROM import_rows ORDER BY row_number",
    ).all<{ errors_json: string; raw_json: string }>();
    expect(JSON.stringify(stagedRows.results)).not.toContain("4512345678901234");
    expect(JSON.stringify(stagedRows.results)).not.toContain("987654");

    const changedSensitiveColumns = new TextEncoder().encode(
      [
        header,
        "Visa,DIFFERENT-ACCOUNT,8/22/2026,DIFFERENT-CHEQUE-1,APPLE.COM/BILL,TORONTO ON,-11.49,",
        "Visa,DIFFERENT-ACCOUNT,8/22/2026,DIFFERENT-CHEQUE-2,APPLE.COM/BILL,TORONTO ON,-11.49,",
      ].join("\r\n"),
    );
    const replayResponse = await worker.fetch(
      previewRequest(changedSensitiveColumns, null),
      workerEnv,
    );
    const replay = csvImportPreviewResponseSchema.parse(await replayResponse.json());
    expect(replayResponse.status).toBe(200);
    expect(replay.data.preview.id).toBe(first.id);
    expect(replay.meta.replayed).toBe(true);

    const committedResponse = await worker.fetch(
      commitRequest({
        decisions: [{ action: "IMPORT_NEW", rowNumber: 3 }],
        id: first.id,
        idempotencyKey: "csv-rbc-same-file-0001",
        version: first.version,
      }),
      workerEnv,
    );
    const committedBody = await committedResponse.json();
    expect(committedResponse.status, JSON.stringify(committedBody)).toBe(200);
    expect(csvImportCommitResponseSchema.parse(committedBody).data.importBatch.counts).toEqual({
      autoMerged: 0,
      importedNew: 2,
      ownerMerged: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      total: 2,
    });
  });

  it("redacts malformed RBC rows from preview, staging, logs, and the full export", async () => {
    const accountNumber = "4512345678901234";
    const chequeNumber = "987654";
    const header =
      "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$";
    const malformedCsv = new TextEncoder().encode(
      [
        header,
        `UNEXPECTED,Visa,${accountNumber},8/22/2026,${chequeNumber},APPLE.COM/BILL,TORONTO ON,-11.49,`,
        `Visa,${accountNumber},8/22/2026,${chequeNumber},APPLE.COM/BILL,-11.49`,
      ].join("\n"),
    );
    const logs: unknown[] = [];
    const loggingWorker = createAppWorker(
      () => Promise.resolve(IDENTITY),
      {
        write(input) {
          logs.push(input);
          return true;
        },
      },
      () => new Date(currentTime),
    );

    const response = await loggingWorker.fetch(previewRequest(malformedCsv, null), workerEnv);
    const responseText = await response.text();
    const preview = csvImportPreviewResponseSchema.parse(JSON.parse(responseText)).data.preview;
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.every(({ status }) => status === "INVALID")).toBe(true);
    expect(preview.rows.map(({ raw }) => raw)).toEqual([
      {
        accountLabel: "",
        amount: "",
        category: null,
        currency: "",
        description: "",
        direction: "",
        merchant: null,
        postedDate: "",
      },
      {
        accountLabel: "",
        amount: "",
        category: null,
        currency: "",
        description: "",
        direction: "",
        merchant: null,
        postedDate: "",
      },
    ]);

    const staged = await cloudflareEnv.DB.prepare(
      "SELECT raw_json, errors_json, match_evidence_json FROM import_rows ORDER BY row_number",
    ).all();
    const commitResponse = await loggingWorker.fetch(
      commitRequest({
        id: preview.id,
        idempotencyKey: "csv-malformed-rbc-0001",
        version: preview.version,
      }),
      workerEnv,
    );
    expect(commitResponse.status).toBe(200);
    const exportResponse = await loggingWorker.fetch(
      new Request("https://ledger.example/api/v1/exports/data.json"),
      workerEnv,
    );
    expect(exportResponse.status).toBe(200);
    const exportText = await exportResponse.text();

    for (const serialized of [
      responseText,
      JSON.stringify(staged.results),
      JSON.stringify(logs),
      exportText,
    ]) {
      expect(serialized).not.toContain(accountNumber);
      expect(serialized).not.toContain(chequeNumber);
    }
  });

  it("replays an unexpired checksum and refreshes the same staging record after expiry", async () => {
    const first = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    );
    await cloudflareEnv.DB.prepare(
      "DELETE FROM transactions WHERE id = 'existing-transaction'",
    ).run();
    const replayResponse = await worker.fetch(previewRequest(), workerEnv);
    const replay = csvImportPreviewResponseSchema.parse(await replayResponse.json());
    expect(replayResponse.status).toBe(200);
    expect(replay.data.preview.id).toBe(first.data.preview.id);
    expect(replay.data.preview.rows).toEqual(first.data.preview.rows);
    expect(replay.data.preview.reviewRows).toEqual(first.data.preview.reviewRows);
    expect(replay.meta.replayed).toBe(true);

    currentTime = "2026-07-15T12:31:00.000Z";
    const refreshedResponse = await worker.fetch(previewRequest(), workerEnv);
    const refreshed = csvImportPreviewResponseSchema.parse(await refreshedResponse.json());
    expect(refreshedResponse.status).toBe(201);
    expect(refreshed.data.preview.id).toBe(first.data.preview.id);
    expect(refreshed.data.preview.expiresAt).toBe("2026-07-15T13:01:00.000Z");
    expect(refreshed.meta.replayed).toBe(false);
    await expect(
      cloudflareEnv.DB.prepare("SELECT version FROM import_batches").first("version"),
    ).resolves.toBe(2);
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM import_rows").first("count"),
    ).resolves.toBe(4);
  });

  it("refuses to replace committed import provenance with new preview staging", async () => {
    const first = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    );
    await cloudflareEnv.DB.prepare(
      "UPDATE import_batches SET status = 'COMMITTED', committed_at = ? WHERE id = ?",
    )
      .bind(currentTime, first.data.preview.id)
      .run();

    const response = await worker.fetch(previewRequest(), workerEnv);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONFLICT",
        message: "This CSV batch can no longer be replaced by a preview.",
      },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM import_rows").first("count"),
    ).resolves.toBe(4);
  });

  it("requires review for a committed CSV fingerprint and for a PLAID-only ledger match", async () => {
    const committedCsv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-02-01,Previously imported,1.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const firstPreview = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(previewRequest(new TextEncoder().encode(committedCsv)), workerEnv)
      ).json(),
    ).data.preview;
    const firstCommit = await worker.fetch(
      commitRequest({
        id: firstPreview.id,
        idempotencyKey: "csv-existing-fingerprint-0001",
        version: firstPreview.version,
      }),
      workerEnv,
    );
    expect(firstCommit.status).toBe(200);

    await cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
         id, source, account_id, account_label, plaid_transaction_id,
         pending_transaction_id, import_fingerprint, status, authorized_date,
         posted_date, amount_minor, direction, currency, provider_amount_decimal,
         raw_description, merchant_name, payment_metadata_json, category_id,
         categorization_source, category_rule_id, needs_review, review_reason,
         created_at, updated_at, version
       ) VALUES (
         'plaid-preview-only', 'PLAID', NULL, 'Wallet', 'plaid-preview-only',
         NULL, NULL, 'POSTED', NULL, '2026-02-02', 200, 'OUTFLOW', 'CAD', '2.00',
         'Plaid existing', NULL, NULL, NULL, 'PLAID', NULL, 0, NULL, ?, ?, 1
       )`,
    )
      .bind(currentTime, currentTime)
      .run();

    const followupCsv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-02-01,Previously imported,1.00,OUTFLOW,CAD,Wallet",
      "2026-02-02,Plaid existing,2.00,OUTFLOW,CAD,Wallet",
      "2026-02-03,Actually new,3.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const response = await worker.fetch(
      previewRequest(new TextEncoder().encode(followupCsv)),
      workerEnv,
    );
    const preview = csvImportPreviewResponseSchema.parse(await response.json()).data.preview;

    expect(response.status).toBe(201);
    expect(preview.rows.slice(0, 2)).toMatchObject([
      {
        canonicalFingerprint: firstPreview.rows[0]!.canonicalFingerprint,
        duplicateEvidence: "SUSPECTED_EXISTING",
        existingMatch: null,
        status: "DUPLICATE",
      },
      {
        duplicateEvidence: "SUSPECTED_EXISTING",
        existingMatch: null,
        status: "DUPLICATE",
      },
    ]);
    expect(preview.rows[2]).toMatchObject({ duplicateEvidence: null, status: "VALID" });

    const missingDecisions = await worker.fetch(
      commitRequest({
        id: preview.id,
        idempotencyKey: "csv-existing-fingerprint-0002",
        version: preview.version,
      }),
      workerEnv,
    );
    expect(missingDecisions.status).toBe(422);
  });

  it("creates a distinct transaction when the owner chooses IMPORT_NEW for a committed fingerprint", async () => {
    const originalCsv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-02-10,Owner keeps both,4.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const originalPreview = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(previewRequest(new TextEncoder().encode(originalCsv)), workerEnv)
      ).json(),
    ).data.preview;
    const originalCommit = csvImportCommitResponseSchema.parse(
      await (
        await worker.fetch(
          commitRequest({
            id: originalPreview.id,
            idempotencyKey: "csv-owner-new-original-0001",
            version: originalPreview.version,
          }),
          workerEnv,
        )
      ).json(),
    );
    const originalTransactionId = originalCommit.data.importBatch.rows[0]!.transactionId;

    const followupCsv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-02-10,Owner keeps both,4.00,OUTFLOW,CAD,Wallet",
      "2026-02-11,New companion row,5.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const followupPreview = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(previewRequest(new TextEncoder().encode(followupCsv)), workerEnv)
      ).json(),
    ).data.preview;
    expect(followupPreview.rows[0]).toMatchObject({
      canonicalFingerprint: originalPreview.rows[0]!.canonicalFingerprint,
      duplicateEvidence: "SUSPECTED_EXISTING",
      status: "DUPLICATE",
    });

    const commitInput = {
      decisions: [{ action: "IMPORT_NEW" as const, rowNumber: 2 }],
      id: followupPreview.id,
      idempotencyKey: "csv-owner-new-followup-0001",
      version: followupPreview.version,
    };
    const committedResponse = await worker.fetch(commitRequest(commitInput), workerEnv);
    const committed = csvImportCommitResponseSchema.parse(await committedResponse.json());
    expect(committedResponse.status).toBe(200);
    expect(committed.data.importBatch.counts).toEqual({
      autoMerged: 0,
      importedNew: 2,
      ownerMerged: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      total: 2,
    });
    const ownerNewRow = committed.data.importBatch.rows.find(({ rowNumber }) => rowNumber === 2)!;
    expect(ownerNewRow).toMatchObject({ outcome: "IMPORTED_NEW" });
    expect(ownerNewRow.transactionId).not.toBe(originalTransactionId);

    const replayResponse = await worker.fetch(commitRequest(commitInput), workerEnv);
    const replayed = csvImportCommitResponseSchema.parse(await replayResponse.json());
    expect(replayResponse.status).toBe(200);
    expect(replayed.meta.replayed).toBe(true);
    expect(replayed.data.importBatch).toEqual(committed.data.importBatch);

    const ledgerResponse = await worker.fetch(
      new Request("https://ledger.example/api/v1/exports/data.json"),
      workerEnv,
    );
    const ledger = fullJsonExportSchema.parse(await ledgerResponse.json());
    expect(ledgerResponse.status).toBe(200);
    expect(
      ledger.data.transactions.filter(({ description }) => description === "Owner keeps both"),
    ).toHaveLength(2);
    expect(ledger.data.transactions.filter(({ source }) => source === "CSV")).toHaveLength(3);
  });

  it("rejects invalid UTF-8 and duplicate mapping targets before staging", async () => {
    const invalidUtf8 = new Uint8Array([0x44, 0x61, 0x74, 0x65, 0x0a, 0xc3, 0x28]);
    const invalidEncoding = await worker.fetch(previewRequest(invalidUtf8), workerEnv);
    expect(invalidEncoding.status).toBe(422);
    await expect(invalidEncoding.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fieldErrors: { contentBase64: ["CSV_ENCODING_UNSUPPORTED"] },
      },
    });

    const duplicateMapping = await worker.fetch(
      previewRequest(new TextEncoder().encode(CSV), { ...MAPPING, amount: "Description" }),
      workerEnv,
    );
    expect(duplicateMapping.status).toBe(422);
    await expect(duplicateMapping.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fieldErrors: { contentBase64: ["CSV_MAPPING_INVALID"] },
      },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM import_batches").first("count"),
    ).resolves.toBe(0);
  });

  it("returns only the first 100 rows while keeping full staging counts", async () => {
    const csv = [
      "Date,Description,Amount,Direction,Currency,Account",
      ...Array.from(
        { length: 101 },
        (_, index) =>
          `2026-01-${String((index % 28) + 1).padStart(2, "0")},Purchase ${index},1.00,OUTFLOW,CAD,Daily Chequing`,
      ),
    ].join("\n");
    const response = await worker.fetch(previewRequest(new TextEncoder().encode(csv)), workerEnv);
    const parsed = csvImportPreviewResponseSchema.parse(await response.json());
    expect(parsed.data.preview.counts).toEqual({
      duplicate: 0,
      invalid: 0,
      total: 101,
      valid: 101,
    });
    expect(parsed.data.preview.rows).toHaveLength(100);
    expect(parsed.meta.rowsTruncated).toBe(true);
  });

  it("validates an optional category column against bounded active ids or names", async () => {
    const csv = [
      "Date,Description,Amount,Direction,Currency,Account,Category",
      "2026-01-16,Known category,1.00,OUTFLOW,CAD,Daily Chequing,Food & Dining",
      "2026-01-17,Unknown category,1.00,OUTFLOW,CAD,Daily Chequing,Mystery",
    ].join("\n");
    const response = await worker.fetch(
      previewRequest(new TextEncoder().encode(csv), { ...MAPPING, category: "Category" }),
      workerEnv,
    );
    const parsed = csvImportPreviewResponseSchema.parse(await response.json());
    expect(parsed.data.preview.counts).toEqual({
      duplicate: 0,
      invalid: 1,
      total: 2,
      valid: 1,
    });
    expect(parsed.data.preview.rows[1]).toMatchObject({
      errors: [{ code: "INVALID_CATEGORY", field: "category" }],
      status: "INVALID",
    });
  });
});

describe("idempotent CSV import commit", () => {
  it("requires POST, strict JSON, and a valid idempotency key before commit", async () => {
    const preview = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    ).data.preview;
    const read = await worker.fetch(
      new Request(`https://ledger.example/api/v1/imports/${preview.id}/commit`),
      workerEnv,
    );
    expect(read.status).toBe(405);

    const missingKey = commitRequest({
      decisions: [{ action: "SKIP", rowNumber: 2 }],
      id: preview.id,
      version: preview.version,
    });
    missingKey.headers.delete("Idempotency-Key");
    expect((await worker.fetch(missingKey, workerEnv)).status).toBe(422);

    const valid = commitRequest({
      decisions: [{ action: "SKIP", rowNumber: 2 }],
      id: preview.id,
      version: preview.version,
    });
    const unknownField = await worker.fetch(
      new Request(valid.url, {
        body: JSON.stringify({
          extra: true,
          reviewDecisions: [{ action: "SKIP", rowNumber: 2 }],
          version: preview.version,
        }),
        headers: valid.headers,
        method: "POST",
      }),
      workerEnv,
    );
    expect(unknownField.status).toBe(422);
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(1);
  });

  it("atomically commits allowed rows, returns every row result, and retains source provenance", async () => {
    const preview = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    ).data.preview;
    const response = await worker.fetch(
      commitRequest({
        decisions: [{ action: "IMPORT_NEW", rowNumber: 5 }],
        id: preview.id,
        version: preview.version,
      }),
      workerEnv,
    );
    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    const parsed = csvImportCommitResponseSchema.parse(responseBody);
    expect(parsed.data.importBatch.contentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.data.importBatch.rows[0]!.transactionId).toBe("existing-transaction");
    expect(parsed.data.importBatch.rows[1]!.transactionId).toMatch(/^csv-/);
    expect(parsed.data.importBatch.rows[3]!.transactionId).toMatch(/^csv-/);
    expect(parsed).toEqual({
      data: {
        importBatch: {
          committedAt: "2026-07-15T12:00:00.000Z",
          contentChecksum: parsed.data.importBatch.contentChecksum,
          counts: {
            autoMerged: 1,
            importedNew: 2,
            ownerMerged: 0,
            skippedDuplicate: 0,
            skippedInvalid: 1,
            total: 4,
          },
          id: preview.id,
          rows: [
            {
              duplicateEvidence: "SUSPECTED_EXISTING",
              outcome: "AUTO_MERGED",
              rowNumber: 2,
              transactionId: "existing-transaction",
            },
            {
              duplicateEvidence: null,
              outcome: "IMPORTED_NEW",
              rowNumber: 3,
              transactionId: parsed.data.importBatch.rows[1]!.transactionId,
            },
            {
              duplicateEvidence: null,
              outcome: "SKIPPED_INVALID",
              rowNumber: 4,
              transactionId: null,
            },
            {
              duplicateEvidence: "SUSPECTED_SAME_FILE",
              outcome: "IMPORTED_NEW",
              rowNumber: 5,
              transactionId: parsed.data.importBatch.rows[3]!.transactionId,
            },
          ],
          sourceFileNameHash: await csvImportFileNameHash("bank.csv"),
          status: "COMMITTED",
          version: preview.version + 1,
        },
      },
      meta: { replayed: false },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(3);
    const imported = await cloudflareEnv.DB.prepare(
      `SELECT source, status, import_fingerprint, categorization_source, category_id,
              needs_review, review_reason
       FROM transactions WHERE source = 'CSV' ORDER BY posted_date`,
    ).all<{
      categorization_source: string;
      category_id: string;
      import_fingerprint: string;
      needs_review: number;
      review_reason: string | null;
      source: string;
      status: string;
    }>();
    expect(imported.results).toHaveLength(2);
    expect(imported.results[0]).toMatchObject({
      categorization_source: "UNCLASSIFIED",
      category_id: "category-system-unclassified",
      needs_review: 1,
      review_reason: "UNCLASSIFIED_MERCHANT",
      source: "CSV",
      status: "POSTED",
    });
    expect(imported.results[0]!.import_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(imported.results[1]).toMatchObject({ source: "CSV", status: "POSTED" });
  });

  it("replays the original result for the same key and rejects a different key", async () => {
    const preview = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    ).data.preview;
    const request = {
      decisions: [{ action: "SKIP", rowNumber: 5 }] as const,
      id: preview.id,
      idempotencyKey: "csv-commit-replay-0001",
      version: preview.version,
    };
    const firstResponse = await worker.fetch(commitRequest(request), workerEnv);
    const firstBody = await firstResponse.json();
    expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
    const first = csvImportCommitResponseSchema.parse(firstBody);
    const replayResponse = await worker.fetch(
      commitRequest({
        ...request,
        decisions: [{ action: "IMPORT_NEW", rowNumber: 5 }],
      }),
      workerEnv,
    );
    const replay = csvImportCommitResponseSchema.parse(await replayResponse.json());
    expect(replayResponse.status).toBe(200);
    expect(replay.data).toEqual(first.data);
    expect(replay.meta.replayed).toBe(true);
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(2);

    const conflict = await worker.fetch(
      commitRequest({ ...request, idempotencyKey: "csv-commit-replay-0002" }),
      workerEnv,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("requires one decision for every and only suspected duplicate row", async () => {
    const preview = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    ).data.preview;
    for (const decisions of [
      [],
      [{ action: "IMPORT_NEW", rowNumber: 3 }] as const,
      [
        { action: "IMPORT_NEW", rowNumber: 5 },
        { action: "SKIP", rowNumber: 3 },
      ] as const,
    ]) {
      const response = await worker.fetch(
        commitRequest({ decisions: [...decisions], id: preview.id, version: preview.version }),
        workerEnv,
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(1);
  });

  it("rejects stale and expired previews without partial ledger writes", async () => {
    const preview = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    ).data.preview;
    const stale = await worker.fetch(
      commitRequest({
        decisions: [{ action: "SKIP", rowNumber: 5 }],
        id: preview.id,
        version: preview.version + 1,
      }),
      workerEnv,
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT", currentVersion: preview.version },
    });

    currentTime = "2026-07-15T12:31:00.000Z";
    const expired = await worker.fetch(
      commitRequest({
        decisions: [{ action: "SKIP", rowNumber: 5 }],
        id: preview.id,
        version: preview.version,
      }),
      workerEnv,
    );
    expect(expired.status).toBe(409);
    await expect(expired.json()).resolves.toMatchObject({ error: { code: "CONFLICT" } });
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(1);
  });

  it("resolves a fingerprint committed after preview as a row-level duplicate", async () => {
    const firstCsv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-02-01,Shared row,1.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const secondCsv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-02-01,Shared row,1.00,OUTFLOW,CAD,Wallet",
      "2026-02-02,Second row,2.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const first = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(previewRequest(new TextEncoder().encode(firstCsv)), workerEnv)
      ).json(),
    ).data.preview;
    const second = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(previewRequest(new TextEncoder().encode(secondCsv)), workerEnv)
      ).json(),
    ).data.preview;
    await worker.fetch(
      commitRequest({
        id: first.id,
        idempotencyKey: "csv-fingerprint-race-0001",
        version: first.version,
      }),
      workerEnv,
    );

    const response = await worker.fetch(
      commitRequest({
        id: second.id,
        idempotencyKey: "csv-fingerprint-race-0002",
        version: second.version,
      }),
      workerEnv,
    );
    const committed = csvImportCommitResponseSchema.parse(await response.json());
    expect(committed.data.importBatch.counts).toEqual({
      autoMerged: 0,
      importedNew: 1,
      ownerMerged: 0,
      skippedDuplicate: 1,
      skippedInvalid: 0,
      total: 2,
    });
    expect(committed.data.importBatch.rows[0]).toMatchObject({
      duplicateEvidence: "FINGERPRINT_ALREADY_COMMITTED",
      outcome: "SKIPPED_DUPLICATE",
    });
    expect(committed.data.importBatch.rows[0]!.transactionId).toMatch(/^csv-/);
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(3);
  });

  it("applies explicit categories before active exact merchant rules, then unclassified", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO merchant_rules (
         id, normalized_merchant, display_merchant, category_id, active,
         created_at, updated_at, version
       ) VALUES (
         'merchant-rule-import', 'rule merchant', 'Rule Merchant',
         'category-expense-shopping', 1, ?, ?, 1
       )`,
    )
      .bind(currentTime, currentTime)
      .run();
    const csv = [
      "Date,Description,Amount,Direction,Currency,Account,Merchant,Category",
      "2026-03-01,Explicit category,3.00,OUTFLOW,CAD,Wallet,Rule Merchant,Food & Dining",
      "2026-03-02,Rule category,4.00,OUTFLOW,CAD,Wallet,Rule Merchant,",
      "2026-03-03,Needs review,5.00,OUTFLOW,CAD,Wallet,Unknown Merchant,",
    ].join("\n");
    const mapping = { ...MAPPING, category: "Category", merchant: "Merchant" };
    const preview = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(previewRequest(new TextEncoder().encode(csv), mapping), workerEnv)
      ).json(),
    ).data.preview;
    const response = await worker.fetch(
      commitRequest({ id: preview.id, version: preview.version }),
      workerEnv,
    );
    expect(response.status).toBe(200);
    const transactions = await cloudflareEnv.DB.prepare(
      `SELECT posted_date, category_id, categorization_source, category_rule_id,
              normalized_merchant, needs_review
       FROM transactions WHERE source = 'CSV' ORDER BY posted_date`,
    ).all();
    expect(transactions.results).toEqual([
      {
        categorization_source: "MANUAL",
        category_id: "category-expense-food",
        category_rule_id: null,
        needs_review: 0,
        normalized_merchant: "rule merchant",
        posted_date: "2026-03-01",
      },
      {
        categorization_source: "RULE",
        category_id: "category-expense-shopping",
        category_rule_id: "merchant-rule-import",
        needs_review: 0,
        normalized_merchant: "rule merchant",
        posted_date: "2026-03-02",
      },
      {
        categorization_source: "UNCLASSIFIED",
        category_id: "category-system-unclassified",
        category_rule_id: null,
        needs_review: 1,
        normalized_merchant: "unknown merchant",
        posted_date: "2026-03-03",
      },
    ]);
  });

  it("classifies new bank merchants inside commit without a later correction request", async () => {
    const csv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-09-01,AMZN Mktp CA*NEW123 866-216-1072,17.28,OUTFLOW,CAD,RBC Credit",
      "2026-09-02,T&T SUPERMARKET #038 TORONTO,92.93,OUTFLOW,CAD,RBC Credit",
      "2026-09-03,PAYMENT - THANK YOU / PAI EMENT - MERCI,1600.00,INFLOW,CAD,RBC Credit",
      "2026-09-04,Adobe Inc 800-8336687,34.48,INFLOW,CAD,RBC Credit",
      "2026-09-05,Unknown merchant,1.00,OUTFLOW,CAD,RBC Credit",
    ].join("\n");
    const preview = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(new TextEncoder().encode(csv)), workerEnv)).json(),
    ).data.preview;
    const request = { id: preview.id, version: preview.version };
    expect((await worker.fetch(commitRequest(request), workerEnv)).status).toBe(200);
    const read = () =>
      cloudflareEnv.DB.prepare(
        `SELECT posted_date, category_id, categorization_source, direction, needs_review
       FROM transactions WHERE source = 'CSV' ORDER BY posted_date`,
      ).all();
    const result = await read();
    expect(result.results).toEqual([
      {
        posted_date: "2026-09-01",
        category_id: "category-expense-shopping",
        categorization_source: "RULE",
        direction: "OUTFLOW",
        needs_review: 0,
      },
      {
        posted_date: "2026-09-02",
        category_id: "category-expense-food",
        categorization_source: "RULE",
        direction: "OUTFLOW",
        needs_review: 0,
      },
      {
        posted_date: "2026-09-03",
        category_id: "category-system-transfer",
        categorization_source: "RULE",
        direction: "INFLOW",
        needs_review: 0,
      },
      {
        posted_date: "2026-09-04",
        category_id: "category-expense-bills",
        categorization_source: "RULE",
        direction: "INFLOW",
        needs_review: 0,
      },
      {
        posted_date: "2026-09-05",
        category_id: "category-system-unclassified",
        categorization_source: "UNCLASSIFIED",
        direction: "OUTFLOW",
        needs_review: 1,
      },
    ]);
    expect((await worker.fetch(commitRequest(request), workerEnv)).status).toBe(200);
    expect((await read()).results).toEqual(result.results);
  });

  it("uses owner family preferences, exact and explicit priority, and reviews family conflicts", async () => {
    const addRule = (id: string, merchant: string, category: string, active = 1) =>
      cloudflareEnv.DB.prepare(
        `INSERT INTO merchant_rules
        (id, normalized_merchant, display_merchant, category_id, active, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
        .bind(id, merchant, merchant, category, active, currentTime, currentTime)
        .run();
    await addRule("family-amazon", "amzn mktp ca 866-216-1072", "category-expense-other");
    await addRule("family-tnt-a", "t&t supermarket #032 toronto", "category-expense-food");
    await addRule("family-tnt-b", "t&t supermarket #035 toronto", "category-expense-shopping");
    await addRule("inactive-costco", "costco montreal", "category-expense-other", 0);
    const csv = [
      "Date,Description,Amount,Direction,Currency,Account,Category",
      "2026-09-01,AMZN Mktp CA*NEW123 866-216-1072,1.00,OUTFLOW,CAD,RBC Credit,",
      "2026-09-02,T&T SUPERMARKET #038 TORONTO,2.00,OUTFLOW,CAD,RBC Credit,",
      "2026-09-03,T&T SUPERMARKET #032 TORONTO,3.00,OUTFLOW,CAD,RBC Credit,",
      "2026-09-04,AMZN Mktp CA*NEW456 866-216-1072,4.00,OUTFLOW,CAD,RBC Credit,Food & Dining",
      "2026-09-05,WWW COSTCO CA 800-955-2292,5.00,OUTFLOW,CAD,RBC Credit,",
    ].join("\n");
    const preview = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(
          previewRequest(new TextEncoder().encode(csv), { ...MAPPING, category: "Category" }),
          workerEnv,
        )
      ).json(),
    ).data.preview;
    expect(
      (await worker.fetch(commitRequest({ id: preview.id, version: preview.version }), workerEnv))
        .status,
    ).toBe(200);
    const result = await cloudflareEnv.DB.prepare(
      `SELECT category_id, category_rule_id, categorization_source
      FROM transactions WHERE source = 'CSV' ORDER BY posted_date`,
    ).all();
    expect(result.results).toEqual([
      {
        category_id: "category-expense-other",
        category_rule_id: "family-amazon",
        categorization_source: "RULE",
      },
      {
        category_id: "category-system-unclassified",
        category_rule_id: null,
        categorization_source: "UNCLASSIFIED",
      },
      {
        category_id: "category-expense-food",
        category_rule_id: "family-tnt-a",
        categorization_source: "RULE",
      },
      {
        category_id: "category-expense-food",
        category_rule_id: null,
        categorization_source: "MANUAL",
      },
      {
        category_id: "category-expense-shopping",
        category_rule_id: null,
        categorization_source: "RULE",
      },
    ]);
  });

  it("does not assign an inactive built-in category", async () => {
    const preview = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(
          previewRequest(
            new TextEncoder().encode(
              "Date,Description,Amount,Direction,Currency,Account\n2026-09-01,Aesop Toronto,1.00,OUTFLOW,CAD,RBC Credit",
            ),
          ),
          workerEnv,
        )
      ).json(),
    ).data.preview;
    await cloudflareEnv.DB.prepare(
      "UPDATE categories SET active = 0 WHERE id = 'category-expense-shopping'",
    ).run();
    try {
      expect(
        (await worker.fetch(commitRequest({ id: preview.id, version: preview.version }), workerEnv))
          .status,
      ).toBe(200);
      expect(
        await cloudflareEnv.DB.prepare(
          "SELECT category_id FROM transactions WHERE source = 'CSV'",
        ).first("category_id"),
      ).toBe("category-system-unclassified");
    } finally {
      await cloudflareEnv.DB.prepare(
        "UPDATE categories SET active = 1 WHERE id = 'category-expense-shopping'",
      ).run();
    }
  });

  it("rejects a category deactivated after preview and leaves the batch untouched", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
         id, name, kind, system_key, editable, active, created_at, updated_at, version
       ) VALUES ('category-import-custom', 'Import Custom', 'EXPENSE', NULL, 1, 1, ?, ?, 1)`,
    )
      .bind(currentTime, currentTime)
      .run();
    const csv = [
      "Date,Description,Amount,Direction,Currency,Account,Category",
      "2026-04-01,Category changed,6.00,OUTFLOW,CAD,Wallet,Import Custom",
    ].join("\n");
    const preview = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(
          previewRequest(new TextEncoder().encode(csv), { ...MAPPING, category: "Category" }),
          workerEnv,
        )
      ).json(),
    ).data.preview;
    await cloudflareEnv.DB.prepare(
      `UPDATE categories SET active = 0, updated_at = ?, version = version + 1
       WHERE id = 'category-import-custom'`,
    )
      .bind(currentTime)
      .run();

    const response = await worker.fetch(
      commitRequest({ id: preview.id, version: preview.version }),
      workerEnv,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CONFLICT" } });
    await expect(
      cloudflareEnv.DB.prepare("SELECT count(*) AS count FROM transactions").first("count"),
    ).resolves.toBe(1);
    await expect(
      cloudflareEnv.DB.prepare("SELECT status FROM import_batches WHERE id = ?")
        .bind(preview.id)
        .first("status"),
    ).resolves.toBe("PREVIEWED");
  });

  it("rejects an idempotency key already used by another committed batch", async () => {
    const first = csvImportPreviewResponseSchema.parse(
      await (await worker.fetch(previewRequest(), workerEnv)).json(),
    ).data.preview;
    const idempotencyKey = "csv-cross-batch-key-0001";
    const firstCommit = await worker.fetch(
      commitRequest({
        decisions: [{ action: "SKIP", rowNumber: 5 }],
        id: first.id,
        idempotencyKey,
        version: first.version,
      }),
      workerEnv,
    );
    expect(firstCommit.status).toBe(200);
    const anotherCsv = [
      "Date,Description,Amount,Direction,Currency,Account",
      "2026-05-01,Another batch,7.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const second = csvImportPreviewResponseSchema.parse(
      await (
        await worker.fetch(previewRequest(new TextEncoder().encode(anotherCsv)), workerEnv)
      ).json(),
    ).data.preview;

    const conflict = await worker.fetch(
      commitRequest({ id: second.id, idempotencyKey, version: second.version }),
      workerEnv,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });
});
