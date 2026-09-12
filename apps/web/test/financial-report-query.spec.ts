import { createReconciledReportFixture } from "@ledger/domain/testing";
import { cashFlowReportResponseSchema, spendingReportResponseSchema } from "@ledger/domain";
import { FinancialReportRepository, TransactionRepository } from "@ledger/persistence";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { clearCategoryAudits } from "./support/category-audits";

const NOW = "2026-04-01T12:00:00.000Z";
const worker = createAppWorker(
  () =>
    Promise.resolve({
      email: "owner@example.invalid",
      sessionBinding: "report-session",
      subject: "report-owner",
    }),
  undefined,
  () => new Date(NOW),
);
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;

function netSpending(transactions: Awaited<ReturnType<TransactionRepository["list"]>>): number {
  return transactions.reduce(
    (sum, transaction) =>
      sum +
      (transaction.direction === "OUTFLOW" ? transaction.amountMinor : -transaction.amountMinor),
    0,
  );
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearCategoryAudits(cloudflareEnv.DB);
  await cloudflareEnv.DB.batch(
    [
      "transactions",
      "merchant_rules",
      "categories WHERE system_key IS NULL",
      "accounts",
      "connections",
    ].map((table) => cloudflareEnv.DB.prepare(`DELETE FROM ${table}`)),
  );
  await cloudflareEnv.DB.batch([
    ...[
      ["report-category-income", "Report income", "INCOME"],
      ["report-category-expense", "Report expense", "EXPENSE"],
      ["report-category-dining", "Report dining", "EXPENSE"],
    ].map(([id, name, kind]) =>
      cloudflareEnv.DB.prepare(
        `INSERT INTO categories (
          id, name, kind, editable, active, created_at, updated_at, version
        ) VALUES (?, ?, ?, 1, 1, ?, ?, 1)`,
      ).bind(id, name, kind, NOW, NOW),
    ),
  ]);

  const fixture = createReconciledReportFixture();
  await cloudflareEnv.DB.batch(
    fixture.transactions.map((transaction) =>
      cloudflareEnv.DB.prepare(
        `INSERT INTO transactions (
          id, source, account_label, import_fingerprint,
          status, posted_date, amount_minor, direction, currency,
          raw_description, merchant_name, category_id, categorization_source,
          needs_review, created_at, updated_at, version
        ) VALUES (?, ?, 'Daily Chequing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)`,
      ).bind(
        transaction.id,
        transaction.source,
        transaction.source === "CSV" ? `fingerprint-${transaction.id}` : null,
        transaction.status,
        transaction.postedDate,
        transaction.amountMinor,
        transaction.direction,
        transaction.currency,
        transaction.description,
        transaction.merchantName,
        transaction.categoryId === "report-category-transfer"
          ? "category-system-transfer"
          : transaction.categoryId,
        transaction.categorizationSource,
        transaction.createdAt,
        transaction.updatedAt,
      ),
    ),
  );
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `UPDATE transactions
       SET merchant_name = 'Report Market', normalized_merchant = 'report market'
       WHERE id IN ('report-cad-groceries', 'report-cad-expense-refund')`,
    ),
    cloudflareEnv.DB.prepare(
      `UPDATE transactions
       SET category_id = 'report-category-dining',
           merchant_name = 'Cash Cafe', normalized_merchant = 'cash cafe'
       WHERE id = 'report-cad-manual-expense'`,
    ),
    cloudflareEnv.DB.prepare(
      `UPDATE transactions
       SET merchant_name = 'USD Store', normalized_merchant = 'usd store'
       WHERE id IN ('report-usd-expense', 'report-usd-expense-refund')`,
    ),
    cloudflareEnv.DB.prepare(
      `UPDATE transactions
       SET merchant_name = 'March Cafe', normalized_merchant = 'march cafe'
       WHERE id = 'report-march-manual-expense'`,
    ),
  ]);
});

describe("D1 financial report query layer", () => {
  it("reconciles merchant families, paginated drill-down and CSV exports without merging services", async () => {
    const rows = [
      ["amazon-order", "AMZN Mktp CA*ONE 866-216-1072", "OUTFLOW", 2000, 200],
      ["amazon-other", "Amazon.ca*TWO 866-216-1072", "OUTFLOW", 1500, 0],
      ["amazon-refund", "AMZN Mktp CA*REFUND 866-216-1072", "INFLOW", 500, 0],
      ["amazon-prime", "Amazon.ca prime member amazon.ca/pri", "OUTFLOW", 1000, 0],
      ["tt-one", "T&T SUPERMARKET #038 TORONTO", "OUTFLOW", 2000, 0],
      ["tt-two", "T&T SUPERMARKET #032 TORONTO", "OUTFLOW", 1000, 0],
      ["uber-eats", "UBER CANADA/UBEREATS TORONTO", "OUTFLOW", 600, 0],
      ["uber-trip", "UBER CANADA/UBERTRIP TORONTO", "OUTFLOW", 400, 0],
      ["unrelated", "Amazonian Hotel", "OUTFLOW", 300, 0],
      ...Array.from({ length: 105 }, (_, index) => [
        `amazon-many-${index}`,
        `AMZN Mktp CA*EXTRA${index}`,
        "OUTFLOW",
        1,
        0,
      ]),
    ] as const;
    await cloudflareEnv.DB.batch(
      rows.map(([id, name, direction, amount, reimbursement]) =>
        cloudflareEnv.DB.prepare(
          `INSERT INTO transactions (id, source, account_label, status, posted_date, amount_minor,
        reimbursement_minor, direction, currency, raw_description, normalized_merchant,
        category_id, categorization_source, needs_review, created_at, updated_at, version)
       VALUES (?, 'MANUAL', 'Daily Chequing', 'POSTED', '2026-01-10', ?, ?, ?, 'CAD', ?, ?, 'report-category-expense', 'MANUAL', 0, ?, ?, 1)`,
        ).bind(id, amount, reimbursement, direction, name, String(name).toLowerCase(), NOW, NOW),
      ),
    );
    const reports = new FinancialReportRepository(cloudflareEnv.DB);
    const result = await reports.spendingBreakdown({ grain: "MONTH", period: "2026-01" });
    const cad = result.sections.find((section) => section.currency === "CAD")!;
    const amazon = cad.merchantRanking.find((row) => row.merchantFamily === "amazon-shopping")!;
    expect(amazon).toMatchObject({
      merchantName: "Amazon",
      transactionCount: 108,
      netSpendingMinor: 2905,
    });
    expect(amazon.drillDown).not.toHaveProperty("normalizedMerchant");
    expect(amazon.drillDown).not.toHaveProperty("merchantMissing");
    const repository = new TransactionRepository(cloudflareEnv.DB);
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const page = await repository.listPage({
        ...amazon.drillDown,
        pageSize: 25,
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...page.transactions.map((transaction) => transaction.id));
      cursor = page.nextCursor;
      if (ids.length === 25) {
        await expect(
          repository.listPage({ ...amazon.drillDown, merchantFamily: "amazon-prime", cursor }),
        ).rejects.toThrow("INVALID_CURSOR");
      }
    } while (cursor);
    expect(new Set(ids).size).toBe(108);
    expect(ids).not.toContain("amazon-prime");
    expect(ids).not.toContain("unrelated");
    const exported = await repository.listForCsvExport({
      ...amazon.drillDown,
      sort: "POSTED_DATE_DESC",
    });
    expect(exported.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(
      exported.reduce(
        (sum, row) =>
          sum + (row.direction === "OUTFLOW" ? 1 : -1) * (row.amountMinor - row.reimbursementMinor),
        0,
      ),
    ).toBe(amazon.netSpendingMinor);
    for (const family of ["amazon-prime", "t-and-t", "uber-eats", "uber-trip"] as const) {
      const group = cad.merchantRanking.find((row) => row.merchantFamily === family)!;
      const transactions = await repository.list({ ...group.drillDown });
      expect(netSpending(transactions)).toBe(group.netSpendingMinor);
      expect(transactions).toHaveLength(group.transactionCount);
    }
    for (const filters of [
      { currency: "USD" },
      { accountId: "Credit Card" },
      { categoryId: "report-category-dining" },
      { dateFrom: "2026-02-01", dateTo: "2026-02-28" },
    ]) {
      expect(await repository.list({ ...amazon.drillDown, ...filters })).toEqual([]);
    }
    const exact = await reports.spendingBreakdown({
      grain: "MONTH",
      period: "2026-01",
      normalizedMerchant: "amazon.ca*two 866-216-1072",
    });
    const exactRow = exact.sections[0]!.merchantRanking[0]!;
    expect(await repository.list(exactRow.drillDown)).toHaveLength(1);
    expect(exactRow.drillDown.normalizedMerchant).toBe("amazon.ca*two 866-216-1072");
    const parameters = new URLSearchParams(
      Object.entries(amazon.drillDown).map(([key, value]) => [key, String(value)]),
    );
    const response = await worker.fetch(
      new Request(`https://ledger.example/api/v1/transactions?${parameters.toString()}`),
      workerEnv,
    );
    expect(response.status).toBe(200);
  });
  it("reconciles natural month and quarter results to the durable fixture", async () => {
    const fixture = createReconciledReportFixture();
    const repository = new FinancialReportRepository(cloudflareEnv.DB);
    const january = await repository.cashFlow({ grain: "MONTH", period: "2026-01" });
    const quarter = await repository.cashFlow({ grain: "QUARTER", period: "2026-Q1" });

    expect(january.currencies).toEqual(
      fixture.expected.months.find(({ period }) => period === "2026-01")!.currencies,
    );
    expect(quarter.currencies).toEqual(fixture.expected.quarter.currencies);
    for (const id of [
      ...fixture.expected.excludedTransactionIds.pending,
      ...fixture.expected.excludedTransactionIds.removed,
    ]) {
      expect(january.eligibleTransactionIds).not.toContain(id);
      expect(quarter.eligibleTransactionIds).not.toContain(id);
    }
    for (const id of fixture.expected.internalTransferTransactionIds) {
      expect(january.eligibleTransactionIds).toContain(id);
    }
  });

  it("returns previous-month and previous-year N/A percentages for zero baselines", async () => {
    const result = await new FinancialReportRepository(cloudflareEnv.DB).cashFlowWithComparisons({
      grain: "MONTH",
      period: "2026-01",
    });

    expect(result.previousPeriod.period.label).toBe("2025-12");
    expect(result.previousYear.period.label).toBe("2025-01");
    for (const reference of [result.previousPeriod, result.previousYear]) {
      expect(reference.currencies).toEqual([]);
      expect(reference.comparisons).toHaveLength(2);
      for (const currency of reference.comparisons) {
        expect(currency.income.percentageChangeBasisPoints).toBeNull();
        expect(currency.netSpending.percentageChangeBasisPoints).toBeNull();
        expect(currency.netCashFlow.percentageChangeBasisPoints).toBeNull();
      }
    }
  });

  it("reconciles every category and merchant row through canonical transaction queries", async () => {
    const repository = new FinancialReportRepository(cloudflareEnv.DB);
    const result = await repository.spendingBreakdown({
      grain: "MONTH",
      merchantLimit: 20,
      period: "2026-01",
    });
    const cad = result.sections.find(({ currency }) => currency === "CAD")!;
    const usd = result.sections.find(({ currency }) => currency === "USD")!;

    expect(cad).toMatchObject({
      categoryDistribution: [
        { categoryId: "report-category-expense", netSpendingMinor: 10_000 },
        { categoryId: "report-category-dining", netSpendingMinor: 3_000 },
      ],
      merchantGroupCount: 2,
      netSpendingMinor: 13_000,
    });
    expect(usd).toMatchObject({
      categoryDistribution: [{ categoryId: "report-category-expense", netSpendingMinor: 20_000 }],
      merchantGroupCount: 1,
      netSpendingMinor: 20_000,
    });

    for (const section of result.sections) {
      expect(section.categoryDistribution.reduce((sum, row) => sum + row.netSpendingMinor, 0)).toBe(
        section.netSpendingMinor,
      );
      for (const row of [...section.categoryDistribution, ...section.merchantRanking]) {
        const transactions = await new TransactionRepository(cloudflareEnv.DB).list({
          ...row.drillDown,
          pageSize: 100,
        });
        expect(netSpending(transactions)).toBe(row.netSpendingMinor);
      }
    }
  });

  it("applies account, category, and exact merchant filters to the same population", async () => {
    const repository = new FinancialReportRepository(cloudflareEnv.DB);
    await expect(
      repository.spendingBreakdown({
        accountId: "Daily Chequing",
        categoryId: "report-category-expense",
        grain: "MONTH",
        merchantLimit: 20,
        normalizedMerchant: "report market",
        period: "2026-01",
      }),
    ).resolves.toMatchObject({
      sections: [
        {
          categoryDistribution: [
            { categoryId: "report-category-expense", netSpendingMinor: 10_000 },
          ],
          currency: "CAD",
          merchantRanking: [{ normalizedMerchant: "report market", netSpendingMinor: 10_000 }],
          netSpendingMinor: 10_000,
        },
      ],
    });
  });

  it("filters spending and cash flow by a historical account-only Plaid label", async () => {
    await cloudflareEnv.DB.batch([
      cloudflareEnv.DB.prepare(
        `INSERT INTO connections (
          id, institution_id, institution_name, plaid_item_id,
          access_token_ciphertext, access_token_iv, token_key_version,
          status, created_at, updated_at, version
        ) VALUES (
          'connection-report-legacy', 'ins_legacy', 'Legacy Bank',
          'plaid-item-report-legacy', X'01', X'02', 1, 'DISCONNECTED', ?, ?, 1
        )`,
      ).bind(NOW, NOW),
      cloudflareEnv.DB.prepare(
        `INSERT INTO accounts (
          id, connection_id, plaid_account_id, display_name,
          type, subtype, currency, enabled, created_at, updated_at, version
        ) VALUES (
          'account-report-legacy', 'connection-report-legacy',
          'plaid-account-report-legacy', 'Legacy Savings', 'DEPOSITORY', 'CHECKING',
          'CAD', 0, ?, ?, 1
        )`,
      ).bind(NOW, NOW),
      cloudflareEnv.DB.prepare(
        `INSERT INTO transactions (
          id, source, account_id, plaid_transaction_id, status, posted_date,
          amount_minor, direction, currency, raw_description, category_id,
          categorization_source, needs_review, created_at, updated_at, version
        ) VALUES (
          'transaction-report-legacy', 'PLAID', 'account-report-legacy',
          'plaid-transaction-report-legacy', 'POSTED', '2026-01-20', 777,
          'OUTFLOW', 'CAD', 'Legacy purchase', 'report-category-expense',
          'PLAID', 0, ?, ?, 1
        )`,
      ).bind(NOW, NOW),
    ]);
    const repository = new FinancialReportRepository(cloudflareEnv.DB);

    await expect(
      repository.spendingBreakdown({
        accountId: "Legacy Savings",
        grain: "MONTH",
        period: "2026-01",
      }),
    ).resolves.toMatchObject({ sections: [{ currency: "CAD", netSpendingMinor: 777 }] });
    await expect(
      repository.cashFlow({
        accountId: "Legacy Savings",
        grain: "MONTH",
        period: "2026-01",
      }),
    ).resolves.toMatchObject({
      currencies: [{ currency: "CAD", netCashFlowMinor: -777, netSpendingMinor: 777 }],
    });
  });

  it("serves the strict spending report envelope and rejects ambiguous queries", async () => {
    const response = await worker.fetch(
      new Request(
        "https://ledger.example/api/v1/reports/spending?grain=MONTH&period=2026-01&currency=CAD&merchantLimit=1",
      ),
      workerEnv,
    );
    expect(response.status).toBe(200);
    const body = spendingReportResponseSchema.parse(await response.json());
    expect(body.data.sections).toMatchObject([
      { currency: "CAD", merchantGroupCount: 2, netSpendingMinor: 13_000 },
    ]);
    expect(body.data.sections[0]!.merchantRanking).toHaveLength(1);
    expect(body.meta.freshness).toMatchObject({
      generatedAt: NOW,
    });
    expect(body.meta.query).toEqual({
      currency: "CAD",
      grain: "MONTH",
      merchantLimit: 1,
      period: "2026-01",
    });

    const invalid = await worker.fetch(
      new Request(
        "https://ledger.example/api/v1/reports/spending?grain=MONTH&period=2026-01&normalizedMerchant=acme&merchantMissing=true",
      ),
      workerEnv,
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("serves cash-flow comparisons only as independent currency sections", async () => {
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/reports/cash-flow?grain=MONTH&period=2026-01"),
      workerEnv,
    );
    expect(response.status).toBe(200);
    const raw: unknown = await response.json();
    const body = cashFlowReportResponseSchema.parse(raw);
    expect(body.data.sections.map(({ currency }) => currency)).toEqual(["CAD", "USD"]);
    expect(body.data.sections.find(({ currency }) => currency === "CAD")).toMatchObject({
      current: { incomeMinor: 499_000, netCashFlowMinor: 486_000, netSpendingMinor: 13_000 },
    });
    expect(body.data.sections.find(({ currency }) => currency === "USD")).toMatchObject({
      current: { incomeMinor: 100_000, netCashFlowMinor: 80_000, netSpendingMinor: 20_000 },
    });
    expect(raw).not.toHaveProperty("data.total");
    expect(raw).not.toHaveProperty("data.grandTotalMinor");

    const cadOnly = await worker.fetch(
      new Request(
        "https://ledger.example/api/v1/reports/cash-flow?grain=MONTH&period=2026-01&currency=CAD",
      ),
      workerEnv,
    );
    expect(cadOnly.status).toBe(200);
    const cadBody = cashFlowReportResponseSchema.parse(await cadOnly.json());
    expect(cadBody.data.sections.map(({ currency }) => currency)).toEqual(["CAD"]);
    expect(cadBody.data.sections[0]!.current.netSpendingMinor).toBe(13_000);
  });
});
