import * as z from "zod";
import { CATEGORY_IDS, normalizeMerchantName } from "./merchant-categorization";

// Separate from exact normalization: order/branch aliases must never change deduplication.
const MERCHANT_FAMILIES = [
  {
    key: "amazon-prime",
    displayName: "Amazon Prime",
    pattern: /^amazon(?:\.ca)? prime\b/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "amazon-shopping",
    displayName: "Amazon",
    pattern: /^(?:amzn mktp(?: ca)?|amazon\.ca)(?=[\s*]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "uber-eats",
    displayName: "Uber Eats",
    pattern: /^(?:uber canada\/ubereats|uber\s*\*?\s*eats)(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "uber-pass",
    displayName: "Uber One",
    pattern: /^uberdirectca_pass(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "uber-trip",
    displayName: "Uber",
    pattern: /^(?:uber canada\/ubertrip|uber\s*\*\s*trip|uber holdings canada)(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "t-and-t",
    displayName: "T&T Supermarket",
    pattern: /^t\s*&\s*t supermarket(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "costco",
    displayName: "Costco",
    pattern: /^(?:www\s+)?costco(?=[\s.#*]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "aesop",
    displayName: "Aesop",
    pattern: /^aesop(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "super-vape",
    displayName: "Super Vape",
    pattern: /^super vape(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "shoppers",
    displayName: "Shoppers Drug Mart",
    pattern: /^(?:sdm\s+\d+|shoppers drug mart|pharmaprix)(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "adobe",
    displayName: "Adobe",
    pattern: /^adobe(?:\s+inc)?(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "apple-bill",
    displayName: "Apple Services",
    pattern: /^apple\.com\/bill(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "apple-shopping",
    displayName: "Apple Store",
    pattern: /^apple\.com\/ca(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "openai",
    displayName: "ChatGPT",
    pattern: /^openai\s*\*\s*chatgpt(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "claude",
    displayName: "Claude",
    pattern: /^claude\.ai subscription(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "netflix",
    displayName: "Netflix",
    pattern: /^netflix(?=[\s.*]|$)/u,
    categoryId: "category-expense-entertainment",
  },
  {
    key: "spotify",
    displayName: "Spotify",
    pattern: /^spotify(?=[\s.*]|$)/u,
    categoryId: "category-expense-entertainment",
  },
  {
    key: "premiere-moisson",
    displayName: "Première Moisson",
    pattern: /^premiere moisson(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "starbucks",
    displayName: "Starbucks",
    pattern: /^starbucks(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "mcdonalds",
    displayName: "McDonald’s",
    pattern: /^mcdonald'?s(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "tim-hortons",
    displayName: "Tim Hortons",
    pattern: /^tim hortons(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "iga",
    displayName: "IGA",
    pattern: /^iga(?: extra)?(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "super-c",
    displayName: "Super C",
    pattern: /^super c(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "freshco",
    displayName: "FreshCo",
    pattern: /^freshco(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "food-basics",
    displayName: "Food Basics",
    pattern: /^food basics(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "save-on-foods",
    displayName: "Save-On-Foods",
    pattern: /^save on foods(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "walmart",
    displayName: "Walmart",
    pattern: /^(?:wal-mart|walmart)(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "ikea",
    displayName: "IKEA",
    pattern: /^ikea(?:\s+(?:north york|etobicoke|burlington|canada))?$/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "esso",
    displayName: "Esso",
    pattern: /^esso(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "shell",
    displayName: "Shell",
    pattern: /^shell(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "uoft-tuition",
    displayName: "University of Toronto",
    pattern: /^online banking payment\s*-\s*\d+\s+u of t$/u,
    categoryId: "category-expense-tuition",
  },
] as const;

export const merchantFamilySchema = z.enum(MERCHANT_FAMILIES.map(({ key }) => key));
export type MerchantFamily = z.infer<typeof merchantFamilySchema>;

export function importedMerchantFamily(merchant: string | null) {
  const normalized = normalizeMerchantName(merchant);
  return normalized === null
    ? null
    : (MERCHANT_FAMILIES.find(({ pattern }) => pattern.test(normalized)) ?? null);
}

export function reportMerchantFamily(merchant: string | null) {
  const normalized = normalizeMerchantName(merchant);
  return (
    importedMerchantFamily(merchant) ??
    MERCHANT_FAMILIES.find(
      ({ displayName }) => normalizeMerchantName(displayName) === normalized,
    ) ??
    null
  );
}

export function manualDefaultCategory(merchant: string | null): string | null {
  return reportMerchantFamily(merchant)?.categoryId ?? null;
}

export function importedDefaultCategory(input: {
  merchant: string | null;
  accountLabel: string;
  direction: "INFLOW" | "OUTFLOW";
}): string | null {
  const merchant = normalizeMerchantName(input.merchant);
  if (
    merchant !== null &&
    /^payment\s*-\s*thank you(?:\s*\/\s*pai\s*ement\s*-\s*merci)?$/u.test(merchant) &&
    /\b(?:credit|visa|mastercard|amex)\b/iu.test(input.accountLabel) &&
    input.direction === "INFLOW"
  ) {
    return CATEGORY_IDS.systemTransfer;
  }
  return importedMerchantFamily(input.merchant)?.categoryId ?? null;
}
