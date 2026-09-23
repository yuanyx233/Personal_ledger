import {
  manualTransactionCreateResponseSchema,
  manualTransactionMutationResponseSchema,
  manualTransactionPreviewResponseSchema,
} from "@ledger/domain/api-contracts";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";
import { clearCategoryAudits } from "./support/category-audits";
import { FinancialReportRepository } from "@ledger/persistence";

const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;
let currentTime = "2026-07-15T12:00:00.000Z";
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  () => new Date(currentTime),
);

let csrfToken: string;

const VALID_CREATE = {
  accountLabel: "Cash wallet",
  amount: "12.34",
  categoryId: "category-expense",
  currency: "CAD",
  description: "Neighbourhood market",
  direction: "OUTFLOW",
  postedDate: "2026-07-15",
} as const;

function mutationRequest(
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: Record<string, unknown>,
): Request {
  return new Request(`https://ledger.example/api/v1${path}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://ledger.example",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrfToken,
    },
    method,
  });
}

async function createTransaction(body: Record<string, unknown> = VALID_CREATE) {
  return worker.fetch(mutationRequest("/transactions", "POST", body), workerEnv);
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

beforeEach(async () => {
  currentTime = "2026-07-15T12:00:00.000Z";
  await clearCategoryAudits(cloudflareEnv.DB);
  await cloudflareEnv.DB.batch(
    ["transactions", "merchant_rules", "categories WHERE system_key IS NULL"].map((table) =>
      cloudflareEnv.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-expense', 'Expense', 'EXPENSE', 1, 1, ?, ?, 1)`,
    ).bind(currentTime, currentTime),
    cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-income', 'Income', 'INCOME', 1, 1, ?, ?, 1)`,
    ).bind(currentTime, currentTime),
    cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-inactive', 'Inactive', 'EXPENSE', 1, 0, ?, ?, 1)`,
    ).bind(currentTime, currentTime),
  ]);
});

describe("protected manual transaction CRUD", () => {
  it("creates an exact month-end installment schedule atomically", async () => {
    const response = await createTransaction({
      ...VALID_CREATE,
      amount: "100.00",
      installmentCount: 3,
      postedDate: "2025-01-31",
      reimbursementAmount: "66.67",
    });
    const body = manualTransactionCreateResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body.data.transactions).toHaveLength(3);
    const groupId = body.data.transactions?.[0]?.installment?.groupId;
    expect(typeof groupId).toBe("string");
    expect(
      body.data.transactions?.map(
        ({ amountMinor, installment, postedDate, reimbursementMinor }) => ({
          amountMinor,
          installment,
          postedDate,
          reimbursementMinor,
        }),
      ),
    ).toEqual([
      {
        amountMinor: 3333,
        installment: { count: 3, groupId, number: 1 },
        postedDate: "2025-01-31",
        reimbursementMinor: 2222,
      },
      {
        amountMinor: 3333,
        installment: { count: 3, groupId, number: 2 },
        postedDate: "2025-02-28",
        reimbursementMinor: 2222,
      },
      {
        amountMinor: 3334,
        installment: { count: 3, groupId, number: 3 },
        postedDate: "2025-03-31",
        reimbursementMinor: 2223,
      },
    ]);
    expect(
      new Set(body.data.transactions?.map(({ installment }) => installment?.groupId)).size,
    ).toBe(1);
    expect(body.data.transaction.id).toBe(body.data.transactions?.[0]?.id);
    expect(
      await cloudflareEnv.DB.prepare(
        `SELECT amount_minor, posted_date, installment_number, installment_count
         FROM transactions ORDER BY installment_number`,
      ).all(),
    ).toMatchObject({
      results: [
        {
          amount_minor: 3333,
          installment_count: 3,
          installment_number: 1,
          posted_date: "2025-01-31",
        },
        {
          amount_minor: 3333,
          installment_count: 3,
          installment_number: 2,
          posted_date: "2025-02-28",
        },
        {
          amount_minor: 3334,
          installment_count: 3,
          installment_number: 3,
          posted_date: "2025-03-31",
        },
      ],
    });
  });

  it("keeps every installment reimbursement within that installment amount", async () => {
    const response = await createTransaction({
      ...VALID_CREATE,
      amount: "0.06",
      installmentCount: 3,
      reimbursementAmount: "0.05",
    });
    const body = manualTransactionCreateResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(
      body.data.transactions?.map(({ amountMinor, reimbursementMinor }) => ({
        amountMinor,
        reimbursementMinor,
      })),
    ).toEqual([
      { amountMinor: 2, reimbursementMinor: 1 },
      { amountMinor: 2, reimbursementMinor: 2 },
      { amountMinor: 2, reimbursementMinor: 2 },
    ]);
  });

  it("rejects installment counts outside the bounded integer range", async () => {
    for (const installmentCount of [1, 61, 2.5, "3"]) {
      expect((await createTransaction({ ...VALID_CREATE, installmentCount })).status).toBe(422);
    }
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM transactions").first("total"),
    ).toBe(0);
  });

  it("applies one confirmed merchant rule to every installment", async () => {
    const response = await createTransaction({
      ...VALID_CREATE,
      categoryId: "category-expense",
      description: "IKEA",
      installmentCount: 2,
      rememberMerchant: true,
    });
    const body = manualTransactionCreateResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body.data.transactions).toHaveLength(2);
    expect(new Set(body.data.transactions?.map(({ categoryId }) => categoryId))).toEqual(
      new Set(["category-expense"]),
    );
    expect(
      new Set(
        (
          await cloudflareEnv.DB.prepare(
            "SELECT category_rule_id FROM transactions ORDER BY installment_number",
          ).all<{ category_rule_id: string }>()
        ).results.map(({ category_rule_id }) => category_rule_id),
      ).size,
    ).toBe(1);
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM merchant_rules").first("total"),
    ).toBe(1);
  });

  it("previews a new merchant without writing and confirms transaction plus rule atomically", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO categories (
        id, name, kind, editable, active, created_at, updated_at, version
      ) VALUES ('category-expense-housing', 'Housing', 'EXPENSE', 1, 1, ?, ?, 1)`,
    )
      .bind(currentTime, currentTime)
      .run();
    const previewInput = {
      accountLabel: "RBC Credit",
      amount: "29.99",
      currency: "CAD",
      description: "IKEA",
      direction: "OUTFLOW",
      postedDate: "2026-07-15",
    } as const;

    const preview = await worker.fetch(
      mutationRequest("/transaction-previews", "POST", previewInput),
      workerEnv,
    );
    expect(preview.status).toBe(200);
    expect(manualTransactionPreviewResponseSchema.parse(await preview.json())).toMatchObject({
      data: {
        category: { id: "category-expense-housing", name: "Housing" },
        kind: "NEW_MERCHANT",
      },
    });
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM transactions").first("total"),
    ).toBe(0);
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM merchant_rules").first("total"),
    ).toBe(0);

    const confirmed = await createTransaction({
      ...previewInput,
      categoryId: "category-expense-housing",
      rememberMerchant: true,
    });
    expect(confirmed.status).toBe(201);
    expect(manualTransactionCreateResponseSchema.parse(await confirmed.json())).toMatchObject({
      data: {
        categoryConfirmationRequired: false,
        transaction: {
          categorizationSource: "RULE",
          categoryId: "category-expense-housing",
          normalizedMerchant: "ikea",
        },
      },
    });
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM transactions").first("total"),
    ).toBe(1);
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM merchant_rules").first("total"),
    ).toBe(1);

    const knownPreview = await worker.fetch(
      mutationRequest("/transaction-previews", "POST", previewInput),
      workerEnv,
    );
    expect(knownPreview.status).toBe(200);
    expect(manualTransactionPreviewResponseSchema.parse(await knownPreview.json()).data.kind).toBe(
      "KNOWN_MERCHANT",
    );

    const rejected = await createTransaction({
      ...previewInput,
      categoryId: "category-missing",
      description: "Another new merchant",
      rememberMerchant: true,
    });
    expect(rejected.status).toBe(422);
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM transactions").first("total"),
    ).toBe(1);
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM merchant_rules").first("total"),
    ).toBe(1);
  });

  it("ignores a saved Amazon category and requires a fresh non-writing preview", async () => {
    await cloudflareEnv.DB.batch([
      cloudflareEnv.DB.prepare(
        `INSERT INTO categories (
          id, name, kind, editable, active, created_at, updated_at, version
        ) VALUES ('category-expense-shopping', 'Shopping', 'EXPENSE', 1, 1, ?, ?, 1)`,
      ).bind(currentTime, currentTime),
      cloudflareEnv.DB.prepare(
        `INSERT INTO merchant_rules (
          id, normalized_merchant, display_merchant, category_id,
          active, created_at, updated_at, version
        ) VALUES ('merchant-rule-amazon', 'amazon', 'Amazon', 'category-expense', 1, ?, ?, 1)`,
      ).bind(currentTime, currentTime),
    ]);

    const response = await worker.fetch(
      mutationRequest("/transaction-previews", "POST", {
        accountLabel: "RBC Credit",
        amount: "25.00",
        currency: "CAD",
        description: "Amazon",
        direction: "OUTFLOW",
        postedDate: "2026-07-15",
      }),
      workerEnv,
    );

    expect(response.status).toBe(200);
    expect(manualTransactionPreviewResponseSchema.parse(await response.json())).toMatchObject({
      data: {
        category: { id: "category-expense-shopping", name: "Shopping" },
        kind: "NEW_MERCHANT",
      },
    });
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM transactions").first("total"),
    ).toBe(0);
    expect(
      await cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM merchant_rules").first("total"),
    ).toBe(1);
  });

  it("requires an explicit category for every Amazon and Costco write despite saved rules", async () => {
    await cloudflareEnv.DB.batch(
      [
        ["merchant-rule-amazon", "amazon", "Amazon"],
        ["merchant-rule-amazon-prime", "amazon prime", "Amazon Prime"],
        ["merchant-rule-costco", "costco", "Costco"],
      ].map(([id, normalizedMerchant, displayMerchant]) =>
        cloudflareEnv.DB.prepare(
          `INSERT INTO merchant_rules (
              id, normalized_merchant, display_merchant, category_id,
              active, created_at, updated_at, version
            ) VALUES (?, ?, ?, 'category-expense', 1, ?, ?, 1)`,
        ).bind(id, normalizedMerchant, displayMerchant, currentTime, currentTime),
      ),
    );

    for (const description of ["Amazon", "Amazon.com Prime", "Costco"]) {
      const response = await createTransaction({
        accountLabel: "RBC Credit",
        amount: "25.00",
        currency: "CAD",
        description,
        direction: "OUTFLOW",
        postedDate: "2026-07-15",
      });
      expect(response.status).toBe(409);
    }
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS total FROM transactions").first("total"),
    ).resolves.toBe(0);
  });

  it("keeps the payment and excludes reimbursement receipts without double deduction", async () => {
    const meal = await createTransaction({
      ...VALID_CREATE,
      amount: "300",
      reimbursementAmount: "200",
    });
    expect(meal.status).toBe(201);
    const mealBody = manualTransactionCreateResponseSchema.parse(await meal.json());
    expect(mealBody.data.transaction).toMatchObject({
      amountMinor: 30000,
      reimbursementMinor: 20000,
    });
    const receipt = await createTransaction({
      ...VALID_CREATE,
      amount: "200",
      direction: "INFLOW",
      categoryId: "category-income",
      description: "EMT",
      reimbursementAmount: "200",
    });
    expect(receipt.status).toBe(201);
    const reports = new FinancialReportRepository(cloudflareEnv.DB);
    const query = { grain: "MONTH", period: "2026-07" };
    expect((await reports.cashFlow(query)).currencies[0]).toMatchObject({
      incomeMinor: 0,
      netSpendingMinor: 10000,
    });
    expect((await reports.spendingBreakdown(query)).sections[0]).toMatchObject({
      netSpendingMinor: 10000,
    });

    // A repayment in an expense category must not become a second refund.
    const expenseReceipt = await createTransaction({
      ...VALID_CREATE,
      amount: "200",
      direction: "INFLOW",
      reimbursementAmount: "200",
    });
    expect(expenseReceipt.status).toBe(201);
    expect((await reports.cashFlow(query)).currencies[0]).toMatchObject({
      incomeMinor: 0,
      netSpendingMinor: 10000,
    });
    // Descriptions alone never opt a receipt into reimbursement handling.
    expect(
      (
        await createTransaction({
          ...VALID_CREATE,
          amount: "50",
          direction: "INFLOW",
          categoryId: "category-income",
          description: "EMT",
        })
      ).status,
    ).toBe(201);
    expect((await reports.cashFlow(query)).currencies[0]).toMatchObject({
      incomeMinor: 5000,
      netSpendingMinor: 10000,
    });
  });

  it("adjusts posted records with version checks and rejects invalid deductions atomically", async () => {
    const created = await createTransaction({
      ...VALID_CREATE,
      amount: "300",
      reimbursementAmount: "200",
    });
    expect(created.status).toBe(201);
    const body = manualTransactionCreateResponseSchema.parse(await created.json());
    const path = `/transactions/${body.data.transaction.id}`;
    for (const reimbursementAmount of ["300.01", "-1", "1.001"]) {
      expect(
        (
          await worker.fetch(
            mutationRequest(path, "PATCH", { reimbursementAmount, version: 1 }),
            workerEnv,
          )
        ).status,
      ).toBe(422);
      expect((await createTransaction({ ...VALID_CREATE, reimbursementAmount })).status).toBe(422);
    }
    expect(
      (await worker.fetch(mutationRequest(path, "PATCH", { amount: "100", version: 1 }), workerEnv))
        .status,
    ).toBe(422);
    expect(
      (
        await worker.fetch(
          mutationRequest(path, "PATCH", { reimbursementAmount: "0", version: 1 }),
          workerEnv,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          mutationRequest(path, "PATCH", { reimbursementAmount: "100", version: 1 }),
          workerEnv,
        )
      ).status,
    ).toBe(409);
    const record = await cloudflareEnv.DB.prepare(
      "SELECT amount_minor, reimbursement_minor, version FROM transactions WHERE id = ?",
    )
      .bind(body.data.transaction.id)
      .first();
    expect(record).toEqual({ amount_minor: 30000, reimbursement_minor: 0, version: 2 });
  });

  it("allows later corrections on imported receipts and keeps cross-month reimbursements out of income", async () => {
    const meal = await createTransaction({
      ...VALID_CREATE,
      amount: "300",
      reimbursementAmount: "200",
    });
    expect(meal.status).toBe(201);
    const receipt = await createTransaction({
      ...VALID_CREATE,
      amount: "200",
      categoryId: "category-income",
      direction: "INFLOW",
      postedDate: "2026-08-01",
    });
    const body = manualTransactionCreateResponseSchema.parse(await receipt.json());
    const id = body.data.transaction.id;
    await cloudflareEnv.DB.prepare(
      "UPDATE transactions SET source = 'CSV', import_fingerprint = ? WHERE id = ?",
    )
      .bind("d".repeat(64), id)
      .run();
    const adjusted = await worker.fetch(
      mutationRequest(`/transactions/${id}`, "PATCH", { reimbursementAmount: "200", version: 1 }),
      workerEnv,
    );
    expect(adjusted.status).toBe(200);
    expect(await adjusted.json()).toMatchObject({
      data: {
        transaction: { source: "CSV", amountMinor: 20000, reimbursementMinor: 20000, version: 2 },
      },
    });
    const reports = new FinancialReportRepository(cloudflareEnv.DB);
    expect(
      (await reports.cashFlow({ grain: "MONTH", period: "2026-07" })).currencies[0],
    ).toMatchObject({ incomeMinor: 0, netSpendingMinor: 10000 });
    expect(
      (await reports.cashFlow({ grain: "MONTH", period: "2026-08" })).currencies[0],
    ).toMatchObject({ incomeMinor: 0, netSpendingMinor: 0 });
    await expect(
      cloudflareEnv.DB.prepare(
        "UPDATE transactions SET reimbursement_minor = amount_minor + 1 WHERE id = ?",
      )
        .bind(id)
        .run(),
    ).rejects.toThrow();
    await cloudflareEnv.DB.prepare("UPDATE transactions SET status = 'REMOVED' WHERE id = ?")
      .bind(id)
      .run();
    expect(
      (
        await worker.fetch(
          mutationRequest(`/transactions/${id}`, "PATCH", { reimbursementAmount: "0", version: 2 }),
          workerEnv,
        )
      ).status,
    ).toBe(404);
  });

  it("creates an exact posted manual record with provenance and audit timestamps", async () => {
    const hostileText = "Cash'); DROP TABLE categories; --";
    const response = await createTransaction({
      ...VALID_CREATE,
      accountLabel: hostileText,
      description: "<script>alert('stored text')</script>",
    });
    const responseText = await response.text();
    const body = manualTransactionCreateResponseSchema.parse(JSON.parse(responseText));

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(
      `/api/v1/transactions/${body.data.transaction.id}`,
    );
    expect(body.data.categoryConfirmationRequired).toBe(false);
    expect(body.data.transaction).toEqual({
      accountLabel: hostileText,
      amountMinor: 1234,
      reimbursementMinor: 0,
      categorizationSource: "MANUAL",
      categoryId: "category-expense",
      createdAt: currentTime,
      currency: "CAD",
      description: "<script>alert('stored text')</script>",
      direction: "OUTFLOW",
      id: body.data.transaction.id,
      merchantName: "<script>alert('stored text')</script>",
      normalizedMerchant: "<script>alert('stored text')</script>",
      postedDate: "2026-07-15",
      source: "MANUAL",
      status: "POSTED",
      updatedAt: currentTime,
      version: 1,
    });
    expect(responseText).not.toContain("providerAmountDecimal");
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT account_label, amount_minor, typeof(amount_minor) AS storage_type FROM transactions",
      ).first(),
    ).resolves.toEqual({
      account_label: hostileText,
      amount_minor: 1234,
      storage_type: "integer",
    });
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT COUNT(*) AS count FROM categories WHERE system_key IS NULL",
      ).first<number>("count"),
    ).resolves.toBe(3);
  });

  it("rejects an unknown quick merchant before writing without a confirmed category", async () => {
    const response = await createTransaction({
      accountLabel: "RBC Credit",
      amount: "8.75",
      currency: "CAD",
      description: "New Cafe",
      direction: "OUTFLOW",
      postedDate: "2026-07-15",
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONFLICT",
        message: "Confirm a category for this merchant before recording the transaction.",
      },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).resolves.toBe(0);
  });

  it("applies an exact learned merchant rule without asking for confirmation", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO merchant_rules (
        id, normalized_merchant, display_merchant, category_id, active,
        created_at, updated_at, version
      ) VALUES ('merchant-rule-known-shop', 'known shop', 'Known Shop',
        'category-expense', 1, ?, ?, 1)`,
    )
      .bind(currentTime, currentTime)
      .run();

    const response = await createTransaction({
      accountLabel: "RBC Credit",
      amount: "19.99",
      currency: "CAD",
      description: "KNOWN SHOP",
      direction: "OUTFLOW",
      postedDate: "2026-07-15",
    });
    const body = manualTransactionCreateResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body.data.categoryConfirmationRequired).toBe(false);
    expect(body.data.transaction).toMatchObject({
      categorizationSource: "RULE",
      categoryId: "category-expense",
      normalizedMerchant: "known shop",
    });
  });

  it("applies partial updates and returns the current version for stale writes", async () => {
    const createdResponse = await createTransaction();
    const created = manualTransactionCreateResponseSchema.parse(await createdResponse.json()).data
      .transaction;
    currentTime = "2026-07-15T13:00:00.000Z";

    const updatedResponse = await worker.fetch(
      mutationRequest(`/transactions/${created.id}`, "PATCH", {
        amount: "0.01",
        categoryId: "category-income",
        description: "Corrected description",
        direction: "INFLOW",
        version: 1,
      }),
      workerEnv,
    );
    const updated = manualTransactionMutationResponseSchema.parse(await updatedResponse.json()).data
      .transaction;

    expect(updatedResponse.status).toBe(200);
    expect(updated).toMatchObject({
      amountMinor: 1,
      categorizationSource: "MANUAL",
      categoryId: "category-income",
      createdAt: "2026-07-15T12:00:00.000Z",
      description: "Corrected description",
      direction: "INFLOW",
      updatedAt: currentTime,
      version: 2,
    });

    const staleResponse = await worker.fetch(
      mutationRequest(`/transactions/${created.id}`, "PATCH", {
        description: "Stale overwrite",
        version: 1,
      }),
      workerEnv,
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toEqual({
      error: {
        code: "VERSION_CONFLICT",
        currentVersion: 2,
        message: "The transaction changed. Refresh and try again.",
      },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT raw_description, version FROM transactions WHERE id = ?")
        .bind(created.id)
        .first(),
    ).resolves.toEqual({ raw_description: "Corrected description", version: 2 });
  });

  it("soft-deletes only manual records and preserves deletion provenance", async () => {
    const createdResponse = await createTransaction();
    const created = manualTransactionCreateResponseSchema.parse(await createdResponse.json()).data
      .transaction;
    currentTime = "2026-07-15T14:00:00.000Z";

    const response = await worker.fetch(
      mutationRequest(`/transactions/${created.id}`, "DELETE", { version: 1 }),
      workerEnv,
    );
    const deleted = manualTransactionMutationResponseSchema.parse(await response.json()).data
      .transaction;

    expect(response.status).toBe(200);
    expect(deleted).toMatchObject({ status: "REMOVED", updatedAt: currentTime, version: 2 });

    const staleResponse = await worker.fetch(
      mutationRequest(`/transactions/${created.id}`, "PATCH", {
        description: "Stale after delete",
        version: 1,
      }),
      workerEnv,
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT", currentVersion: 2 },
    });
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT source, status, updated_at, version FROM transactions WHERE id = ?",
      )
        .bind(created.id)
        .first(),
    ).resolves.toEqual({
      source: "MANUAL",
      status: "REMOVED",
      updated_at: currentTime,
      version: 2,
    });
  });

  it("cannot edit or delete a committed CSV source through the manual route", async () => {
    await cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_label, import_fingerprint, status, posted_date,
        amount_minor, direction, currency, raw_description, category_id,
        categorization_source, needs_review, created_at, updated_at, version
      ) VALUES (
        'transaction-csv-1', 'CSV', 'Imported account', 'csv-fingerprint-1',
        'POSTED', '2026-07-15', 1234, 'OUTFLOW', 'CAD', 'Imported row',
        'category-expense', 'MANUAL', 0, ?, ?, 1
      )`,
    )
      .bind(currentTime, currentTime)
      .run();

    const [patchResponse, deleteResponse] = await Promise.all([
      worker.fetch(
        mutationRequest("/transactions/transaction-csv-1", "PATCH", {
          description: "Forged edit",
          version: 1,
        }),
        workerEnv,
      ),
      worker.fetch(
        mutationRequest("/transactions/transaction-csv-1", "DELETE", { version: 1 }),
        workerEnv,
      ),
    ]);

    expect(patchResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT raw_description, source, status, version FROM transactions WHERE id = ?",
      )
        .bind("transaction-csv-1")
        .first(),
    ).resolves.toEqual({
      raw_description: "Imported row",
      source: "CSV",
      status: "POSTED",
      version: 1,
    });
  });

  it("rejects invalid mutation shapes, methods, identities, and categories", async () => {
    const createdResponse = await createTransaction();
    const created = manualTransactionCreateResponseSchema.parse(await createdResponse.json()).data
      .transaction;

    const [emptyPatch, forgedDelete, missingCategory, invalidId, unsupportedMethod] =
      await Promise.all([
        worker.fetch(
          mutationRequest(`/transactions/${created.id}`, "PATCH", { version: 1 }),
          workerEnv,
        ),
        worker.fetch(
          mutationRequest(`/transactions/${created.id}`, "DELETE", {
            force: true,
            version: 1,
          }),
          workerEnv,
        ),
        worker.fetch(
          mutationRequest(`/transactions/${created.id}`, "PATCH", {
            categoryId: "category-missing",
            version: 1,
          }),
          workerEnv,
        ),
        worker.fetch(
          mutationRequest("/transactions/not-a-transaction-id", "PATCH", {
            description: "No target",
            version: 1,
          }),
          workerEnv,
        ),
        worker.fetch(
          mutationRequest(`/transactions/${created.id}`, "PUT", { version: 1 }),
          workerEnv,
        ),
      ]);

    expect(emptyPatch.status).toBe(422);
    expect(forgedDelete.status).toBe(422);
    expect(missingCategory.status).toBe(422);
    expect(invalidId.status).toBe(422);
    expect(unsupportedMethod.status).toBe(405);
    await expect(
      cloudflareEnv.DB.prepare("SELECT category_id, status, version FROM transactions WHERE id = ?")
        .bind(created.id)
        .first(),
    ).resolves.toEqual({ category_id: "category-expense", status: "POSTED", version: 1 });
  });

  it("sanitizes manual transaction database failures", async () => {
    const privateDetail = "SQLITE_PRIVATE transaction body and account label";
    const failingEnv = {
      ...workerEnv,
      DB: {
        prepare() {
          throw new Error(privateDetail);
        },
      } as unknown as D1Database,
    };

    const [createResponse, updateResponse] = await Promise.all([
      worker.fetch(mutationRequest("/transactions", "POST", VALID_CREATE), failingEnv),
      worker.fetch(
        mutationRequest("/transactions/transaction-manual-1", "PATCH", {
          description: "Valid update",
          version: 1,
        }),
        failingEnv,
      ),
    ]);

    for (const response of [createResponse, updateResponse]) {
      expect(response.status).toBe(500);
      const responseText = await response.text();
      expect(responseText).not.toContain(privateDetail);
      expect(JSON.parse(responseText)).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
        },
      });
    }
  });

  it("records an amount in another two-decimal currency", async () => {
    const response = await createTransaction({
      ...VALID_CREATE,
      currency: "EUR",
      description: "Berlin groceries",
    });

    expect(response.status).toBe(201);
    const body = manualTransactionCreateResponseSchema.parse(await response.json());
    expect(body.data.transaction).toMatchObject({ amountMinor: 1234, currency: "EUR" });
  });

  it("rejects malformed or inactive-category writes without creating a transaction", async () => {
    for (const body of [
      { ...VALID_CREATE, amount: 12.34 },
      { ...VALID_CREATE, amount: "12.345" },
      { ...VALID_CREATE, categoryId: "category-inactive" },
      { ...VALID_CREATE, categoryId: "category-missing" },
      { ...VALID_CREATE, currency: "cad" },
      // JPY has no minor unit, so the fixed 1/100 storage scale would misrecord it.
      { ...VALID_CREATE, currency: "JPY" },
      { ...VALID_CREATE, plaidTransactionId: "forged-provider-identity" },
    ]) {
      const response = await createTransaction(body);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first<number>("count"),
    ).resolves.toBe(0);
  });
});
