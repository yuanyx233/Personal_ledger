import * as z from "zod";

export const subscriptionDateSchema = z.iso
  .date()
  .refine((date) => date >= "1900-01-01" && date <= "9998-12-31");
export const subscriptionFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  accountLabel: z.string().trim().min(1).max(160),
  amountMinor: z.int().positive(),
  currency: z.enum(["CAD", "USD"]),
  categoryId: z.string().min(1).max(160),
  nextChargeDate: subscriptionDateSchema,
});
export const subscriptionCreateSchema = subscriptionFieldsSchema.extend({ requestId: z.uuid() });
export const subscriptionMutationSchema = z.discriminatedUnion("action", [
  subscriptionFieldsSchema.extend({ action: z.literal("EDIT"), version: z.int().positive() }),
  z.strictObject({
    action: z.literal("CANCEL"),
    version: z.int().positive(),
    effectiveDate: subscriptionDateSchema,
  }),
  z.strictObject({
    action: z.literal("RESUME"),
    version: z.int().positive(),
    nextChargeDate: subscriptionDateSchema,
  }),
]);
export const subscriptionRecordSchema = subscriptionFieldsSchema.extend({
  id: z.string().min(1).max(160),
  cadence: z.enum(["MONTHLY", "YEARLY"]),
  anchorDay: z.int().min(1).max(31),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
  cancellationEffectiveDate: subscriptionDateSchema.nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.int().positive(),
});
export const subscriptionChargeSchema = z.strictObject({
  id: z.string(),
  subscriptionId: z.string(),
  scheduledDate: z.iso.date(),
  transactionId: z.string(),
  status: z.enum(["GENERATED", "NOT_CHARGED"]),
  amountMinor: z.int().nonnegative(),
  currency: z.string(),
});
export const subscriptionsResponseSchema = z.strictObject({
  data: z.strictObject({
    subscriptions: z.array(subscriptionRecordSchema),
    charges: z.array(subscriptionChargeSchema),
  }),
  meta: z.strictObject({ today: z.iso.date() }),
});
export type SubscriptionFields = z.infer<typeof subscriptionFieldsSchema>;
export type SubscriptionRecord = z.infer<typeof subscriptionRecordSchema>;
export type SubscriptionCharge = z.infer<typeof subscriptionChargeSchema>;
export type SubscriptionMutation = z.infer<typeof subscriptionMutationSchema>;

export function torontoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function nextSubscriptionDate(
  date: string,
  anchorDay: number,
  cadence: "MONTHLY" | "YEARLY",
): string {
  const [year = 0, month = 0] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + (cadence === "MONTHLY" ? 1 : 12), 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, lastDay));
  return next.toISOString().slice(0, 10);
}
