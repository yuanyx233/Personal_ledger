import { describe, expect, it } from "vitest";
import { parseTransactionListQuery, parseTransactionCsvExportQuery } from "./api-contracts";
import { spendingReportDrillDownSchema } from "./financial-reporting";
import { reportMerchantFamily } from "./import-categorization";

const drillDown = {
  currency: "CAD",
  dateFrom: "2026-01-01",
  dateTo: "2026-01-31",
  reportMetric: "NET_SPENDING",
};

describe("merchant service groups", () => {
  it.each([
    ["Amazon", "AMZN Mktp CA*ORDER 866-216-1072", "amazon-shopping"],
    ["Amazon Prime", "Amazon.ca prime member amazon.ca/pri", "amazon-prime"],
    ["Uber", "UBER CANADA/UBERTRIP TORONTO", "uber-trip"],
    ["Uber Eats", "UBER CANADA/UBEREATS TORONTO", "uber-eats"],
    ["T&T Supermarket", "T&T SUPERMARKET #038 TORONTO", "t-and-t"],
    ["Shoppers Drug Mart", "SDM 2609 TORONTO", "shoppers"],
    ["Aesop", "AESOP TORONTO EATON CT TORONTO", "aesop"],
  ])("recognizes readable and bank names for %s", (name, bankName, key) => {
    expect(reportMerchantFamily(name)?.key).toBe(key);
    expect(reportMerchantFamily(bankName)?.key).toBe(key);
  });
  it.each([null, "", "Amazonian Hotel", "Shellfish Restaurant", "Unknown Shop"])(
    "keeps unrelated names separate: %s",
    (name) => {
      expect(reportMerchantFamily(name)).toBeNull();
    },
  );
  it.each([parseTransactionListQuery, parseTransactionCsvExportQuery])(
    "validates family filters for lists and exports",
    (parse) => {
      expect(parse(new URLSearchParams({ merchantFamily: "amazon-shopping" })).merchantFamily).toBe(
        "amazon-shopping",
      );
      for (const extra of [{ merchantMissing: "true" }, { normalizedMerchant: "amazon" }]) {
        expect(() =>
          parse(new URLSearchParams({ merchantFamily: "amazon-shopping", ...extra })),
        ).toThrow();
      }
      expect(() => parse(new URLSearchParams({ merchantFamily: "unknown" }))).toThrow();
      expect(() =>
        parse(new URLSearchParams("merchantFamily=amazon-shopping&merchantFamily=amazon-prime")),
      ).toThrow();
    },
  );
  it("keeps a drill-down family mutually exclusive with exact or missing merchant filters", () => {
    expect(
      spendingReportDrillDownSchema.parse({ ...drillDown, merchantFamily: "amazon-shopping" })
        .merchantFamily,
    ).toBe("amazon-shopping");
    for (const extra of [{ merchantMissing: true }, { normalizedMerchant: "amazon" }]) {
      expect(() =>
        spendingReportDrillDownSchema.parse({
          ...drillDown,
          merchantFamily: "amazon-shopping",
          ...extra,
        }),
      ).toThrow();
    }
  });
});
