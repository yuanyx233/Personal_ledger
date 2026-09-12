import { describe, expect, it } from "vitest";

import { createHostileCsvFixtures, createReconciledReportFixture } from "./testing";

describe("domain fixture factories", () => {
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

  it("builds a fully partitioned multi-currency reporting reconciliation fixture", () => {
    const fixture = createReconciledReportFixture();
    const excluded = fixture.expected.excludedTransactionIds;
    const partitionedIds = [
      ...fixture.expected.eligibleTransactionIds,
      ...excluded.pending,
      ...excluded.removed,
    ].sort();

    expect(partitionedIds).toEqual(fixture.transactions.map(({ id }) => id).sort());
    expect(new Set(fixture.transactions.map(({ status }) => status))).toEqual(
      new Set(["PENDING", "POSTED", "REMOVED"]),
    );
    expect(new Set(fixture.transactions.map(({ source }) => source))).toEqual(
      new Set(["MANUAL", "CSV"]),
    );
    expect(new Set(fixture.transactions.map(({ currency }) => currency))).toEqual(
      new Set(["CAD", "USD"]),
    );
    expect(fixture.expected.internalTransferTransactionIds).toEqual([
      "report-transfer-outflow",
      "report-transfer-inflow",
    ]);
    for (const id of fixture.expected.internalTransferTransactionIds) {
      expect(fixture.expected.eligibleTransactionIds).toContain(id);
      expect(fixture.transactions.find((transaction) => transaction.id === id)?.categoryId).toBe(
        "report-category-transfer",
      );
    }
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
    first.expected.internalTransferTransactionIds.push("later-mutation");
    first.expected.months[1]!.currencies[0]!.transactionIds.push("later-mutation");
    first.expected.quarter.currencies[0]!.transactionIds.push("later-mutation");

    const second = createReconciledReportFixture();
    expect(second.categories[0]!.name).toBe("Report income");
    expect(second.expected.eligibleTransactionIds).not.toContain("later-mutation");
    expect(second.expected.internalTransferTransactionIds).not.toContain("later-mutation");
    expect(second.expected.months[1]!.currencies[0]!.transactionIds).not.toContain(
      "later-mutation",
    );
    expect(second.expected.quarter.currencies[0]!.transactionIds).not.toContain("later-mutation");
  });
});
