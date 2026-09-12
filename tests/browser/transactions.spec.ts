import { expect, test } from "@playwright/test";

function transaction(id: string, input: Record<string, unknown> = {}) {
  return {
    accountLabel: "Daily Chequing",
    amountMinor: 14327,
    authorizedDate: null,
    categorizationSource: "RULE",
    categoryId: "category-shopping",
    categoryRuleId: null,
    createdAt: "2026-07-17T12:00:00.000Z",
    currency: "CAD",
    description: '<img src=x onerror="alert(1)">',
    direction: "OUTFLOW",
    id,
    merchantName: "Untrusted <script>merchant</script>",
    needsReview: true,
    normalizedMerchant: "untrusted merchant",
    paymentMetadata: { payee: null, payer: null, paymentMethod: null, referenceNumber: null },
    postedDate: "2026-07-17",
    reviewReason: "UNCLASSIFIED_MERCHANT",
    source: "CSV",
    status: "POSTED",
    updatedAt: "2026-07-17T12:00:00.000Z",
    version: 1,
    ...input,
  };
}

test("renders URL-filtered transactions as a mobile list and desktop table without executing text", async ({
  page,
}, testInfo) => {
  const browserProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));
  const requestedQueries: string[] = [];
  await page.route("**/api/v1/transactions?**", async (route) => {
    const url = new URL(route.request().url());
    requestedQueries.push(url.search);
    await route.fulfill({
      body: JSON.stringify({
        data: {
          transactions: [
            transaction("transaction-1"),
            transaction("transaction-2", {
              amountMinor: 200_00,
              categorizationSource: "RULE",
              merchantName: "Corner Market",
              needsReview: false,
            }),
          ],
        },
        meta: {
          hasMore: true,
          nextCursor: "next-page-cursor",
          query: {
            needsReview: true,
            pageSize: 25,
            sort: "POSTED_DATE_DESC",
            source: "CSV",
            status: "POSTED",
          },
        },
      }),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  });

  await page.goto("/transactions?status=POSTED&source=CSV&needsReview=true");
  await expect(page.getByRole("heading", { level: 1, name: "交易" })).toBeVisible();
  const visibleLayout = page.locator(
    testInfo.project.name === "chromium-mobile"
      ? '[data-transactions-layout="list"]'
      : '[data-transactions-layout="table"]',
  );
  await expect(
    visibleLayout.getByText("Untrusted <script>merchant</script>", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("script").filter({ hasText: "merchant" })).toHaveCount(0);
  await expect(page.locator("img")).toHaveCount(0);
  await expect(visibleLayout.getByText("CSV", { exact: true }).first()).toBeVisible();
  await expect(visibleLayout.getByText("已入账", { exact: true }).first()).toBeVisible();
  await expect(visibleLayout.getByText("规则分类", { exact: true }).first()).toBeVisible();

  if (testInfo.project.name === "chromium-mobile") {
    await expect(page.locator('[data-transactions-layout="list"]')).toBeVisible();
    await expect(page.locator('[data-transactions-layout="table"]')).toBeHidden();
  } else {
    await expect(page.locator('[data-transactions-layout="table"]')).toBeVisible();
    await expect(page.locator('[data-transactions-layout="list"]')).toBeHidden();
  }
  expect(requestedQueries[0]).toContain("pageSize=25");
  expect(requestedQueries[0]).toContain("sort=POSTED_DATE_DESC");

  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/cursor=next-page-cursor/);

  await page.getByLabel("状态").selectOption("PENDING");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/status=PENDING/);
  await expect(page).not.toHaveURL(/cursor=/);
  expect(browserProblems).toEqual([]);
});

test("shows installment position separately in transaction list and detail", async ({
  page,
}, testInfo) => {
  const installment = transaction("transaction-installment-1", {
    accountLabel: "RBC Credit",
    categorizationSource: "MANUAL",
    categoryId: "category-shopping",
    description: "Laptop",
    installment: { count: 3, groupId: "installment-group-1", number: 1 },
    merchantName: "Laptop",
    needsReview: false,
    source: "MANUAL",
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/session")) {
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
    } else if (url.pathname.endsWith("/categories")) {
      await route.fulfill({ json: { data: { categories: [] }, meta: {} } });
    } else if (url.pathname.endsWith("/transaction-installment-1")) {
      await route.fulfill({
        json: {
          data: {
            transaction: {
              ...installment,
              categoryAudits: [],
              lifecycle: { pendingTransactionId: null, replacedByTransactionId: null },
            },
          },
          meta: {},
        },
      });
    } else {
      await route.fulfill({
        json: {
          data: { transactions: [installment] },
          meta: {
            hasMore: false,
            nextCursor: null,
            query: { pageSize: 25, sort: "POSTED_DATE_DESC" },
          },
        },
      });
    }
  });

  await page.goto("/transactions");
  const visibleLayout = page.locator(
    testInfo.project.name === "chromium-mobile"
      ? '[data-transactions-layout="list"]'
      : '[data-transactions-layout="table"]',
  );
  await expect(visibleLayout.getByText("第 1/3 期", { exact: true })).toBeVisible();
  await visibleLayout.getByRole("link", { name: "Laptop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "交易详情" })).toBeVisible();
  await expect(page.getByText("第 1/3 期", { exact: true })).toBeVisible();
  await expect(page.getByText("Laptop", { exact: true }).first()).toBeVisible();
});
