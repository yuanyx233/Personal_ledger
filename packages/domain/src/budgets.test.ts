import { expect, it } from "vitest";
import { budgetMonthSchema, budgetSettingSchema, parseBudgetAmount } from "./budgets";

it("parses exact decimal budget amounts and distinguishes zero from no limit", () => {
  expect(parseBudgetAmount("0")).toBe(0);
  expect(parseBudgetAmount("500.01")).toBe(50001);
  expect(parseBudgetAmount("12.3")).toBe(1230);
  for (const value of ["", "-1", "1e2", "1.001", "Infinity", "1234567890123456789"])
    expect(() => parseBudgetAmount(value)).toThrow();
  const setting = { categoryId: "food", currency: "CAD", effectiveMonth: "2026-09" };
  expect(budgetSettingSchema.parse({ ...setting, amountMinor: null }).amountMinor).toBeNull();
  expect(budgetSettingSchema.parse({ ...setting, amountMinor: 0 }).amountMinor).toBe(0);
  for (const month of ["2026-13", "2026-00", "26-09", "2026-9", "0000-01"])
    expect(budgetMonthSchema.safeParse(month).success).toBe(false);
});
