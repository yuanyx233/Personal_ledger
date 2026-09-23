import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostileCsvFixtures } from "./testing";
import {
  CSV_IMPORT_LIMITS,
  CsvImportError,
  applyActiveCategoryReferences,
  applySuspectedDuplicateKeys,
  canonicalImportRowKey,
  csvImportCommitRequestSchema,
  csvImportCommitResponseSchema,
  csvImportContentChecksum,
  csvImportFileNameHash,
  csvImportPreviewRequestSchema,
  decodeCsvBase64,
  parseCsvPreview,
} from "./csv-import";

function chunks(bytes: Uint8Array, chunkSize = bytes.byteLength): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    result.push(bytes.slice(offset, offset + chunkSize));
  }
  return result;
}

const RBC_HEADER =
  "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$";

function rbcCsv(...rows: string[]): Uint8Array {
  return new TextEncoder().encode([RBC_HEADER, ...rows].join("\n"));
}

describe("bounded CSV import parsing", () => {
  const fixtures = createHostileCsvFixtures();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one import below the D1 Free daily write budget", () => {
    expect(CSV_IMPORT_LIMITS.ROWS).toBe(4_000);
  });

  it("incrementally decodes quoted delimiters across chunks", async () => {
    const result = await parseCsvPreview({
      chunks: chunks(fixtures.quotedDelimiter, 7),
      mapping: fixtures.mapping,
    });

    expect(result.counts).toEqual({ duplicate: 0, invalid: 0, total: 1, valid: 1 });
    expect(result.rows[0]).toMatchObject({
      errors: [],
      raw: {
        amount: "12.34",
        description: "Neighbourhood, Market",
      },
      rowNumber: 2,
      status: "VALID",
    });
    expect(result.rows[0]!.canonicalFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a UTF-8 BOM and preserves a multibyte character split across chunks", async () => {
    const bom = await parseCsvPreview({
      chunks: chunks(fixtures.utf8Bom, 5),
      mapping: fixtures.mapping,
    });
    expect(bom.counts.valid).toBe(1);

    const bytes = new TextEncoder().encode(
      "Date,Description,Amount,Direction,Currency,Account,Merchant,Category\n2026-01-15,Café,1.00,OUTFLOW,CAD,Daily Chequing,,",
    );
    const multibyteStart = bytes.indexOf(0xc3);
    const multibyte = await parseCsvPreview({
      chunks: [bytes.slice(0, multibyteStart + 1), bytes.slice(multibyteStart + 1)],
      mapping: fixtures.mapping,
    });
    expect(multibyte.rows[0]!.raw.description).toBe("Café");
  });

  it("auto-detects an exact RBC Visa header and returns only canonical safe fields", async () => {
    const accountNumber = "4512345678901234";
    const chequeNumber = "987654";
    const preview = await parseCsvPreview({
      chunks: [
        rbcCsv(`Visa,${accountNumber},8/22/2026,${chequeNumber},APPLE.COM/BILL,TORONTO ON,-11.49,`),
      ],
    });

    expect(preview).toMatchObject({
      adapter: "RBC_CA_V1",
      columns: ["postedDate", "description", "amount", "direction", "currency", "accountLabel"],
      counts: { duplicate: 0, invalid: 0, total: 1, valid: 1 },
    });
    expect(preview.rows[0]).toMatchObject({
      raw: {
        accountLabel: "RBC Credit",
        amount: "11.49",
        category: null,
        currency: "CAD",
        description: "APPLE.COM/BILL TORONTO ON",
        direction: "OUTFLOW",
        merchant: null,
        postedDate: "2026-08-22",
      },
      status: "VALID",
    });
    expect(preview.rows[0]!.canonicalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(preview)).not.toContain(accountNumber);
    expect(JSON.stringify(preview)).not.toContain(chequeNumber);
    expect(JSON.stringify(preview)).not.toContain("Account Number");
    expect(JSON.stringify(preview)).not.toContain("Cheque Number");
  });

  it("maps RBC Chequing and signed USD amounts without retaining bank identifiers", async () => {
    const preview = await parseCsvPreview({
      chunks: [
        rbcCsv(
          "Chequing,000123456789,8/23/2026,100001,Payroll deposit,,,2500.00",
          "Chequing,000123456789,8/24/2026,100002,Online purchase,,-19.25,",
        ),
      ],
    });

    expect(preview.rows.map(({ raw }) => raw)).toMatchObject([
      {
        accountLabel: "RBC Debit",
        amount: "2500.00",
        currency: "USD",
        direction: "INFLOW",
        postedDate: "2026-08-23",
      },
      {
        accountLabel: "RBC Debit",
        amount: "19.25",
        currency: "CAD",
        direction: "OUTFLOW",
        postedDate: "2026-08-24",
      },
    ]);
    expect(JSON.stringify(preview)).not.toContain("000123456789");
    expect(JSON.stringify(preview)).not.toContain("100001");
    expect(JSON.stringify(preview)).not.toContain("100002");
  });

  it("redacts every source cell from malformed RBC rows before returning raw preview data", async () => {
    const accountNumber = "4512345678901234";
    const chequeNumber = "987654";
    const preview = await parseCsvPreview({
      chunks: [
        rbcCsv(
          `UNEXPECTED,Visa,${accountNumber},8/22/2026,${chequeNumber},APPLE.COM/BILL,TORONTO ON,-11.49,`,
          `Visa,${accountNumber},8/22/2026,${chequeNumber},APPLE.COM/BILL,-11.49`,
        ),
      ],
    });

    const redactedRaw = {
      accountLabel: "",
      amount: "",
      category: null,
      currency: "",
      description: "",
      direction: "",
      merchant: null,
      postedDate: "",
    };
    expect(preview.rows.map(({ raw, status }) => ({ raw, status }))).toEqual([
      { raw: redactedRaw, status: "INVALID" },
      { raw: redactedRaw, status: "INVALID" },
    ]);
    for (const row of preview.rows) {
      expect(row.errors).toContainEqual({ code: "COLUMN_COUNT_MISMATCH", field: "row" });
    }
    expect(JSON.stringify(preview)).not.toContain(accountNumber);
    expect(JSON.stringify(preview)).not.toContain(chequeNumber);
  });

  it("isolates RBC rows when both or neither currency columns contain an amount", async () => {
    const preview = await parseCsvPreview({
      chunks: [
        rbcCsv(
          "Visa,4512345678901234,8/22/2026,,Both currencies,,1.00,2.00",
          "Chequing,000123456789,8/23/2026,,No currency,,,",
        ),
      ],
    });

    expect(preview.counts).toEqual({ duplicate: 0, invalid: 2, total: 2, valid: 0 });
    expect(preview.rows.map(({ errors }) => errors)).toEqual([
      [
        { code: "INVALID_AMOUNT", field: "amount" },
        { code: "INVALID_CURRENCY", field: "currency" },
      ],
      [
        { code: "INVALID_AMOUNT", field: "amount" },
        { code: "INVALID_CURRENCY", field: "currency" },
      ],
    ]);
  });

  it("isolates invalid date, amount, and currency rows with stable field errors", async () => {
    const result = await parseCsvPreview({
      chunks: [fixtures.invalidValues],
      mapping: fixtures.mapping,
    });

    expect(result.counts).toEqual({ duplicate: 0, invalid: 3, total: 3, valid: 0 });
    expect(result.rows.map(({ errors }) => errors)).toEqual([
      [{ code: "INVALID_DATE", field: "postedDate" }],
      [{ code: "INVALID_AMOUNT", field: "amount" }],
      [{ code: "INVALID_CURRENCY", field: "currency" }],
    ]);
  });

  it("imports any two-decimal currency, not only the two this ledger started with", async () => {
    const result = await parseCsvPreview({
      chunks: [fixtures.otherCurrency],
      mapping: fixtures.mapping,
    });

    expect(result.counts).toEqual({ duplicate: 0, invalid: 0, total: 1, valid: 1 });
    expect(result.rows[0]?.raw.currency).toBe("EUR");
  });

  it("keeps formula-like text inert and gives later same-file rows separate reviewable identities", async () => {
    const formula = await parseCsvPreview({
      chunks: [fixtures.formulas],
      mapping: fixtures.mapping,
    });
    expect(formula.rows.map(({ raw }) => raw.description)).toEqual([
      '=HYPERLINK("https://evil.invalid","click")',
      "+SUM(1,1)",
      "@SUM(1,1)",
    ]);

    const repeated = await parseCsvPreview({
      chunks: [fixtures.exactRepeats],
      mapping: fixtures.mapping,
    });
    expect(repeated.counts).toEqual({ duplicate: 1, invalid: 0, total: 2, valid: 1 });
    expect(
      repeated.rows.map(({ duplicateEvidence, status }) => ({ duplicateEvidence, status })),
    ).toEqual([
      { duplicateEvidence: null, status: "VALID" },
      { duplicateEvidence: "SUSPECTED_SAME_FILE", status: "DUPLICATE" },
    ]);
    expect(repeated.rows[0]!.canonicalFingerprint).not.toBe(repeated.rows[1]!.canonicalFingerprint);
    expect(repeated.rows[0]!.duplicateKey).toBe(repeated.rows[1]!.duplicateKey);
  });

  it("handles CRLF, escaped quotes, omitted optional mappings, and a trailing quoted field", async () => {
    const bytes = new TextEncoder().encode(
      'Date,Description,Amount,Direction,Currency,Account\r\n2026-01-15,"Cafe ""One""",1,INFLOW,USD,"Wallet"',
    );
    const preview = await parseCsvPreview({
      chunks: chunks(bytes, 3),
      mapping: {
        accountLabel: "Account",
        amount: "Amount",
        currency: "Currency",
        description: "Description",
        direction: "Direction",
        postedDate: "Date",
      },
    });
    expect(preview.rows[0]).toMatchObject({
      raw: { category: null, description: 'Cafe "One"', merchant: null },
      status: "VALID",
    });
  });

  it.each([
    ["empty input", "", "CSV_SHAPE_INVALID"],
    [
      "unterminated quote",
      'Date,Description,Amount,Direction,Currency,Account\n2026-01-15,"bad',
      "CSV_SHAPE_INVALID",
    ],
    [
      "quote in bare field",
      'Date,Description,Amount,Direction,Currency,Account\n2026-01-15,bad"quote,1.00,OUTFLOW,CAD,Wallet',
      "CSV_SHAPE_INVALID",
    ],
    [
      "text after closing quote",
      'Date,Description,Amount,Direction,Currency,Account\n2026-01-15,"bad"x,1.00,OUTFLOW,CAD,Wallet',
      "CSV_SHAPE_INVALID",
    ],
    [
      "empty header",
      ",Description,Amount,Direction,Currency,Account\n2026-01-15,ok,1.00,OUTFLOW,CAD,Wallet",
      "CSV_MAPPING_INVALID",
    ],
    [
      "duplicate header",
      "Date,Date,Amount,Direction,Currency,Account\n2026-01-15,ok,1.00,OUTFLOW,CAD,Wallet",
      "CSV_MAPPING_INVALID",
    ],
  ])("rejects malformed CSV shape: %s", async (_label, csv, code) => {
    await expect(
      parseCsvPreview({
        chunks: [new TextEncoder().encode(csv)],
        mapping: MAPPING_WITHOUT_OPTIONALS,
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects missing, repeated, and oversized mapping targets", async () => {
    const bytes = new TextEncoder().encode(
      "Date,Description,Amount,Direction,Currency,Account\n2026-01-15,ok,1.00,OUTFLOW,CAD,Wallet",
    );
    for (const mapping of [
      { ...MAPPING_WITHOUT_OPTIONALS, amount: "Missing" },
      { ...MAPPING_WITHOUT_OPTIONALS, amount: "Description" },
      { ...MAPPING_WITHOUT_OPTIONALS, postedDate: "x".repeat(161) },
    ]) {
      await expect(parseCsvPreview({ chunks: [bytes], mapping })).rejects.toMatchObject({
        code: "CSV_MAPPING_INVALID",
      });
    }
  });

  it("isolates column mismatch and all bounded text/direction validations", async () => {
    const longMerchant = "m".repeat(257);
    const longCategory = "c".repeat(161);
    const csv = [
      "Date,Description,Amount,Direction,Currency,Account,Merchant,Category",
      "2026-01-15,,1.00,SIDEWAYS,CAD,,,",
      `2026-01-15,ok,1.00,OUTFLOW,CAD,Wallet,${longMerchant},${longCategory}`,
      "2026-01-15,missing tail,1.00,OUTFLOW,CAD,Wallet",
    ].join("\n");
    const preview = await parseCsvPreview({
      chunks: [new TextEncoder().encode(csv)],
      mapping: fixtures.mapping,
    });
    expect(preview.rows[0]!.errors).toEqual([
      { code: "INVALID_DESCRIPTION", field: "description" },
      { code: "INVALID_DIRECTION", field: "direction" },
      { code: "INVALID_ACCOUNT_LABEL", field: "accountLabel" },
    ]);
    expect(preview.rows[1]!.errors).toEqual([
      { code: "INVALID_MERCHANT", field: "merchant" },
      { code: "INVALID_CATEGORY", field: "category" },
    ]);
    expect(preview.rows[2]!.errors[0]).toEqual({
      code: "COLUMN_COUNT_MISMATCH",
      field: "row",
    });
  });

  it("marks a valid row as a suspected existing-ledger duplicate without deleting it", async () => {
    const parsed = await parseCsvPreview({
      chunks: [fixtures.suspectedDuplicate.csv],
      mapping: fixtures.mapping,
    });
    const duplicateKey = canonicalImportRowKey(fixtures.suspectedDuplicate.existing);
    const marked = applySuspectedDuplicateKeys(parsed, new Set([duplicateKey]));

    expect(marked.counts).toEqual({ duplicate: 1, invalid: 0, total: 1, valid: 0 });
    expect(marked.rows[0]).toMatchObject({
      duplicateEvidence: "SUSPECTED_EXISTING",
      status: "DUPLICATE",
    });
  });

  it("keeps exact active category references and invalidates unknown categories", async () => {
    const bytes = new TextEncoder().encode(
      "Date,Description,Amount,Direction,Currency,Account,Merchant,Category\n2026-01-15,Known,1.00,OUTFLOW,CAD,Daily Chequing,,Groceries\n2026-01-16,Unknown,1.00,OUTFLOW,CAD,Daily Chequing,,Mystery",
    );
    const parsed = await parseCsvPreview({ chunks: [bytes], mapping: fixtures.mapping });
    const validated = applyActiveCategoryReferences(
      parsed,
      new Set(["category-groceries", "Groceries"]),
    );

    expect(validated.counts).toEqual({ duplicate: 0, invalid: 1, total: 2, valid: 1 });
    expect(validated.rows[0]!.canonicalFingerprint).not.toBeNull();
    expect(validated.rows[1]).toMatchObject({
      canonicalFingerprint: null,
      errors: [{ code: "INVALID_CATEGORY", field: "category" }],
      status: "INVALID",
    });
  });

  it.each([
    [
      "invalid UTF-8",
      () => parseCsvPreview({ chunks: [fixtures.invalidUtf8], mapping: fixtures.mapping }),
      "CSV_ENCODING_UNSUPPORTED",
    ],
    [
      "too many rows",
      () => parseCsvPreview({ chunks: [fixtures.oversizedRows], mapping: fixtures.mapping }),
      "CSV_ROW_LIMIT_EXCEEDED",
    ],
    [
      "too many columns",
      () => parseCsvPreview({ chunks: [fixtures.oversizedColumns], mapping: fixtures.mapping }),
      "CSV_COLUMN_LIMIT_EXCEEDED",
    ],
  ])("rejects %s before returning a preview", async (_label, operation, code) => {
    await expect(operation()).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("strictly decodes canonical Base64 and enforces the decoded file limit", () => {
    const encoded = btoa(String.fromCharCode(...fixtures.utf8Bom));
    expect(decodeCsvBase64(encoded)).toEqual(fixtures.utf8Bom);
    expect(() => decodeCsvBase64("not base64")).toThrowError(
      expect.objectContaining({ code: "CSV_BASE64_INVALID" }),
    );
    expect(() => decodeCsvBase64(btoa("x"), 0)).toThrowError(
      expect.objectContaining({ code: "CSV_FILE_LIMIT_EXCEEDED" }),
    );
    expect(() => decodeCsvBase64(btoa("xx"), 1)).toThrowError(
      expect.objectContaining({ code: "CSV_FILE_LIMIT_EXCEEDED" }),
    );
    vi.stubGlobal("atob", () => {
      throw new Error("decoder failure");
    });
    expect(() => decodeCsvBase64("eA==")).toThrowError(
      expect.objectContaining({ code: "CSV_BASE64_INVALID" }),
    );
    expect(new CsvImportError("CSV_SHAPE_INVALID", 422)).toMatchObject({ status: 422 });
  });

  it("defines a strict request contract and checksums canonical mapped content", async () => {
    const contentBase64 = btoa(String.fromCharCode(...fixtures.quotedDelimiter));
    expect(
      csvImportPreviewRequestSchema.parse({
        contentBase64,
        fileName: " ledger.csv ",
        mapping: fixtures.mapping,
      }),
    ).toMatchObject({ fileName: "ledger.csv", mapping: fixtures.mapping });
    expect(
      csvImportPreviewRequestSchema.safeParse({
        contentBase64,
        extra: true,
        fileName: "ledger.csv",
        mapping: fixtures.mapping,
      }).success,
    ).toBe(false);
    for (const invalidRequest of [
      { contentBase64, fileName: "bad\nname.csv", mapping: fixtures.mapping },
      {
        contentBase64,
        fileName: "ledger.csv",
        mapping: { ...fixtures.mapping, postedDate: "Date\u0000" },
      },
    ]) {
      expect(csvImportPreviewRequestSchema.safeParse(invalidRequest).success).toBe(false);
    }

    const firstPreview = await parseCsvPreview({
      chunks: [fixtures.quotedDelimiter],
      mapping: fixtures.mapping,
    });
    const secondPreview = await parseCsvPreview({
      chunks: [fixtures.quotedDelimiter],
      mapping: {
        ...fixtures.mapping,
        description: "Merchant",
        merchant: "Description",
      },
    });
    const first = await csvImportContentChecksum(firstPreview);
    const second = await csvImportContentChecksum(secondPreview);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });

  it("uses a sanitized RBC checksum independent of account, cheque, and source bytes", async () => {
    const first = await parseCsvPreview({
      chunks: [rbcCsv("Visa,4512345678901234,8/22/2026,987654,APPLE.COM/BILL,TORONTO ON,-11.49,")],
    });
    const changedSensitiveColumnsAndLineEndings = await parseCsvPreview({
      chunks: [
        new TextEncoder().encode(
          `${RBC_HEADER}\r\nVisa,DIFFERENT-ACCOUNT,8/22/2026,DIFFERENT-CHEQUE,APPLE.COM/BILL,TORONTO ON,-11.49,\r\n`,
        ),
      ],
    });

    await expect(csvImportContentChecksum(changedSensitiveColumnsAndLineEndings)).resolves.toBe(
      await csvImportContentChecksum(first),
    );
  });

  it("allows native adapter detection to defer mapping until the CSV header is parsed", () => {
    const contentBase64 = btoa(
      String.fromCharCode(...rbcCsv("Visa,4512345678901234,8/22/2026,,APPLE.COM/BILL,,-11.49,")),
    );

    expect(csvImportPreviewRequestSchema.parse({ contentBase64, fileName: "rbc.csv" })).toEqual({
      contentBase64,
      fileName: "rbc.csv",
    });
  });

  it("defines strict versioned commit decisions, row results, and hashed source provenance", async () => {
    const request = {
      reviewDecisions: [
        { action: "IMPORT_NEW", rowNumber: 2 },
        {
          action: "MERGE_EXISTING",
          candidateTransactionId: "transaction-existing",
          candidateVersion: 2,
          rowNumber: 8,
        },
        { action: "SKIP", rowNumber: 9 },
      ],
      version: 1,
    } as const;
    expect(csvImportCommitRequestSchema.parse(request)).toEqual(request);
    for (const invalid of [
      { ...request, extra: true },
      {
        ...request,
        reviewDecisions: [...request.reviewDecisions, request.reviewDecisions[0]],
      },
      { ...request, reviewDecisions: [{ action: "FORCE", rowNumber: 2 }] },
      { ...request, version: 0 },
    ]) {
      expect(csvImportCommitRequestSchema.safeParse(invalid).success).toBe(false);
    }

    const response = {
      data: {
        importBatch: {
          committedAt: "2026-07-15T12:05:00.000Z",
          contentChecksum: "a".repeat(64),
          counts: {
            autoMerged: 0,
            importedNew: 1,
            ownerMerged: 0,
            skippedDuplicate: 1,
            skippedInvalid: 1,
            total: 3,
          },
          id: "import-preview-fixture",
          rows: [
            {
              duplicateEvidence: null,
              outcome: "IMPORTED_NEW",
              rowNumber: 2,
              transactionId: "csv-transaction-2",
            },
            {
              duplicateEvidence: null,
              outcome: "SKIPPED_INVALID",
              rowNumber: 3,
              transactionId: null,
            },
            {
              duplicateEvidence: "EXACT_REPEAT",
              outcome: "SKIPPED_DUPLICATE",
              rowNumber: 4,
              transactionId: null,
            },
          ],
          sourceFileNameHash: "b".repeat(64),
          status: "COMMITTED",
          version: 2,
        },
      },
      meta: { replayed: false },
    } as const;
    expect(csvImportCommitResponseSchema.parse(response)).toEqual(response);
    expect(
      csvImportCommitResponseSchema.safeParse({
        ...response,
        data: {
          importBatch: {
            ...response.data.importBatch,
            counts: { ...response.data.importBatch.counts, importedNew: 2 },
          },
        },
      }).success,
    ).toBe(false);

    const normalized = await csvImportFileNameHash("  bank.csv  ");
    expect(normalized).toMatch(/^[a-f0-9]{64}$/);
    await expect(csvImportFileNameHash("bank.csv")).resolves.toBe(normalized);
    await expect(csvImportFileNameHash("ｂａｎｋ.csv")).resolves.toBe(normalized);
  });
});

const MAPPING_WITHOUT_OPTIONALS = {
  accountLabel: "Account",
  amount: "Amount",
  currency: "Currency",
  description: "Description",
  direction: "Direction",
  postedDate: "Date",
} as const;
