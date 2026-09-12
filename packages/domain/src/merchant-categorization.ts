export const CATEGORY_IDS = Object.freeze({
  expenseBills: "category-expense-bills",
  expenseEntertainment: "category-expense-entertainment",
  expenseFood: "category-expense-food",
  expenseHealthcare: "category-expense-healthcare",
  expenseHousing: "category-expense-housing",
  expenseOther: "category-expense-other",
  expenseShopping: "category-expense-shopping",
  expenseTransportation: "category-expense-transportation",
  expenseTravel: "category-expense-travel",
  incomeEmployment: "category-income-employment",
  incomeOther: "category-income-other",
  systemTransfer: "category-system-transfer",
  systemUnclassified: "category-system-unclassified",
});

const STABLE_TERMINAL_SUFFIX = /\s+(?:#\s*|store\s*#?\s*|location\s*#?\s*)\d{2,10}$/iu;

export function normalizeMerchantName(merchantName: string | null): string | null {
  if (merchantName === null) return null;
  const normalized = merchantName
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(STABLE_TERMINAL_SUFFIX, "")
    .trim();
  return normalized.length === 0 || normalized.length > 256 ? null : normalized;
}
