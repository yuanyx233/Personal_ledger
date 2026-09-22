import { describe, expect, it } from "vitest";
import { canonicalTimeZone, timeZoneSchema } from "./time-zone";

describe("ledger time zone", () => {
  it("accepts IANA identifiers and returns their canonical form", () => {
    expect(canonicalTimeZone("America/Toronto")).toBe("America/Toronto");
    expect(canonicalTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
  });

  it("canonicalises case and legacy aliases so agreement checks compare equal", () => {
    expect(canonicalTimeZone("america/toronto")).toBe("America/Toronto");
    expect(canonicalTimeZone("utc")).toBe("UTC");
    expect(canonicalTimeZone("Japan")).toBe("Asia/Tokyo");
  });

  it("rejects fixed UTC offsets because they cannot represent daylight saving", () => {
    expect(canonicalTimeZone("+05:00")).toBeNull();
    expect(canonicalTimeZone("-0500")).toBeNull();
  });

  it("rejects empty, blank, untrimmed and unknown values", () => {
    expect(canonicalTimeZone("")).toBeNull();
    expect(canonicalTimeZone("   ")).toBeNull();
    expect(canonicalTimeZone("America/Toronto ")).toBeNull();
    expect(canonicalTimeZone("Not/AZone")).toBeNull();
  });

  it("rejects values that are not strings", () => {
    expect(canonicalTimeZone(null)).toBeNull();
    expect(canonicalTimeZone(undefined)).toBeNull();
    expect(canonicalTimeZone(5)).toBeNull();
  });

  it("parses to the canonical identifier through the schema", () => {
    expect(timeZoneSchema.parse("america/toronto")).toBe("America/Toronto");
    expect(timeZoneSchema.safeParse("Europe/Berlin").success).toBe(true);
    expect(timeZoneSchema.safeParse("+05:00").success).toBe(false);
    expect(timeZoneSchema.safeParse("").success).toBe(false);
  });

  it("is stable when a canonical value is parsed again", () => {
    const once = timeZoneSchema.parse("Japan");
    expect(timeZoneSchema.parse(once)).toBe(once);
  });
});
