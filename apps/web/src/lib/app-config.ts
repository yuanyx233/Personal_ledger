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

export class TimeZoneMismatchError extends Error {
  constructor(
    readonly bundled: string,
    readonly worker: string,
  ) {
    super(
      `Time zone mismatch: this page was built for ${bundled} but the server reports ${worker}. ` +
        `Dates would disagree about which day a transaction belongs to, so the ledger is blocked ` +
        `until VITE_APP_TIMEZONE and APP_TIMEZONE name the same zone.`,
    );
    this.name = "TimeZoneMismatchError";
  }
}

// Both halves compute calendar days independently, so a disagreement would file
// entries under different days in the browser and in storage. Stop instead.
export function assertTimeZoneAgreement(workerTimeZone: string, bundled = LEDGER_TIME_ZONE): void {
  const canonical = canonicalTimeZone(workerTimeZone);
  if (canonical !== bundled) {
    throw new TimeZoneMismatchError(bundled, workerTimeZone);
  }
}
