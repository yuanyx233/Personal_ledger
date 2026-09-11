import { describe, expect, it } from "vitest";

import {
  TRANSACTION_CSV_HEADERS,
  TransactionCsvExportError,
  minorUnitsToCsvDecimal,
  neutralizeSpreadsheetText,
  restoreSpreadsheetText,
  serializeTransactionCsv,
  type TransactionCsvRow,
} from "./transaction-csv-export";

const ROW: TransactionCsvRow = {
  accountId: "account-1",
  accountLabel: "Daily Chequing",
  amountMinor: 1234,
  authorizedDate: "2026-01-14",
  bankConfirmation: "AUTO_MERGED",
  categorizationSource: "RULE",
  categoryId: "category-food",
  categoryName: "Food",
  categoryRuleDisplayMerchant: "Fixture Cafe",
  categoryRuleId: "rule-1",
  currency: "CAD",
  description: "Coffee",
  direction: "OUTFLOW",
  id: "transaction-1",
  importMatchCount: 1,
  merchantName: "Fixture Cafe",
  needsReview: false,
  normalizedMerchant: "fixture cafe",
  plaidPfcConfidence: "HIGH",
  plaidPfcDetailed: "FOOD_AND_DRINK_COFFEE",
  plaidPfcPrimary: "FOOD_AND_DRINK",
  postedDate: "2026-01-15",
  reviewReason: null,
  source: "PLAID",
  status: "POSTED",
  subscriptionId: "subscription-1",
  subscriptionScheduledDate: "2026-01-15",
};

describe("transaction CSV export", () => {
  it("exports the original, reimbursed, and personal portions separately", () => {
    const csv = serializeTransactionCsv([
      { ...ROW, amountMinor: 30000, reimbursementMinor: 20000 },
    ]);
    expect(csv).toContain(",30000,300.00,CAD,");
    expect(csv).toContain(",20000,10000\r\n");
  });
  it("uses one stable header order and exact minor-unit-compatible amounts", () => {
    expect(TRANSACTION_CSV_HEADERS).toEqual([
      "transaction_id",
      "posted_date",
      "authorized_date",
      "status",
      "direction",
      "amount_minor",
      "amount",
      "currency",
      "account_id",
      "account",
      "description",
      "merchant",
      "normalized_merchant",
      "category_id",
      "category",
      "categorization_source",
      "category_rule_id",
      "category_rule_merchant",
      "plaid_pfc_primary",
      "plaid_pfc_detailed",
      "plaid_pfc_confidence",
      "source",
      "needs_review",
      "review_reason",
      "subscription_id",
      "subscription_scheduled_date",
      "bank_confirmation",
      "import_match_count",
      "reimbursement_minor",
      "personal_amount_minor",
    ]);
    expect(serializeTransactionCsv([ROW])).toBe(
      `${TRANSACTION_CSV_HEADERS.join(",")}\r\n` +
        "transaction-1,2026-01-15,2026-01-14,POSTED,OUTFLOW,1234,12.34,CAD," +
        "account-1,Daily Chequing,Coffee,Fixture Cafe,fixture cafe,category-food,Food," +
        "RULE,rule-1,Fixture Cafe,FOOD_AND_DRINK,FOOD_AND_DRINK_COFFEE,HIGH,PLAID,false,," +
        "subscription-1,2026-01-15,AUTO_MERGED,1,0,1234\r\n",
    );

    expect(minorUnitsToCsvDecimal(0)).toBe("0.00");
    expect(minorUnitsToCsvDecimal(1)).toBe("0.01");
    expect(minorUnitsToCsvDecimal(105)).toBe("1.05");
    expect(minorUnitsToCsvDecimal(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(() => minorUnitsToCsvDecimal(1.5)).toThrow();
  });

  it("neutralizes every formula marker with a documented character-exact restore path", () => {
    for (const value of [
      "=SUM(A1:A2)",
      "+cmd",
      "-2+3",
      "@IMPORT",
      "\t=1+1",
      "\r=1+1",
      "'already text",
      "''two apostrophes",
      "ordinary text",
    ]) {
      const encoded = neutralizeSpreadsheetText(value);
      expect(restoreSpreadsheetText(encoded)).toBe(value);
      expect(encoded).not.toMatch(/^[=+\-@\t\r]/);
    }

    expect(neutralizeSpreadsheetText("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(neutralizeSpreadsheetText("'already text")).toBe("''already text");
  });

  it("applies formula neutralization before RFC 4180 quoting without losing punctuation or lines", () => {
    const csv = serializeTransactionCsv([
      {
        ...ROW,
        accountLabel: "@account",
        categoryName: "\tFood",
        categoryRuleDisplayMerchant: "'Cafe rule",
        description: '=SUM(A1:A2), "quoted"\nnext line',
        merchantName: "+merchant",
        normalizedMerchant: "-merchant",
        reviewReason: "\rcalculate",
      },
    ]);

    expect(csv).toContain('"\'=SUM(A1:A2), ""quoted""\nnext line"');
    expect(csv).toContain("'@account");
    expect(csv).toContain("'+merchant");
    expect(csv).toContain("'-merchant");
    expect(csv).toContain("'\tFood");
    expect(csv).toContain("''Cafe rule");
    expect(csv).toContain('"\'\rcalculate"');
  });

  it("fails before returning an oversized UTF-8 file", () => {
    expect(() => serializeTransactionCsv([ROW], { maximumBytes: 100 })).toThrow(
      new TransactionCsvExportError("OUTPUT_TOO_LARGE"),
    );
  });
});
