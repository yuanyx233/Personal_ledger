import { expect, test, type Page } from "@playwright/test";

import { mockEmptyOverviewApi } from "./support/empty-overview-api";

const browserProblems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await mockEmptyOverviewApi(page);
});

test.afterEach(({ page }) => {
  expect(browserProblems.get(page)).toEqual([]);
});

test("renders the responsive app shell without horizontal overflow", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Personal Ledger");
  await expect(page.getByRole("heading", { level: 1, name: "概览" })).toBeVisible();
  // The mocked response must actually satisfy the report contract. If it drifts,
  // the page falls back to the error state and these layout checks would be
  // measuring that instead of the interface they are meant to cover.
  await expect(page.getByRole("heading", { name: "暂时无法读取" })).toBeHidden();

  const desktopNavigation = page.locator('[data-navigation="sidebar"]');
  const mobileNavigation = page.locator('[data-navigation="bottom"]');
  if (testInfo.project.name === "chromium-mobile") {
    await expect(desktopNavigation).toBeHidden();
    await expect(mobileNavigation).toBeVisible();
  } else {
    await expect(desktopNavigation).toBeVisible();
    await expect(mobileNavigation).toBeHidden();
  }

  const visibleTargets = page.getByRole("navigation", { name: "主导航" }).getByRole("link");
  await expect(visibleTargets).toHaveCount(testInfo.project.name === "chromium-mobile" ? 5 : 6);
  for (const target of await visibleTargets.all()) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(widths.scroll).toBe(widths.client);
});

test("navigates among the primary routes with URL and current-page semantics", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "主导航" });

  await expect(navigation.getByRole("link", { name: "概览" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await navigation.getByRole("link", { name: "交易" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole("heading", { level: 1, name: "交易" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "交易" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await navigation.getByRole("link", { name: "记一笔" }).click();
  await expect(page).toHaveURL(/\/add$/);
  await expect(page.getByRole("heading", { level: 1, name: "记一笔" })).toBeVisible();

  await navigation.getByRole("link", { name: "分析" }).click();
  await expect(page).toHaveURL(/\/analysis$/);
  await expect(page.getByRole("heading", { level: 1, name: "分析" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "记一笔" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "交易" })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "设置" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("opens subscriptions directly from the desktop sidebar", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Subscriptions stay under settings on mobile.",
  );

  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await navigation.getByRole("link", { name: "订阅", exact: true }).click();

  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(page.getByRole("heading", { level: 1, name: "订阅管理" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "订阅", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("offers a keyboard skip link to the route content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("keeps the navigation usable at every required breakpoint", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "One Chromium project covers the matrix.",
  );

  await page.goto("/");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ height: 900, width });

    const desktopNavigation = page.locator('[data-navigation="sidebar"]');
    const mobileNavigation = page.locator('[data-navigation="bottom"]');
    await expect(width >= 768 ? desktopNavigation : mobileNavigation).toBeVisible();
    await expect(width >= 768 ? mobileNavigation : desktopNavigation).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `horizontal overflow at ${width}px`,
    ).toBe(width);
  }
});

test("shows an offline state without caching API or export responses", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "One isolated browser is sufficient.");

  await page.goto("/transactions");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await page.evaluate(async () => {
    await Promise.allSettled([
      fetch("/api/v1/transactions", { cache: "no-store" }),
      fetch("/api/v1/exports/full.json", { cache: "no-store" }),
    ]);
  });
  const cachedPaths = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cachedPaths.some((path) => path.startsWith("/api/") || path.startsWith("/exports/"))).toBe(
    false,
  );

  await context.setOffline(true);
  await expect(page.getByRole("heading", { level: 2, name: "当前处于离线状态" })).toBeVisible();
  await expect(page.getByText("不会显示缓存的交易记录", { exact: false })).toBeVisible();
  await expect(page.locator(".route-stage")).toHaveCount(0);
  await context.setOffline(false);
});

test("remembers an explicit interface language without touching the ledger", async ({ page }) => {
  // beforeEach already mocks the API; only observe, so no console errors are added.
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v1/")) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/settings");
  const selector = page.getByRole("combobox", { name: "界面语言" });
  await expect(selector).toHaveValue("zh-CN");

  await selector.selectOption("en");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Overview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  expect(writes).toEqual([]);
});
