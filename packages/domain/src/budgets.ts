import * as z from "zod";

export const budgetMonthSchema = z.string().regex(/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/);

export const budgetSettingSchema = z.strictObject({
  categoryId: z.string().min(1).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
  effectiveMonth: budgetMonthSchema,
  amountMinor: z.int().nonnegative().nullable(),
});

export const budgetRecordSchema = budgetSettingSchema.extend({
  updatedAt: z.iso.datetime({ offset: true }),
});

export const budgetsResponseSchema = z.strictObject({
  data: z.strictObject({ budgets: z.array(budgetRecordSchema) }),
  meta: z.strictObject({ month: budgetMonthSchema }),
});

export type BudgetSetting = z.infer<typeof budgetSettingSchema>;
export type BudgetRecord = z.infer<typeof budgetRecordSchema>;

export function parseBudgetAmount(value: string): number {
  if (!/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,2})?$/.test(value)) {
    throw new TypeError("Invalid budget amount.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return z
    .int()
    .nonnegative()
    .parse(Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))));
}
