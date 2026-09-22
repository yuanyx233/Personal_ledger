import { describe, expect, it } from "vitest";
import {
  nextSubscriptionDate,
  subscriptionCreateSchema,
  subscriptionMutationSchema,
  ledgerDate,
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
    const toronto = "America/Toronto";
    expect(ledgerDate(new Date("2026-09-06T03:59:00Z"), toronto)).toBe("2026-09-05");
    expect(ledgerDate(new Date("2026-01-06T04:59:00Z"), toronto)).toBe("2026-01-05");
    expect(ledgerDate(new Date("2026-09-06T04:00:00Z"), toronto)).toBe("2026-09-06");
  });
  it("follows the configured zone rather than a built-in one", () => {
    const instant = new Date("2026-09-06T03:59:00Z");
    expect(ledgerDate(instant, "America/Toronto")).toBe("2026-09-05");
    expect(ledgerDate(instant, "Europe/Berlin")).toBe("2026-09-06");
    expect(ledgerDate(instant, "Asia/Shanghai")).toBe("2026-09-06");
    expect(ledgerDate(instant, "UTC")).toBe("2026-09-06");
  });
  it("honours daylight saving in the configured zone", () => {
    // Berlin is UTC+2 in September and UTC+1 in January.
    expect(ledgerDate(new Date("2026-09-06T21:30:00Z"), "Europe/Berlin")).toBe("2026-09-06");
    expect(ledgerDate(new Date("2026-09-06T22:30:00Z"), "Europe/Berlin")).toBe("2026-09-07");
    expect(ledgerDate(new Date("2026-01-06T22:30:00Z"), "Europe/Berlin")).toBe("2026-01-06");
    expect(ledgerDate(new Date("2026-01-06T23:30:00Z"), "Europe/Berlin")).toBe("2026-01-07");
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
