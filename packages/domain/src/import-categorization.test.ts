import { describe, expect, it } from "vitest";
import {
  importedDefaultCategory,
  importedMerchantFamily,
  manualDefaultCategory,
} from "./import-categorization";
import { normalizeMerchantName } from "./merchant-categorization";

describe("CSV merchant classification", () => {
  it.each([
    ["AMZN Mktp CA*NEW123 866-216-1072", "amzn mktp ca 866-216-1072"],
    ["Amazon.ca*NEW987 866-216-1072", "AMZN Mktp CA*OLD456 866-216-1072"],
    ["T&T SUPERMARKET #038 TORONTO", "T&T SUPERMARKET #032 TORONTO"],
    ["ONLINE BANKING PAYMENT - 5555 U OF T", "ONLINE BANKING PAYMENT - 3739 U OF T"],
  ])("groups known aliases without changing exact keys: %s", (left, right) => {
    expect(importedMerchantFamily(left)?.key).toBe(importedMerchantFamily(right)?.key);
    expect(importedMerchantFamily(left)).not.toBeNull();
    expect(normalizeMerchantName(left)).not.toBe(normalizeMerchantName(right));
  });

  it.each([
    ["Amazon.ca prime member amazon.ca/pri", "category-expense-bills"],
    ["UBER CANADA/UBEREATS TORONTO", "category-expense-food"],
    ["UBER CANADA/UBERTRIP TORONTO", "category-expense-transportation"],
    ["UBERDIRECTCA_PASS TORONTO", "category-expense-bills"],
    ["WWW COSTCO CA 800-955-2292", "category-expense-shopping"],
    ["Aesop Toronto Eaton Ct Toronto", "category-expense-shopping"],
    ["SDM 2609 TORONTO", "category-expense-shopping"],
    ["SUPER VAPE 437-4997487", "category-expense-shopping"],
    ["Adobe Inc 800-8336687", "category-expense-bills"],
  ])("recognizes first-time merchant %s", (merchant, categoryId) => {
    for (const direction of ["OUTFLOW", "INFLOW"] as const) {
      expect(importedDefaultCategory({ merchant, direction, accountLabel: "RBC Credit" })).toBe(
        categoryId,
      );
    }
  });

  it.each([
    null,
    "",
    "Someone paid me for Costco",
    "Amazonian Hotel",
    "Shellfish Restaurant",
    "e-Transfer received",
    "Unknown shop",
  ])("does not guess from unrelated or unknown text: %s", (merchant) => {
    expect(importedMerchantFamily(merchant)).toBeNull();
  });

  it("requires credit-account inflow for a repayment default", () => {
    const merchant = "PAYMENT - THANK YOU / PAI EMENT - MERCI";
    expect(
      importedDefaultCategory({ merchant, direction: "INFLOW", accountLabel: "RBC Credit" }),
    ).toBe("category-system-transfer");
    expect(
      importedDefaultCategory({ merchant, direction: "OUTFLOW", accountLabel: "RBC Credit" }),
    ).toBeNull();
    expect(
      importedDefaultCategory({ merchant, direction: "INFLOW", accountLabel: "RBC Debit" }),
    ).toBeNull();
  });
});

describe("manual-entry merchant classification", () => {
  it.each([
    ["IKEA", "category-expense-shopping"],
    ["IKEA North York", "category-expense-shopping"],
    ["Amazon", "category-expense-shopping"],
    ["Amazon.ca", "category-expense-shopping"],
    ["Amazon Prime", "category-expense-bills"],
  ])("suggests the intended category for %s", (merchant, categoryId) => {
    expect(manualDefaultCategory(merchant)).toBe(categoryId);
  });

  it.each(["IKEA Museum", "Amazonian Hotel", "My Amazon Returns Help"])(
    "does not guess from a near-miss name: %s",
    (merchant) => {
      expect(manualDefaultCategory(merchant)).toBeNull();
    },
  );
});
