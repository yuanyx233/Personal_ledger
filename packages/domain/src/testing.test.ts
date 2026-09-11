import { describe, expect, it } from "vitest";

import {
  createFixedClock,
  createHostileCsvFixtures,
  createImportRowFixture,
  createLedgerTransactionFixture,
  createPlaidTransactionFixture,
  createReconciledReportFixture,
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
      personal_finance_category: { detailed: "GENERAL_MERCHANDISE_BOOKSTORES" },
      transaction_id: "plaid-pending-1",
    });

    expect(transaction).toMatchObject({
      account_id: "plaid-account-checking-1",
      amount: 42.5,
      iso_currency_code: "CAD",
      payment_meta: { payment_method: null, reference_number: null },
      pending: true,
      personal_finance_category: {
        confidence_level: "VERY_HIGH",
        detailed: "GENERAL_MERCHANDISE_BOOKSTORES",
        primary: "GENERAL_MERCHANDISE",
      },
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

  it("covers every hostile and edge CSV import class with deterministic fixtures", () => {
    const fixtures = createHostileCsvFixtures();
    const decoder = new TextDecoder();

    expect(fixtures.utf8Bom.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(fixtures.invalidUtf8).toContain(0xc3);
    expect(fixtures.oversizedFile).toHaveLength(5 * 1024 * 1024 + 1);
    expect(decoder.decode(fixtures.oversizedRows).split("\n")).toHaveLength(4_002);
    expect(decoder.decode(fixtures.oversizedColumns).split("\n")[0]!.split(",")).toHaveLength(33);
    expect(decoder.decode(fixtures.invalidValues)).toContain("2026-02-29");
    expect(decoder.decode(fixtures.invalidValues)).toContain("12.345");
    expect(decoder.decode(fixtures.invalidValues)).toContain("EUR");
    expect(decoder.decode(fixtures.quotedDelimiter)).toContain('"Neighbourhood, Market"');
    expect(decoder.decode(fixtures.formulas)).toMatch(/=HYPERLINK|\+SUM|@SUM/);
    expect(decoder.decode(fixtures.exactRepeats).match(/Repeat purchase/g)).toHaveLength(2);
    expect(fixtures.suspectedDuplicate.existing).toMatchObject({
      accountLabel: "Daily Chequing",
      amountMinor: 1234,
      currency: "CAD",
      postedDate: "2026-01-15",
    });
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

  it("builds a fully partitioned multi-currency reporting reconciliation fixture", () => {
    const fixture = createReconciledReportFixture();
    const excluded = fixture.expected.excludedTransactionIds;
    const partitionedIds = [
      ...fixture.expected.eligibleTransactionIds,
      ...excluded.confirmedInternalTransfer,
      ...excluded.pending,
      ...excluded.removed,
    ].sort();

    expect(partitionedIds).toEqual(fixture.transactions.map(({ id }) => id).sort());
    expect(new Set(fixture.transactions.map(({ status }) => status))).toEqual(
      new Set(["PENDING", "POSTED", "REMOVED"]),
    );
    expect(new Set(fixture.transactions.map(({ source }) => source))).toEqual(
      new Set(["PLAID", "MANUAL", "CSV"]),
    );
    expect(new Set(fixture.transactions.map(({ currency }) => currency))).toEqual(
      new Set(["CAD", "USD"]),
    );
    expect(fixture.transferMatches).toEqual([
      {
        id: "report-transfer-match-1",
        leftTransactionId: "report-transfer-inflow",
        rightTransactionId: "report-transfer-outflow",
        status: "CONFIRMED",
      },
    ]);
    expect(
      fixture.transactions.filter(
        ({ categoryId, direction }) =>
          categoryId === "report-category-expense" && direction === "INFLOW",
      ),
    ).toHaveLength(2);
    expect(fixture.expected.months).toMatchObject([
      { period: "2025-12" },
      {
        currencies: [
          {
            currency: "CAD",
            incomeMinor: 499_000,
            netCashFlowMinor: 486_000,
            netSpendingMinor: 13_000,
          },
          {
            currency: "USD",
            incomeMinor: 100_000,
            netCashFlowMinor: 80_000,
            netSpendingMinor: 20_000,
          },
        ],
        period: "2026-01",
      },
      {
        currencies: [
          { currency: "CAD", netCashFlowMinor: 0, transactionIds: [] },
          { currency: "USD", netCashFlowMinor: 0, transactionIds: [] },
        ],
        period: "2026-02",
      },
      { period: "2026-03" },
    ]);
    expect(fixture.expected.quarter).toMatchObject({
      currencies: [
        {
          currency: "CAD",
          incomeMinor: 499_000,
          netCashFlowMinor: 480_000,
          netSpendingMinor: 19_000,
        },
        {
          currency: "USD",
          incomeMinor: 100_000,
          netCashFlowMinor: 80_000,
          netSpendingMinor: 20_000,
        },
      ],
      period: "2026-Q1",
    });
  });

  it("returns independent copies of nested reconciliation expectations", () => {
    const first = createReconciledReportFixture();
    first.categories[0]!.name = "Changed";
    first.expected.eligibleTransactionIds.push("later-mutation");
    first.expected.months[1]!.currencies[0]!.transactionIds.push("later-mutation");
    first.expected.quarter.currencies[0]!.transactionIds.push("later-mutation");
    first.transferMatches[0]!.leftTransactionId = "later-mutation";

    const second = createReconciledReportFixture();
    expect(second.categories[0]!.name).toBe("Report income");
    expect(second.expected.eligibleTransactionIds).not.toContain("later-mutation");
    expect(second.expected.months[1]!.currencies[0]!.transactionIds).not.toContain(
      "later-mutation",
    );
    expect(second.expected.quarter.currencies[0]!.transactionIds).not.toContain("later-mutation");
    expect(second.transferMatches[0]!.leftTransactionId).toBe("report-transfer-inflow");
  });
});
