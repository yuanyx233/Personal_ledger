import { createFullJsonExport, type FullJsonExport } from "@ledger/domain";
import { describe, expect, it } from "vitest";

import {
  FullJsonRestoreError,
  calculateFullJsonRestoreEvidence,
  createFullJsonRestoreSql,
  verifyFullJsonRestoreEvidence,
} from "./full-json-restore";

const NOW = "2026-07-17T12:00:00.000Z";
const PAYMENT_METADATA = {
  payee: null,
  payer: null,
  paymentMethod: null,
  referenceNumber: null,
};

function hex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function transaction(
  input: Partial<FullJsonExport["data"]["transactions"][number]> &
    Pick<FullJsonExport["data"]["transactions"][number], "id">,
): FullJsonExport["data"]["transactions"][number] {
  return {
    accountId: "account-chequing",
    accountLabel: null,
    amountMinor: 1234,
    reimbursementMinor: 0,
    authorizedDate: null,
    categorizationSource: "MANUAL",
    categoryId: "category-expense",
    categoryRuleId: null,
    createdAt: NOW,
    currency: "CAD",
    description: "Fixture transaction",
    direction: "OUTFLOW",
    importFingerprint: null,
    merchantName: null,
    needsReview: false,
    normalizedMerchant: null,
    paymentMetadata: PAYMENT_METADATA,
    pendingTransactionId: null,
    plaidPersonalFinanceCategory: null,
    postedDate: "2026-07-17",
    providerTransactionId: null,
    reviewReason: null,
    source: "MANUAL",
    status: "POSTED",
    updatedAt: NOW,
    version: 1,
    ...input,
  };
}

function fixture(): FullJsonExport {
  return createFullJsonExport({
    data: {
      accounts: [
        {
          connectionId: "connection-1",
          createdAt: NOW,
          currency: "CAD",
          displayName: "Daily Chequing",
          enabled: true,
          id: "account-chequing",
          subtype: "CHECKING",
          type: "DEPOSITORY",
          updatedAt: NOW,
          version: 1,
        },
        {
          connectionId: "connection-1",
          createdAt: NOW,
          currency: "CAD",
          displayName: "Credit Card",
          enabled: true,
          id: "account-credit",
          subtype: "CREDIT_CARD",
          type: "CREDIT",
          updatedAt: NOW,
          version: 1,
        },
      ],
      categories: [
        {
          active: true,
          createdAt: NOW,
          editable: false,
          id: "category-system-transfer",
          kind: "TRANSFER",
          name: "Transfer",
          systemKey: "TRANSFER",
          updatedAt: NOW,
          version: 1,
        },
        {
          active: true,
          createdAt: NOW,
          editable: false,
          id: "category-system-unclassified",
          kind: "UNCLASSIFIED",
          name: "Unclassified",
          systemKey: "UNCLASSIFIED",
          updatedAt: NOW,
          version: 1,
        },
        {
          active: true,
          createdAt: NOW,
          editable: true,
          id: "category-income",
          kind: "INCOME",
          name: "Income",
          systemKey: null,
          updatedAt: NOW,
          version: 1,
        },
        {
          active: true,
          createdAt: NOW,
          editable: true,
          id: "category-expense",
          kind: "EXPENSE",
          name: "Expense",
          systemKey: null,
          updatedAt: NOW,
          version: 1,
        },
      ],
      categoryAudits: [
        {
          createdAt: NOW,
          id: "category-audit-1",
          newCategoryId: "category-expense",
          newCategoryRuleId: "rule-cafe",
          newSource: "RULE",
          oldCategoryId: null,
          oldCategoryRuleId: null,
          oldSource: "UNCLASSIFIED",
          reason: "RULE_CATEGORIZATION",
          transactionId: "transaction-expense",
        },
      ],
      connections: [
        {
          createdAt: NOW,
          id: "connection-1",
          institutionId: "ins_fixture",
          institutionName: "Fixture Bank",
          updatedAt: NOW,
          version: 2,
        },
      ],
      importBatches: [
        {
          committedAt: NOW,
          contentChecksum: "a".repeat(64),
          createdAt: NOW,
          id: "import-batch-1",
          sourceFilenameHash: "b".repeat(64),
          status: "COMMITTED",
          version: 2,
        },
      ],
      importRows: [
        {
          batchId: "import-batch-1",
          canonicalFingerprint: "c".repeat(64),
          createdAt: NOW,
          errors: [],
          id: "import-row-1",
          raw: {
            accountLabel: "Credit Card",
            amount: "20.00",
            category: "Transfer",
            currency: "CAD",
            description: "Card payment",
            direction: "INFLOW",
            merchant: null,
            postedDate: "2026-07-17",
          },
          rowNumber: 2,
          transactionId: "transaction-transfer-right",
          validationStatus: "IMPORTED",
        },
      ],
      merchantRules: [
        {
          active: true,
          categoryId: "category-expense",
          createdAt: NOW,
          displayMerchant: "Fixture Cafe",
          id: "rule-cafe",
          normalizedMerchant: "fixture cafe",
          updatedAt: NOW,
          version: 1,
        },
      ],
      subscriptions: [
        {
          accountLabel: "RBC Credit",
          amountMinor: 1149,
          anchorDay: 22,
          cadence: "MONTHLY",
          categoryId: "category-expense",
          createdAt: NOW,
          currency: "CAD",
          id: "subscription-apple",
          lastErrorCode: null,
          merchantName: "Apple",
          name: "Apple subscription",
          nextChargeDate: "2026-08-22",
          normalizedMerchant: "apple",
          status: "ACTIVE",
          updatedAt: NOW,
          version: 1,
        },
      ],
      transactions: [
        transaction({
          amountMinor: 500_000,
          categoryId: "category-income",
          direction: "INFLOW",
          id: "transaction-income",
        }),
        transaction({
          categorizationSource: "RULE",
          categoryRuleId: "rule-cafe",
          description: "x'); DROP TABLE transactions; --\u0000",
          id: "transaction-expense",
          merchantName: "Fixture Cafe",
          normalizedMerchant: "fixture cafe",
          providerTransactionId: "provider-transaction-1",
          source: "PLAID",
        }),
        transaction({
          amountMinor: 2_000,
          categoryId: "category-system-transfer",
          direction: "OUTFLOW",
          id: "transaction-transfer-left",
          providerTransactionId: "provider-transfer-left",
          source: "PLAID",
        }),
        transaction({
          accountId: "account-credit",
          amountMinor: 2_000,
          categoryId: "category-system-transfer",
          direction: "INFLOW",
          id: "transaction-transfer-right",
          importFingerprint: "c".repeat(64),
          source: "CSV",
        }),
        transaction({
          id: "transaction-posted-replacement",
          pendingTransactionId: "transaction-pending",
          providerTransactionId: "provider-posted",
          source: "PLAID",
        }),
        transaction({
          id: "transaction-pending",
          providerTransactionId: "provider-pending",
          source: "PLAID",
          status: "PENDING",
        }),
        transaction({
          accountId: null,
          accountLabel: "RBC Credit",
          amountMinor: 1149,
          categoryId: "category-expense",
          description: "Apple subscription",
          id: "transaction-subscription-not-charged",
          merchantName: "Apple",
          normalizedMerchant: "apple",
          postedDate: "2026-07-22",
          source: "MANUAL",
          status: "REMOVED",
        }),
      ],
      subscriptionOccurrences: [
        {
          createdAt: NOW,
          id: "occurrence-apple-2026-07-22",
          ownerDecisionAt: NOW,
          scheduledDate: "2026-07-22",
          status: "NOT_CHARGED",
          subscriptionId: "subscription-apple",
          transactionId: "transaction-subscription-not-charged",
          updatedAt: NOW,
          version: 2,
        },
      ],
      transferMatchAudits: [
        {
          action: "CONFIRM",
          createdAt: NOW,
          id: "transfer-audit-1",
          matchVersion: 2,
          newStatus: "CONFIRMED",
          oldStatus: "AUTO_CONFIRMED",
          reason: "OWNER_CONFIRMED",
          transferMatchId: "transfer-match-1",
        },
      ],
      transferMatches: [
        {
          confidence: "HIGH",
          createdAt: NOW,
          decisionReason: "OWNER_CONFIRMED",
          evidence: {
            amountMinor: 2_000,
            currency: "CAD",
            dayDifference: 0,
            reason: null,
            signals: ["DESCRIPTION"],
          },
          id: "transfer-match-1",
          leftTransactionId: "transaction-transfer-left",
          rightTransactionId: "transaction-transfer-right",
          status: "CONFIRMED",
          updatedAt: NOW,
          version: 2,
        },
      ],
    },
    exportedAt: NOW,
    timezone: "America/Toronto",
  });
}

it("rejects budget history with missing categories or duplicate effective-month keys", () => {
  const document = fixture();
  const budget = {
    categoryId: "missing",
    currency: "CAD",
    effectiveMonth: "2026-09",
    amountMinor: 50000,
    updatedAt: NOW,
  };
  document.data.budgets = [budget];
  document.recordCounts.budgets = 1;
  expect(() => createFullJsonRestoreSql(document)).toThrow("DANGLING_RELATIONSHIP");
  document.data.budgets = [
    { ...budget, categoryId: "category-expense" },
    { ...budget, categoryId: "category-expense" },
  ];
  document.recordCounts.budgets = 2;
  expect(() => createFullJsonRestoreSql(document)).toThrow("DUPLICATE_UNIQUE_VALUE");
});

describe("full JSON local restore", () => {
  it("retains deductions, defaults old backups to zero, and rejects excessive amounts", () => {
    const document = fixture();
    const entry = document.data.transactions.find(
      (item) =>
        item.direction === "OUTFLOW" &&
        item.categoryId === "category-expense" &&
        item.status === "POSTED",
    )!;
    const before = calculateFullJsonRestoreEvidence(document).reportTotals[0]!.netSpendingMinor;
    entry.reimbursementMinor = 200;
    expect(calculateFullJsonRestoreEvidence(document).reportTotals[0]!.netSpendingMinor).toBe(
      before - 200,
    );
    expect(createFullJsonRestoreSql(document)).toContain("reimbursement_minor");
    const oldBackup = JSON.parse(JSON.stringify(document)) as typeof document;
    Reflect.deleteProperty(
      oldBackup.data.transactions.find((item) => item.id === entry.id)!,
      "reimbursementMinor",
    );
    expect(calculateFullJsonRestoreEvidence(oldBackup).reportTotals[0]!.netSpendingMinor).toBe(
      before,
    );
    entry.reimbursementMinor = entry.amountMinor + 1;
    expect(() => createFullJsonRestoreSql(document)).toThrow();
  });
  it("generates allowlisted D1 SQL with hex-encoded input and dependency-safe ordering", () => {
    const sql = createFullJsonRestoreSql(fixture());

    expect(sql).toContain("DELETE FROM categories WHERE system_key IS NULL");
    expect(sql).toContain("restored-local-item:");
    expect(sql).toContain("restored-local-account:");
    expect(sql).toContain("restored-local-import:");
    expect(sql).toContain("subscription_occurrences");
    expect(sql.indexOf("INSERT INTO subscriptions")).toBeLessThan(
      sql.indexOf("INSERT INTO transactions"),
    );
    expect(sql.indexOf("INSERT INTO transactions")).toBeLessThan(
      sql.indexOf("INSERT INTO subscription_occurrences"),
    );
    expect(sql).toContain("'DISCONNECTED'");
    expect(sql).not.toContain("DROP TABLE transactions");
    expect(sql).not.toContain("Fixture Cafe");
    expect(sql).not.toContain("BEGIN");
    expect(sql).not.toContain("COMMIT;");
    expect(sql.indexOf(hex("transaction-pending"))).toBeLessThan(
      sql.indexOf(hex("transaction-posted-replacement")),
    );
  });

  it("rejects duplicate ids, dangling relations, invalid source identity, and pending cycles", () => {
    const duplicate = fixture();
    duplicate.data.accounts.push({ ...duplicate.data.accounts[0]! });
    duplicate.recordCounts.accounts += 1;
    expect(() => createFullJsonRestoreSql(duplicate)).toThrow(
      new FullJsonRestoreError("DUPLICATE_ID"),
    );

    const dangling = fixture();
    dangling.data.accounts[0]!.connectionId = "missing-connection";
    expect(() => createFullJsonRestoreSql(dangling)).toThrow(
      new FullJsonRestoreError("DANGLING_RELATIONSHIP"),
    );

    const source = fixture();
    source.data.transactions[0]!.source = "PLAID";
    expect(() => createFullJsonRestoreSql(source)).toThrow(
      new FullJsonRestoreError("INVALID_SOURCE_IDENTITY"),
    );

    const cycle = fixture();
    cycle.data.transactions.find(({ id }) => id === "transaction-pending")!.pendingTransactionId =
      "transaction-posted-replacement";
    expect(() => createFullJsonRestoreSql(cycle)).toThrow(
      new FullJsonRestoreError("PENDING_RELATIONSHIP_CYCLE"),
    );
  });

  it("restores historical subscription occurrences after the current plan fields change", () => {
    const changedPlan = fixture();
    changedPlan.data.categories.push({
      active: true,
      createdAt: NOW,
      editable: true,
      id: "category-expense-current",
      kind: "EXPENSE",
      name: "Current subscription category",
      systemKey: null,
      updatedAt: NOW,
      version: 1,
    });
    changedPlan.recordCounts.categories += 1;
    Object.assign(changedPlan.data.subscriptions[0]!, {
      accountLabel: "BMO Debit",
      amountMinor: 1499,
      categoryId: "category-expense-current",
      merchantName: "Apple Services",
      normalizedMerchant: "apple services",
      version: 2,
    });

    expect(() => createFullJsonRestoreSql(changedPlan)).not.toThrow();
  });

  it("restores an editable custom transfer category without counting it as income or spending", () => {
    const customTransfer = fixture();
    customTransfer.data.categories.push({
      active: true,
      createdAt: NOW,
      editable: true,
      id: "category-transfer-emt",
      kind: "TRANSFER",
      name: "EMT",
      systemKey: null,
      updatedAt: NOW,
      version: 1,
    });
    customTransfer.recordCounts.categories += 1;
    Object.assign(customTransfer.data.transactions[0]!, {
      categoryId: "category-transfer-emt",
      direction: "INFLOW",
    });

    expect(() => createFullJsonRestoreSql(customTransfer)).not.toThrow();
    expect(calculateFullJsonRestoreEvidence(customTransfer).reportTotals).toEqual([
      {
        currency: "CAD",
        incomeMinor: 0,
        netCashFlowMinor: -2_468,
        netSpendingMinor: 2_468,
      },
    ]);
  });

  it("still rejects dangling, non-manual, and status-inconsistent occurrence history", () => {
    const dangling = fixture();
    dangling.data.subscriptionOccurrences[0]!.subscriptionId = "subscription-missing";
    expect(() => createFullJsonRestoreSql(dangling)).toThrow(
      new FullJsonRestoreError("DANGLING_RELATIONSHIP"),
    );

    const nonManual = fixture();
    Object.assign(
      nonManual.data.transactions.find(({ id }) => id === "transaction-subscription-not-charged")!,
      {
        providerTransactionId: "provider-subscription-history",
        source: "PLAID",
      },
    );
    expect(() => createFullJsonRestoreSql(nonManual)).toThrow(
      new FullJsonRestoreError("DANGLING_RELATIONSHIP"),
    );

    const statusMismatch = fixture();
    statusMismatch.data.transactions.find(
      ({ id }) => id === "transaction-subscription-not-charged",
    )!.status = "POSTED";
    expect(() => createFullJsonRestoreSql(statusMismatch)).toThrow(
      new FullJsonRestoreError("DANGLING_RELATIONSHIP"),
    );
  });

  it("calculates exact per-currency report evidence and verifies every reconciliation field", () => {
    const expected = calculateFullJsonRestoreEvidence(fixture());

    expect(expected.counts).toMatchObject({
      categoryAudits: 1,
      merchantRules: 1,
      subscriptionOccurrences: 1,
      subscriptions: 1,
      transactions: 7,
      transferMatchAudits: 1,
      transferMatches: 1,
    });
    expect(expected.reportTotals).toEqual([
      {
        currency: "CAD",
        incomeMinor: 500_000,
        netCashFlowMinor: 497_532,
        netSpendingMinor: 2_468,
      },
    ]);
    expect(() => verifyFullJsonRestoreEvidence(expected, expected)).not.toThrow();
    const reorderedCounts = Object.fromEntries(
      Object.entries(expected.counts).reverse(),
    ) as typeof expected.counts;
    expect(() =>
      verifyFullJsonRestoreEvidence(expected, { ...expected, counts: reorderedCounts }),
    ).not.toThrow();
    expect(() =>
      verifyFullJsonRestoreEvidence(expected, {
        ...expected,
        counts: { ...expected.counts, transactions: 5 },
      }),
    ).toThrow(new FullJsonRestoreError("RECONCILIATION_FAILED"));
  });
});
