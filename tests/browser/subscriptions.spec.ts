import { expect, test, type Page } from "@playwright/test";
import type { SubscriptionRecord } from "../../packages/domain/src/subscriptions";

const category = {
  active: true,
  createdAt: "2026-07-17T12:00:00.000Z",
  editable: true,
  id: "category-expense-food",
  kind: "EXPENSE",
  name: "娱乐订阅",
  systemKey: null,
  updatedAt: "2026-07-17T12:00:00.000Z",
  version: 1,
};
const plan: SubscriptionRecord = {
  id: "subscription-fixture",
  name: "Apple Music",
  accountLabel: "RBC Credit",
  amountMinor: 1299,
  currency: "CAD",
  categoryId: category.id,
  nextChargeDate: "2026-10-10",
  cadence: "MONTHLY",
  anchorDay: 10,
  status: "ACTIVE",
  cancellationEffectiveDate: null,
  lastErrorCode: null,
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-09-10T12:00:00.000Z",
  version: 1,
};

async function mock(page: Page, initial: SubscriptionRecord[] = []) {
  let plans = structuredClone(initial);
  const writes: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      expect(request.headers()["x-csrf-token"]).toBe("csrf.payload");
      const input = request.postDataJSON() as {
        action?: "CANCEL" | "RESUME";
        amountMinor?: number;
        effectiveDate?: string;
        name?: string;
        nextChargeDate?: string;
      };
      writes.push(input);
      if (request.method() === "POST") plans = [{ ...plan, name: input.name ?? plan.name }];
      else if (input.action === "CANCEL")
        plans = [
          {
            ...plans[0]!,
            status: "CANCELLED",
            cancellationEffectiveDate: input.effectiveDate ?? null,
            version: plans[0]!.version + 1,
          },
        ];
      else if (input.action === "RESUME")
        plans = [
          {
            ...plans[0]!,
            status: "ACTIVE",
            cancellationEffectiveDate: null,
            nextChargeDate: input.nextChargeDate ?? plans[0]!.nextChargeDate,
            version: plans[0]!.version + 1,
          },
        ];
      else
        plans = [
          {
            ...plans[0]!,
            amountMinor: input.amountMinor ?? plans[0]!.amountMinor,
            version: plans[0]!.version + 1,
          },
        ];
      await route.fulfill({
        json: {
          data: { subscription: plans[0], removedCount: input.action === "CANCEL" ? 3 : 0 },
          meta: { catchUpPending: false },
        },
        status: request.method() === "POST" ? 201 : 200,
      });
      return;
    }
    const json = path.endsWith("/subscriptions")
      ? {
          data: {
            subscriptions: plans,
            charges: plans.map((item) => ({
              id: "occurrence-fixture",
              subscriptionId: item.id,
              scheduledDate: "2026-09-10",
              transactionId: "transaction-fixture",
              amountMinor: 1299,
              currency: "CAD",
              status: item.status === "CANCELLED" ? "NOT_CHARGED" : "GENERATED",
            })),
          },
          meta: { today: "2026-09-15" },
        }
      : path.endsWith("/categories")
        ? { data: { categories: [category] }, meta: {} }
        : path.endsWith("/session")
          ? {
              data: {
                csrfToken: "csrf.payload",
                identity: { email: "owner@example.invalid" },
                timezone: "America/Toronto",
              },
              meta: {},
            }
          : {
              data: { rules: [] },
              meta: { hasMore: false, nextCursor: null, query: { pageSize: 100 } },
            };
    await route.fulfill({ json });
  });
  return writes;
}

test("settings leads to a page for adding, editing, retroactively cancelling and resuming", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  const writes = await mock(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: "管理订阅" }).click();
  await expect(page.getByRole("heading", { name: "订阅管理", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "还没有订阅" })).toBeVisible();
  await page.getByRole("button", { name: "添加订阅", exact: true }).click();
  await expect(page.getByLabel("订阅名称")).toBeFocused();
  await page.getByLabel("订阅名称").fill("Apple Music");
  await page.getByLabel("每次金额").fill("12.99");
  await page.getByLabel("支出类别").selectOption(category.id);
  await page.getByLabel("首次扣款日", { exact: true }).fill("2026-06-10");
  await page.getByRole("button", { name: "保存订阅" }).click();
  await expect(page.getByRole("status")).toContainText("订阅已保存");
  expect(writes[0]).toMatchObject({
    amountMinor: 1299,
    nextChargeDate: "2026-06-10",
    accountLabel: "RBC Credit",
    currency: "CAD",
    requestId: expect.any(String),
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("每次金额").fill("15.99");
  await page.getByRole("button", { name: "保存订阅" }).click();
  await expect(page.getByText("CAD 15.99", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "取消订阅", exact: true }).click();
  await expect(page.getByText("从所选日期（含当天）", { exact: false })).toBeVisible();
  await page.getByLabel("从哪天开始取消").fill("2026-07-01");
  await page.getByRole("button", { name: "确认取消并删除对应支出" }).click();
  await expect(page.getByRole("status")).toContainText("已删除 3 笔自动支出");
  expect(writes[2]).toEqual({ action: "CANCEL", version: 2, effectiveDate: "2026-07-01" });
  await page.getByText("最近记账记录", { exact: false }).click();
  await expect(page.getByText("已删除", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "恢复订阅", exact: true }).click();
  await page.getByLabel("新的首次扣款日").fill("2026-10-10");
  await page.getByRole("button", { name: "确认恢复" }).click();
  await expect(page.getByRole("status")).toContainText("从新的开始日期记账");
  expect(writes[3]).toEqual({ action: "RESUME", version: 3, nextChargeDate: "2026-10-10" });
  expect(errors).toEqual([]);
});

test("supports keyboard navigation, long names and responsive cancellation forms", async ({
  page,
}, testInfo) => {
  await mock(page, [{ ...plan, name: "Apple Music 家庭共享与云端存储订阅" }]);
  await page.goto("/subscriptions");
  await expect(page.getByRole("article")).toBeVisible();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "取消订阅", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`subscriptions-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "取消订阅", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("从哪天开始取消")).toBeFocused();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("cancel-form.png"), fullPage: true });
});

test("reports failed reads and saves without claiming success", async ({ page }) => {
  await mock(page, [plan]);
  await page.route("**/api/v1/subscriptions", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR" } } }),
  );
  await page.goto("/subscriptions");
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
  await page.unroute("**/api/v1/subscriptions");
  await page.getByRole("button", { name: "重新加载" }).click();
  await page.route("**/api/v1/subscriptions/*", (route) =>
    route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } }),
  );
  await page.getByRole("button", { name: "取消订阅", exact: true }).click();
  await page.getByRole("button", { name: "确认取消并删除对应支出" }).click();
  await expect(page.getByRole("alert")).toContainText("订阅已被更新");
  await expect(page.getByRole("heading", { name: "取消订阅 · Apple Music" })).toBeVisible();
});
