import { expect, test, type Page } from "@playwright/test";

function metric(currentMinor: number, referenceMinor: number) {
  return {
    absoluteChangeMinor: currentMinor - referenceMinor,
    currentMinor,
    percentageChangeBasisPoints: referenceMinor === 0 ? null : 10_000,
    referenceMinor,
  };
}

function previousMonth(period: string) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodMeta(period: string) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    dateFrom: `${period}-01`,
    dateTo: `${period}-${lastDay}`,
    grain: "MONTH",
    label: period,
  };
}

function cashFlowResponse(period: string) {
  const month = Number(period.slice(5));
  const priorPeriod = previousMonth(period);
  const current = {
    incomeMinor: month * 100_000,
    netCashFlowMinor: month * 90_000,
    netSpendingMinor: month * 10_000,
  };
  const prior = {
    incomeMinor: (month - 1) * 100_000,
    netCashFlowMinor: (month - 1) * 90_000,
    netSpendingMinor: (month - 1) * 10_000,
  };
  return {
    data: {
      sections: [
        {
          currency: "CAD",
          current,
          previousPeriod: {
            income: metric(current.incomeMinor, prior.incomeMinor),
            netCashFlow: metric(current.netCashFlowMinor, prior.netCashFlowMinor),
            netSpending: metric(current.netSpendingMinor, prior.netSpendingMinor),
          },
          previousYear: {
            income: metric(current.incomeMinor, 0),
            netCashFlow: metric(current.netCashFlowMinor, 0),
            netSpending: metric(current.netSpendingMinor, 0),
          },
        },
      ],
    },
    meta: {
      freshness: { generatedAt: "2026-07-17T12:00:00.000Z" },
      periods: {
        current: periodMeta(period),
        previousPeriod: periodMeta(priorPeriod),
        previousYear: periodMeta(`${Number(period.slice(0, 4)) - 1}-${period.slice(5)}`),
      },
      query: { grain: "MONTH", period },
    },
  };
}

function spendingResponse(period: string, mode: "normal" | "refund" | "empty" = "normal") {
  const section = (currency: string, rows: Array<[string, string, number]>) => ({
    currency,
    categoryDistribution: rows.map(([id, name, amount]) => ({
      categoryId: id,
      categoryName: name,
      netSpendingMinor: amount,
      transactionCount: 1,
      drillDown: {
        categoryId: id,
        currency,
        dateFrom: periodMeta(period).dateFrom,
        dateTo: periodMeta(period).dateTo,
        reportMetric: "NET_SPENDING",
      },
    })),
    merchantRanking: [],
    merchantGroupCount: 0,
    netSpendingMinor: rows.reduce((sum, row) => sum + row[2], 0),
  });
  return {
    data: {
      sections:
        mode === "empty"
          ? []
          : mode === "refund"
            ? [
                section("CAD", [
                  ["category-expense-food", "Food & Dining", -1200],
                  ["category-expense-bills", "Bills & Utilities", 0],
                ]),
              ]
            : [
                section("CAD", [
                  ["category-expense-food", "Food & Dining", 42000],
                  ["category-expense-shopping", "Shopping", 30000],
                  ["category-expense-bills", "Bills & Utilities", -2000],
                ]),
                section("USD", [["category-expense-shopping", "Shopping", 9900]]),
              ],
    },
    meta: {
      period: periodMeta(period),
      query: { grain: "MONTH", period, merchantLimit: 20 },
      freshness: { generatedAt: "2026-07-17T12:00:00.000Z" },
    },
  };
}

async function mockOverviewApi(page: Page, mode: "normal" | "refund" | "empty" = "normal") {
  const requests: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const body = url.pathname.endsWith("/spending")
      ? spendingResponse(url.searchParams.get("period")!, mode)
      : cashFlowResponse(url.searchParams.get("period")!);
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  });
  return requests;
}

test("shows monthly category pies and amounts instead of monthly comparisons", async ({ page }) => {
  const browserProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));
  await page.clock.setFixedTime(new Date("2026-07-17T12:00:00.000Z"));
  const requests = await mockOverviewApi(page);
  await page.goto("/");

  await expect(page.getByRole("link", { name: "查看未分类流水" })).toHaveAttribute(
    "href",
    "/transactions?categorizationSource=UNCLASSIFIED",
  );
  await expect(page.getByRole("link", { name: "修复连接" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "本月现金流" })).toBeVisible();
  await expect(page.getByLabel("收入 7000.00 CAD")).toBeVisible();
  await expect(page.getByLabel("净支出 700.00 CAD")).toBeVisible();
  await expect(page.getByLabel("净现金流 6300.00 CAD")).toBeVisible();

  await expect(page.getByRole("heading", { name: "近六个月趋势" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "钱花在哪里" })).toBeVisible();
  await expect(page.getByRole("img", { name: /CAD 分类支出饼图/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /USD 分类支出饼图/ })).toBeVisible();
  const cad = page.getByRole("table", { name: "CAD 分类支出明细" });
  await expect(cad.getByRole("row", { name: /Food & Dining/ })).toContainText("58.3%");
  await expect(cad.getByRole("row", { name: /Shopping/ })).toContainText("41.7%");
  await expect(cad.getByRole("row", { name: /Bills & Utilities/ })).toContainText("净退款");
  await expect(page.getByRole("table", { name: "USD 分类支出明细" })).toContainText("100.0%");
  await expect(page.locator(".overview-pie path")).toHaveCount(2);
  await expect(page.locator(".overview-pie circle")).toHaveCount(1);
  expect([...new Set(requests)].sort()).toEqual([
    "/api/v1/reports/cash-flow?grain=MONTH&period=2026-07",
    "/api/v1/reports/spending?grain=MONTH&period=2026-07",
  ]);
  const href = await cad.getByRole("link", { name: "Food & Dining" }).getAttribute("href");
  expect(href).toContain("categoryId=category-expense-food");
  expect(href).toContain("dateFrom=2026-07-01");
  expect(href).toContain("reportMetric=NET_SPENDING");
  await page.screenshot({ path: test.info().outputPath("overview-pie.png"), fullPage: true });

  const sectionTops = await page.locator("[data-overview-section]").evaluateAll((sections) =>
    sections.map((section) => ({
      name: section.getAttribute("data-overview-section"),
      top: section.getBoundingClientRect().top,
    })),
  );
  expect(sectionTops.map(({ name }) => name)).toEqual(["metrics", "spending"]);
  expect(
    sectionTops
      .map(({ top }) => top)
      .every((top, index, values) => index === 0 || top > values[index - 1]!),
  ).toBe(true);
  expect(browserProblems).toEqual([]);
});

test("shows refunds and zero amounts without inventing pie slices", async ({ page }) => {
  await mockOverviewApi(page, "refund");
  await page.goto("/");
  await expect(page.getByText("暂无正净支出可绘制饼图")).toBeVisible();
  await expect(page.getByRole("img", { name: /分类支出饼图/ })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "CAD 分类支出明细" })).toContainText("净退款");
});

test("shows a clear empty state for a month without spending", async ({ page }) => {
  await mockOverviewApi(page, "empty");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月还没有分类支出" })).toBeVisible();
  await expect(page.getByRole("img", { name: /分类支出饼图/ })).toHaveCount(0);
});

test("keeps the pie and category amounts readable at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await mockOverviewApi(page);
  await page.goto("/");
  await expect(page.getByRole("table", { name: "CAD 分类支出明细" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const link = page
    .getByRole("table", { name: "CAD 分类支出明细" })
    .getByRole("link", { name: "Food & Dining" });
  await link.focus();
  await expect(link).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("overview-pie-320.png"), fullPage: true });
});
