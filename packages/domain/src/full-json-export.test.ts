import { describe, expect, it } from "vitest";

import {
  FULL_JSON_EXPORT_LIMITS,
  FullJsonExportError,
  createFullJsonExport,
  fullJsonExportSchema,
  normalizeFullJsonExport,
  serializeFullJsonExport,
  type FullJsonExportData,
} from "./full-json-export";
import { CSV_IMPORT_LIMITS } from "./csv-import";

const EMPTY_DATA: FullJsonExportData = {
  budgets: [],
  categories: [],
  categoryAudits: [],
  importBatches: [],
  importRows: [],
  merchantRules: [],
  subscriptionOccurrences: [],
  subscriptions: [],
  transactions: [],
};

describe("versioned full JSON export", () => {
  it("round-trips budget history through serialization and enforces declared counts", () => {
    const exportedAt = "2026-09-05T12:00:00.000Z";
    const withBudget = createFullJsonExport({
      data: {
        ...EMPTY_DATA,
        budgets: [
          {
            categoryId: "food",
            currency: "CAD",
            effectiveMonth: "2026-09",
            amountMinor: 50000,
            updatedAt: exportedAt,
          },
          {
            categoryId: "food",
            currency: "CAD",
            effectiveMonth: "2026-10",
            amountMinor: null,
            updatedAt: exportedAt,
          },
        ],
      },
      exportedAt,
      timezone: "America/Toronto",
    });

    expect(normalizeFullJsonExport(JSON.parse(serializeFullJsonExport(withBudget)))).toEqual(
      withBudget,
    );
    expect(() =>
      fullJsonExportSchema.parse({
        ...withBudget,
        recordCounts: { ...withBudget.recordCounts, budgets: 1 },
      }),
    ).toThrow();
  });

  it("builds a strict document with exact record counts and portable minor units", () => {
    const document = createFullJsonExport({
      data: {
        ...EMPTY_DATA,
        transactions: [
          {
            accountLabel: "Cash",
            amountMinor: 1234,
            reimbursementMinor: 0,
            authorizedDate: null,
            categorizationSource: "UNCLASSIFIED",
            categoryId: null,
            categoryRuleId: null,
            createdAt: "2026-07-17T12:00:00.000Z",
            currency: "CAD",
            description: "Lunch",
            direction: "OUTFLOW",
            id: "transaction-1",
            importFingerprint: null,
            installment: { count: 3, groupId: "installment-group-1", number: 1 },
            merchantName: null,
            needsReview: true,
            normalizedMerchant: null,
            paymentMetadata: {
              payee: null,
              payer: null,
              paymentMethod: null,
              referenceNumber: null,
            },
            pendingTransactionId: null,
            postedDate: "2026-07-17",
            reviewReason: "UNCLASSIFIED_MERCHANT",
            source: "MANUAL",
            status: "POSTED",
            updatedAt: "2026-07-17T12:00:00.000Z",
            version: 1,
          },
        ],
      },
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });

    expect(document).toMatchObject({
      exportKind: "PERSONAL_LEDGER_FULL",
      exportedAt: "2026-07-17T12:00:00.000Z",
      recordCounts: { transactions: 1 },
      schemaVersion: 5,
      timezone: "America/Toronto",
    });
    expect(document.data.transactions[0]).toMatchObject({
      amountMinor: 1234,
      currency: "CAD",
      installment: { count: 3, groupId: "installment-group-1", number: 1 },
    });
    expect(fullJsonExportSchema.parse(document)).toEqual(document);
  });

  it("keeps schema version 5 while accepting any configured zone", () => {
    const berlin = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "Europe/Berlin",
    });
    expect(berlin.timezone).toBe("Europe/Berlin");
    expect(berlin.schemaVersion).toBe(5);

    const toronto = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });
    expect(toronto.timezone).toBe("America/Toronto");
    expect(toronto.schemaVersion).toBe(5);
  });

  it("still validates a backup written before the zone became configurable", () => {
    const beforeChange = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });
    expect(fullJsonExportSchema.safeParse(beforeChange).success).toBe(true);
  });

  it("rejects an unusable zone rather than storing it in a backup", () => {
    for (const timezone of ["", "Not/AZone", "+05:00"]) {
      expect(() =>
        createFullJsonExport({
          data: EMPTY_DATA,
          exportedAt: "2026-07-17T12:00:00.000Z",
          timezone,
        }),
      ).toThrow();
    }
  });

  it("carries no removed bank-synchronization record set", () => {
    const document = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });

    for (const key of ["accounts", "connections", "transferMatchAudits", "transferMatches"]) {
      expect(document.data).not.toHaveProperty(key);
      expect(document.recordCounts).not.toHaveProperty(key);
    }
  });

  it("rejects a pre-reduction backup instead of silently discarding its removed records", () => {
    const document = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });
    const legacy = {
      ...document,
      data: { ...document.data, connections: [], transferMatches: [] },
      recordCounts: { ...document.recordCounts, connections: 0, transferMatches: 0 },
      schemaVersion: 4,
    };

    expect(() => normalizeFullJsonExport(legacy)).toThrow();
  });

  it("rejects unknown fields at every boundary and inconsistent declared counts", () => {
    const document = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });

    expect(() =>
      fullJsonExportSchema.parse({ ...document, accessToken: "access-secret" }),
    ).toThrow();
    expect(() =>
      fullJsonExportSchema.parse({
        ...document,
        data: {
          ...document.data,
          categories: [
            {
              accessTokenCiphertext: "ciphertext-secret",
              active: true,
              createdAt: "2026-07-17T12:00:00.000Z",
              editable: true,
              id: "category-1",
              kind: "EXPENSE",
              name: "Food",
              systemKey: null,
              updatedAt: "2026-07-17T12:00:00.000Z",
              version: 1,
            },
          ],
        },
        recordCounts: { ...document.recordCounts, categories: 1 },
      }),
    ).toThrow();
    expect(() =>
      fullJsonExportSchema.parse({
        ...document,
        recordCounts: { ...document.recordCounts, transactions: 1 },
      }),
    ).toThrow();
  });

  it("rejects oversized raw CSV cells before restore SQL generation", () => {
    expect(() =>
      createFullJsonExport({
        data: {
          ...EMPTY_DATA,
          importRows: [
            {
              batchId: "batch-1",
              canonicalFingerprint: null,
              createdAt: "2026-07-17T12:00:00.000Z",
              errors: [],
              id: "row-1",
              matchEvidence: null,
              raw: {
                accountLabel: "Account",
                amount: "1.00",
                category: null,
                currency: "CAD",
                description: "x".repeat(CSV_IMPORT_LIMITS.CELL_CHARACTERS + 1),
                direction: "OUTFLOW",
                merchant: null,
                postedDate: "2026-07-17",
              },
              resolution: "UNRESOLVED",
              resolvedAt: null,
              rowNumber: 2,
              transactionId: null,
              validationStatus: "VALID",
            },
          ],
        },
        exportedAt: "2026-07-17T12:00:00.000Z",
        timezone: "America/Toronto",
      }),
    ).toThrow();
  });

  it("fails before returning a partial file when the UTF-8 byte limit is exceeded", () => {
    const document = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });

    expect(FULL_JSON_EXPORT_LIMITS.BYTES).toBe(32 * 1024 * 1024);
    expect(() => serializeFullJsonExport(document, { maximumBytes: 32 })).toThrow(
      new FullJsonExportError("OUTPUT_TOO_LARGE"),
    );
    expect(serializeFullJsonExport(document)).toBe(`${JSON.stringify(document)}\n`);
  });
});
