import { expect, test } from "@playwright/test";

function transaction(id: string, input: Record<string, unknown> = {}) {
  return {
    accountId: "account-1",
    accountLabel: "Daily Chequing",
    amountMinor: 14327,
    authorizedDate: null,
    categorizationSource: "PLAID",
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
    source: "PLAID",
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
            source: "PLAID",
            status: "POSTED",
          },
        },
      }),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  });

  await page.goto("/transactions?status=POSTED&source=PLAID&needsReview=true");
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
  await expect(visibleLayout.getByText("历史银行记录", { exact: true }).first()).toBeVisible();
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
