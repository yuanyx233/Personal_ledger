import { describe, expect, it } from "vitest";

import {
  createFixedClock,
  createImportRowFixture,
  createLedgerTransactionFixture,
  createPlaidTransactionFixture,
  createReportFixture,
} from "./testing";

describe("deterministic clock and timezone harness", () => {
  it("returns a fixed instant and resolves calendar dates in the explicit timezone", () => {
    const clock = createFixedClock({
      instant: "2026-01-01T04:30:00.000Z",
      timeZone: "America/Toronto",
    });

    expect(clock.now().toISOString()).toBe("2026-01-01T04:30:00.000Z");
    expect(clock.localDate()).toBe("2025-12-31");
    expect(clock.localDate(new Date("2026-01-01T05:00:00.000Z"))).toBe("2026-01-01");
  });

  it("returns defensive dates and rejects invalid instants or timezones", () => {
    const clock = createFixedClock({
      instant: "2026-07-15T12:00:00.000Z",
      timeZone: "America/Toronto",
    });
    const changed = clock.now();
    changed.setUTCFullYear(2030);

    expect(clock.now().toISOString()).toBe("2026-07-15T12:00:00.000Z");
    expect(() => createFixedClock({ instant: "not-a-date", timeZone: "UTC" })).toThrow();
    expect(() =>
      createFixedClock({ instant: "2026-07-15T12:00:00.000Z", timeZone: "Mars/Olympus" }),
    ).toThrow();
  });
});

describe("domain fixture factories", () => {
  it("builds Plaid transaction data with provider-shaped fields", () => {
    const transaction = createPlaidTransactionFixture({
      amount: 42.5,
      pending: true,
      transaction_id: "plaid-pending-1",
    });

    expect(transaction).toMatchObject({
      account_id: "plaid-account-checking-1",
      amount: 42.5,
      iso_currency_code: "CAD",
      payment_meta: { payment_method: null, reference_number: null },
      pending: true,
      transaction_id: "plaid-pending-1",
    });
  });

  it("builds exact canonical ledger data with targeted overrides", () => {
    const transaction = createLedgerTransactionFixture({
      amountMinor: 2599,
      direction: "INFLOW",
      id: "ledger-refund-1",
      source: "MANUAL",
    });

    expect(transaction).toMatchObject({
      amountMinor: 2599,
      currency: "CAD",
      direction: "INFLOW",
      id: "ledger-refund-1",
      source: "MANUAL",
      version: 1,
    });
  });

  it("deep-merges import input and does not share mutable errors", () => {
    const first = createImportRowFixture({
      errors: ["Invalid amount"],
      raw: { description: "Custom row" },
    });
    first.errors.push("Later mutation");
    const second = createImportRowFixture();

    expect(first.raw).toMatchObject({
      currency: "CAD",
      date: "2026-01-15",
      description: "Custom row",
    });
    expect(second.errors).toEqual([]);
    expect(second.raw.description).toBe("Fixture transaction");
  });

  it("builds isolated report populations in the Toronto timezone", () => {
    const source = createLedgerTransactionFixture({ id: "ledger-report-1" });
    const first = createReportFixture({ transactions: [source] });
    first.transactions[0]!.description = "Changed in this test";
    const second = createReportFixture({ transactions: [source] });

    expect(first).toMatchObject({
      currency: "CAD",
      endDate: "2026-01-31",
      startDate: "2026-01-01",
      timeZone: "America/Toronto",
    });
    expect(second.transactions[0]!.description).toBe("Fixture purchase");
  });
});
