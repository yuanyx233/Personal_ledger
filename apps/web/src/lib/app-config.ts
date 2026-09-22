import { canonicalTimeZone } from "@ledger/domain";

// The browser bundle carries the ledger time zone so the first paint can already
// compute calendar days without waiting for a response. A wrong value would shift
// month boundaries silently, so an unusable one stops the application instead.
export function readLedgerTimeZone(value: string | undefined): string {
  const canonical = canonicalTimeZone(value);
  if (canonical === null) {
    throw new Error(
      `VITE_APP_TIMEZONE must be a named IANA time zone, received ${JSON.stringify(value)}`,
    );
  }
  return canonical;
}

export const LEDGER_TIME_ZONE = readLedgerTimeZone(import.meta.env.VITE_APP_TIMEZONE);
