import { expect, test } from "@playwright/test";
import type { TransactionDetailResponse } from "@ledger/domain/api-contracts";

const NOW = "2026-07-17T12:00:00.000Z";

function detailTransaction() {
  return {
    accountLabel: "Daily Chequing",
    amountMinor: 14327,
    reimbursementMinor: 0,
    authorizedDate: "2026-07-16",
    categorizationSource: "RULE" as const,
    categoryAudits: [
      {
        createdAt: NOW,
        id: "category-audit-1",
        newCategoryId: "category-expense-shopping",
        newCategoryRuleId: null,
        newSource: "RULE" as const,
        oldCategoryId: null,
        oldCategoryRuleId: null,
        oldSource: "UNCLASSIFIED" as const,
        reason: "RULE_CATEGORIZATION",
      },
    ],
    categoryId: "category-expense-shopping",
    categoryRuleId: null,
    createdAt: NOW,
    currency: "CAD",
    description: '<img src=x onerror="alert(1)"> raw bank text',
    direction: "OUTFLOW" as const,
    id: "transaction-detail-1",
    lifecycle: {
      pendingTransactionId: "transaction-detail-pending",
      replacedByTransactionId: null,
    },
    merchantName: "Untrusted <script>merchant</script>",
    needsReview: true,
    normalizedMerchant: "untrusted merchant",
    paymentMetadata: {
      payee: "Fixture Payee",
      payer: null,
      paymentMethod: "INTERAC",
      referenceNumber: "REF-42",
    },
    postedDate: "2026-07-17",
    reviewReason: "AMBIGUOUS_TRANSFER",
    source: "CSV" as const,
    status: "POSTED" as const,
    updatedAt: NOW,
    version: 1,
  };
}

function readModel(transaction: TransactionDetailResponse["data"]["transaction"]) {
  const model: Partial<TransactionDetailResponse["data"]["transaction"]> = { ...transaction };
  delete model.categoryAudits;
  delete model.lifecycle;
  return model;
}

test("edits and clears reimbursement on an imported transaction without changing its amount", async ({
  page,
}) => {
  const transaction = { ...detailTransaction(), amountMinor: 30000, reimbursementMinor: 0 };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session")) {
      await route.fulfill({
        json: {
          data: {
            csrfToken: "csrf.payload",
            identity: { email: "owner@example.invalid" },
            timezone: "America/Toronto",
          },
          meta: {},
        },
      });
    } else if (path.endsWith("/categories")) {
      await route.fulfill({ json: { data: { categories: [] }, meta: {} } });
    } else if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        reimbursementAmount: string;
        version: number;
      };
      expect(body.version).toBe(transaction.version);
      transaction.reimbursementMinor = Number(body.reimbursementAmount) * 100;
      transaction.version += 1;
      await route.fulfill({
        json: {
          data: {
            transaction: readModel(
              transaction as unknown as TransactionDetailResponse["data"]["transaction"],
            ),
          },
          meta: {},
        },
      });
    } else {
      await route.fulfill({ json: { data: { transaction }, meta: {} } });
    }
  });
  await page.goto(`/transactions/${transaction.id}`);
  await page.getByRole("checkbox", { name: "分摊 / 报销抵扣" }).check();
  await page.getByLabel("抵扣金额", { exact: true }).fill("200");
  await expect(page.locator(".reimbursement-preview")).toContainText("100.00");
  await page.getByRole("button", { name: "保存抵扣" }).click();
  await expect(page.getByRole("status")).toContainText("抵扣已保存");
  await expect(page.getByText("原金额：$300.00 · 已抵扣：$200.00")).toBeVisible();
  expect(transaction.amountMinor).toBe(30000);
  await page.getByRole("checkbox", { name: "分摊 / 报销抵扣" }).uncheck();
  await page.getByRole("button", { name: "保存抵扣" }).click();
  await expect(page.getByText("原金额：$300.00 · 已抵扣：$0.00")).toBeVisible();
  expect(transaction.reimbursementMinor).toBe(0);
  expect(errors).toEqual([]);
});

test("opens a generated CSV transaction ID as a detail route", async ({ page }) => {
  const transactionId = "csv-import-preview-12345678-1234-1234-1234-123456789abc-2";
  const detail = {
    ...detailTransaction(),
    accountLabel: "RBC Credit",
    categorizationSource: "UNCLASSIFIED" as const,
    categoryAudits: [],
    categoryId: null,
    description: "COMPASS ACCOUNT BURNABY",
    id: transactionId,
    lifecycle: { pendingTransactionId: null, replacedByTransactionId: null },
    merchantName: "Compass",
    needsReview: true,
    normalizedMerchant: "compass",
    paymentMetadata: { payee: null, payer: null, paymentMethod: null, referenceNumber: null },
    reviewReason: "UNCLASSIFIED_MERCHANT",
    source: "CSV" as const,
  } as unknown as TransactionDetailResponse["data"]["transaction"];

  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          csrfToken: "fixture-payload.fixture-signature",
          identity: { email: "owner@example.invalid" },
          timezone: "America/Toronto",
        },
        meta: {},
      }),
      contentType: "application/json",
    }),
  );
  await page.route("**/api/v1/categories", (route) =>
    route.fulfill({
      body: JSON.stringify({ data: { categories: [] }, meta: {} }),
      contentType: "application/json",
    }),
  );
  await page.route(`**/api/v1/transactions/${transactionId}`, (route) =>
    route.fulfill({
      body: JSON.stringify({ data: { transaction: detail }, meta: {} }),
      contentType: "application/json",
    }),
  );

  await page.goto(`/transactions/${transactionId}`);

  await expect(page.getByRole("heading", { level: 1, name: "交易详情" })).toBeVisible();
  await expect(page.getByText("Compass", { exact: true })).toBeVisible();
});

test("shows traceable raw detail and performs explicit scoped corrections without bank automation", async ({
  page,
}) => {
  const browserProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));

  let detail = detailTransaction() as unknown as TransactionDetailResponse["data"]["transaction"];
  const mutations: Array<{ body: unknown; method: string; path: string; token: string | null }> =
    [];
  const categories = [
    {
      active: true,
      createdAt: NOW,
      editable: true,
      id: "category-expense-food",
      kind: "EXPENSE",
      name: "Food & Dining",
      systemKey: null,
      updatedAt: NOW,
      version: 1,
    },
    {
      active: true,
      createdAt: NOW,
      editable: true,
      id: "category-expense-shopping",
      kind: "EXPENSE",
      name: "Shopping",
      systemKey: null,
      updatedAt: NOW,
      version: 1,
    },
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
  ];

  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          csrfToken: "fixture-payload.fixture-signature",
          identity: { email: "owner@example.invalid" },
          timezone: "America/Toronto",
        },
        meta: {},
      }),
      contentType: "application/json",
    }),
  );
  await page.route("**/api/v1/categories", (route) =>
    route.fulfill({
      body: JSON.stringify({ data: { categories }, meta: {} }),
      contentType: "application/json",
    }),
  );
  await page.route("**/api/v1/transactions/transaction-detail-1", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({ data: { transaction: detail }, meta: {} }),
        contentType: "application/json",
      });
      return;
    }
    mutations.push({
      body: route.request().postDataJSON(),
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      token: route.request().headers()["x-csrf-token"] ?? null,
    });
    detail = {
      ...detail,
      categorizationSource: "MANUAL",
      categoryAudits: [
        {
          createdAt: NOW,
          id: "category-audit-2",
          newCategoryId: "category-expense-food",
          newCategoryRuleId: null,
          newSource: "MANUAL",
          oldCategoryId: detail.categoryId,
          oldCategoryRuleId: null,
          oldSource: detail.categorizationSource,
          reason: "OWNER_TRANSACTION_OVERRIDE",
        },
        ...detail.categoryAudits,
      ],
      categoryId: "category-expense-food",
      needsReview: false,
      reviewReason: null,
      version: Number(detail.version) + 1,
    } as typeof detail;
    await route.fulfill({
      body: JSON.stringify({ data: { transaction: readModel(detail) }, meta: {} }),
      contentType: "application/json",
    });
  });
  await page.route("**/api/v1/transactions/transaction-detail-1/merchant-rule", async (route) => {
    mutations.push({
      body: route.request().postDataJSON(),
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      token: route.request().headers()["x-csrf-token"] ?? null,
    });
    detail = {
      ...detail,
      categorizationSource: "RULE",
      categoryRuleId: "merchant-rule-detail-1",
      version: Number(detail.version) + 1,
    } as typeof detail;
    await route.fulfill({
      body: JSON.stringify({
        data: {
          merchantRule: {
            active: true,
            categoryId: detail.categoryId,
            createdAt: NOW,
            displayMerchant: detail.merchantName ?? "Unknown merchant",
            id: "merchant-rule-detail-1",
            normalizedMerchant: detail.normalizedMerchant ?? "unknown merchant",
            updatedAt: NOW,
            version: 1,
          },
          transaction: readModel(detail),
        },
        meta: { historicalTransactionsChanged: 0 },
      }),
      contentType: "application/json",
    });
  });
  await page.goto("/transactions/transaction-detail-1");
  await expect(page.getByRole("heading", { level: 1, name: "交易详情" })).toBeVisible();
  await expect(
    page.getByText("Untrusted <script>merchant</script>", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('<img src=x onerror="alert(1)"> raw bank text')).toBeVisible();
  await expect(page.locator("script").filter({ hasText: "merchant" })).toHaveCount(0);
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.getByText("自动识别商户", { exact: true })).toBeVisible();
  await expect(page.getByText("Shopping", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("OWNER_TRANSACTION_OVERRIDE")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  const category = page.getByLabel("新类别");
  await expect(category.getByRole("option", { name: "Transfer" })).toHaveCount(1);
  await category.selectOption("category-expense-food");
  await page.getByRole("button", { name: "只改这一笔" }).click();
  await expect(page.getByText("已只修改当前交易。", { exact: true })).toBeVisible();
  await expect(page.getByText("Food & Dining", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("OWNER_TRANSACTION_OVERRIDE")).toBeVisible();

  await page.getByRole("button", { name: "以后这个商户都这样" }).click();
  await expect(page.getByText("历史交易没有被批量修改", { exact: false })).toBeVisible();
  await expect(page.getByText("我的规则", { exact: true })).toBeVisible();

  expect(mutations).toEqual([
    {
      body: { categoryId: "category-expense-food", version: 1 },
      method: "PATCH",
      path: "/api/v1/transactions/transaction-detail-1",
      token: "fixture-payload.fixture-signature",
    },
    {
      body: { categoryId: "category-expense-food", version: 2 },
      method: "PUT",
      path: "/api/v1/transactions/transaction-detail-1/merchant-rule",
      token: "fixture-payload.fixture-signature",
    },
  ]);
  expect(browserProblems).toEqual([]);
});

test("requires explicit impact confirmation before deleting a manual transaction", async ({
  page,
}) => {
  let deleted = false;
  let deleteBody: unknown = null;
  const manualDetail = {
    ...detailTransaction(),
    authorizedDate: null,
    categorizationSource: "MANUAL" as const,
    categoryAudits: [],
    description: "Manual lunch",
    id: "transaction-manual-delete",
    lifecycle: { pendingTransactionId: null, replacedByTransactionId: null },
    merchantName: null,
    needsReview: false,
    normalizedMerchant: null,
    paymentMetadata: { payee: null, payer: null, paymentMethod: null, referenceNumber: null },
    reviewReason: null,
    source: "MANUAL" as const,
  } as unknown as TransactionDetailResponse["data"]["transaction"];
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          csrfToken: "fixture-payload.fixture-signature",
          identity: { email: "owner@example.invalid" },
          timezone: "America/Toronto",
        },
        meta: {},
      }),
      contentType: "application/json",
    }),
  );
  await page.route("**/api/v1/categories", (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          categories: [
            {
              active: true,
              createdAt: NOW,
              editable: true,
              id: "category-expense-shopping",
              kind: "EXPENSE",
              name: "Shopping",
              systemKey: null,
              updatedAt: NOW,
              version: 1,
            },
          ],
        },
        meta: {},
      }),
      contentType: "application/json",
    }),
  );
  await page.route("**/api/v1/transactions/transaction-manual-delete", async (route) => {
    if (route.request().method() === "DELETE") {
      deleted = true;
      deleteBody = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({
          data: {
            transaction: {
              accountLabel: manualDetail.accountLabel,
              amountMinor: manualDetail.amountMinor,
              categorizationSource: "MANUAL",
              categoryId: manualDetail.categoryId,
              createdAt: NOW,
              currency: manualDetail.currency,
              description: manualDetail.description,
              direction: manualDetail.direction,
              id: manualDetail.id,
              merchantName: manualDetail.description,
              normalizedMerchant: "manual lunch",
              postedDate: manualDetail.postedDate,
              source: "MANUAL",
              status: "REMOVED",
              updatedAt: NOW,
              version: 2,
            },
          },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        data: {
          transaction: deleted ? { ...manualDetail, status: "REMOVED", version: 2 } : manualDetail,
        },
        meta: {},
      }),
      contentType: "application/json",
    });
  });

  await page.goto("/transactions/transaction-manual-delete");
  await page.getByRole("button", { name: "删除这笔手工交易" }).click();
  await expect(page.getByText("确认删除这笔手工交易？")).toBeVisible();
  expect(deleted).toBe(false);
  await page.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "删除这笔手工交易" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("手工交易已标记为移除，并从正常报表中排除。")).toBeVisible();
  expect(deleteBody).toEqual({ version: 1 });
});
