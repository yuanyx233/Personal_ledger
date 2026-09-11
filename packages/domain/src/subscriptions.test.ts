import { describe, expect, it } from "vitest";
import {
  nextSubscriptionDate,
  subscriptionCreateSchema,
  subscriptionMutationSchema,
  torontoDate,
} from "./subscriptions";

describe("subscription calendar and contracts", () => {
  it("clamps short months without losing the original anchor", () => {
    expect(nextSubscriptionDate("2026-01-31", 31, "MONTHLY")).toBe("2026-02-28");
    expect(nextSubscriptionDate("2026-02-28", 31, "MONTHLY")).toBe("2026-03-31");
    expect(nextSubscriptionDate("2027-12-31", 31, "MONTHLY")).toBe("2028-01-31");
    expect(nextSubscriptionDate("2028-01-31", 31, "MONTHLY")).toBe("2028-02-29");
    expect(nextSubscriptionDate("2028-02-29", 29, "YEARLY")).toBe("2029-02-28");
  });
  it("uses Toronto dates across midnight and DST", () => {
    expect(torontoDate(new Date("2026-09-06T03:59:00Z"))).toBe("2026-09-05");
    expect(torontoDate(new Date("2026-01-06T04:59:00Z"))).toBe("2026-01-05");
    expect(torontoDate(new Date("2026-09-06T04:00:00Z"))).toBe("2026-09-06");
  });
  it("requires an explicit effective date and version for cancellation and resumption", () => {
    expect(
      subscriptionMutationSchema.safeParse({
        action: "CANCEL",
        version: 1,
        effectiveDate: "2026-07-01",
      }).success,
    ).toBe(true);
    for (const input of [
      { action: "CANCEL", version: 1 },
      { action: "CANCEL", version: 1, effectiveDate: "2026-02-30" },
      { action: "RESUME", version: 0, nextChargeDate: "2026-09-10" },
      { action: "RESUME", version: 1, nextChargeDate: "2026-09-10", status: "ACTIVE" },
    ])
      expect(subscriptionMutationSchema.safeParse(input).success).toBe(false);
    expect(subscriptionCreateSchema.safeParse({ amountMinor: -1 }).success).toBe(false);
  });
});
