import * as z from "zod";

// Fixed offsets such as "+05:00" are accepted by Intl but cannot express daylight
// saving, which would silently shift month boundaries and subscription due dates
// for half the year. Only named IANA zones are allowed.
const FIXED_OFFSET = /^[+-]/;

export function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const resolved = new Intl.DateTimeFormat(undefined, { timeZone: value }).resolvedOptions()
      .timeZone;
    return FIXED_OFFSET.test(resolved) ? null : resolved;
  } catch {
    return null;
  }
}

export const timeZoneSchema = z.string().transform((value, context) => {
  const canonical = canonicalTimeZone(value);
  if (canonical === null) {
    context.addIssue({ code: "custom", message: "Expected a named IANA time zone" });
    return z.NEVER;
  }
  return canonical;
});
