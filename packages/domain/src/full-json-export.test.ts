import { describe, expect, it } from "vitest";

import {
  FULL_JSON_EXPORT_LIMITS,
  FullJsonExportError,
  createFullJsonExport,
  fullJsonExportV1Schema,
  fullJsonExportSchema,
  normalizeFullJsonExport,
  serializeFullJsonExport,
  type FullJsonExportData,
} from "./full-json-export";
import { CSV_IMPORT_LIMITS } from "./csv-import";

const EMPTY_DATA: FullJsonExportData = {
  budgets: [],
  accounts: [],
  categories: [],
  categoryAudits: [],
  connections: [],
  importBatches: [],
  importRows: [],
  merchantRules: [],
  subscriptionOccurrences: [],
  subscriptions: [],
  transactions: [],
  transferMatchAudits: [],
  transferMatches: [],
};

describe("versioned full JSON export", () => {
  it("upgrades v2 backups to an empty budget collection and preserves v3 budget history", () => {
    const current = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-09-05T12:00:00.000Z",
      timezone: "America/Toronto",
    });
    const { budgets, ...data } = current.data;
    const { budgets: count, ...recordCounts } = current.recordCounts;
    expect(budgets).toEqual([]);
    expect(count).toBe(0);
    expect(normalizeFullJsonExport({ ...current, data, recordCounts, schemaVersion: 2 })).toEqual(
      current,
    );
    const withBudget = createFullJsonExport({
      data: {
        ...EMPTY_DATA,
        budgets: [
          {
            categoryId: "food",
            currency: "CAD",
            effectiveMonth: "2026-09",
            amountMinor: 50000,
            updatedAt: current.exportedAt,
          },
          {
            categoryId: "food",
            currency: "CAD",
            effectiveMonth: "2026-10",
            amountMinor: null,
            updatedAt: current.exportedAt,
          },
        ],
      },
      exportedAt: current.exportedAt,
      timezone: current.timezone,
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
  it("preserves the historical owner-confirmed credit-card payment evidence", () => {
    const document = createFullJsonExport({
      data: {
        ...EMPTY_DATA,
        transferMatches: [
          {
            id: "match-payment",
            leftTransactionId: "payment-debit",
            rightTransactionId: "payment-credit",
            status: "CONFIRMED",
            confidence: "HIGH",
            decisionReason: "OWNER_CONFIRMED",
            evidence: {
              amountMinor: 1000,
              currency: "CAD",
              dayDifference: 0,
              reason: "CREDIT_CARD_PAYMENT",
              signals: [],
            },
            createdAt: "2026-09-04T12:00:00.000Z",
            updatedAt: "2026-09-04T12:00:00.000Z",
            version: 2,
          },
        ],
      },
      exportedAt: "2026-09-04T12:00:00.000Z",
      timezone: "America/Toronto",
    });
    expect(
      fullJsonExportSchema.parse(JSON.parse(serializeFullJsonExport(document))).data
        .transferMatches[0]?.evidence.reason,
    ).toBe("CREDIT_CARD_PAYMENT");
  });

  it("builds a strict v2 document with exact record counts and portable minor units", () => {
    const document = createFullJsonExport({
      data: {
        ...EMPTY_DATA,
        connections: [
          {
            createdAt: "2026-07-17T12:00:00.000Z",
            id: "connection-1",
            institutionId: "ins_1",
            institutionName: "Fixture Bank",
            updatedAt: "2026-07-17T12:00:00.000Z",
            version: 2,
          },
        ],
        transactions: [
          {
            accountId: null,
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
            plaidPersonalFinanceCategory: null,
            postedDate: "2026-07-17",
            providerTransactionId: null,
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
      recordCounts: { connections: 1, transactions: 1 },
      schemaVersion: 4,
      timezone: "America/Toronto",
    });
    expect(document.data.transactions[0]).toMatchObject({ amountMinor: 1234, currency: "CAD" });
    expect(fullJsonExportSchema.parse(document)).toEqual(document);
  });

  it("normalizes a valid v1 document for restore without inventing ledger records", () => {
    const v2 = createFullJsonExport({
      data: EMPTY_DATA,
      exportedAt: "2026-07-17T12:00:00.000Z",
      timezone: "America/Toronto",
    });
    const {
      budgets: _budgets,
      subscriptionOccurrences: _occurrences,
      subscriptions: _subscriptions,
      ...data
    } = v2.data;
    const {
      budgets: _budgetCount,
      subscriptionOccurrences: _occurrenceCount,
      subscriptions: _subscriptionCount,
      ...recordCounts
    } = v2.recordCounts;
    expect(_budgets).toEqual([]);
    expect(_budgetCount).toBe(0);
    expect(_occurrences).toEqual([]);
    expect(_subscriptions).toEqual([]);
    expect(_occurrenceCount).toBe(0);
    expect(_subscriptionCount).toBe(0);
    const legacy = fullJsonExportV1Schema.parse({
      ...v2,
      data,
      recordCounts,
      schemaVersion: 1,
    });

    expect(normalizeFullJsonExport(legacy)).toMatchObject({
      data: { subscriptionOccurrences: [], subscriptions: [] },
      recordCounts: { subscriptionOccurrences: 0, subscriptions: 0 },
      schemaVersion: 4,
    });
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
          connections: [
            {
              accessTokenCiphertext: "ciphertext-secret",
              createdAt: "2026-07-17T12:00:00.000Z",
              id: "connection-1",
              institutionId: "ins_1",
              institutionName: "Fixture Bank",
              updatedAt: "2026-07-17T12:00:00.000Z",
              version: 1,
            },
          ],
        },
        recordCounts: { ...document.recordCounts, connections: 1 },
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
