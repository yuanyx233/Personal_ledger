import { expect, test, type Page } from "@playwright/test";

function metric(currentMinor: number, referenceMinor: number) {
  return {
    absoluteChangeMinor: currentMinor - referenceMinor,
    currentMinor,
    percentageChangeBasisPoints:
      referenceMinor === 0
        ? null
        : Math.round(((currentMinor - referenceMinor) / Math.abs(referenceMinor)) * 10_000),
    referenceMinor,
  };
}

function monthMeta(period: string) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return {
    dateFrom: `${period}-01`,
    dateTo: `${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`,
    grain: "MONTH",
    label: period,
    timeZone: "America/Toronto",
  };
}

function shiftMonth(period: string, offset: number) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftQuarter(period: string, offset: number) {
  const [yearText, quarterText] = period.split("-Q") as [string, string];
  const index = Number(yearText) * 4 + Number(quarterText) - 1 + offset;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

function periodMeta(grain: string, period: string) {
  if (grain === "MONTH") return monthMeta(period);
  if (grain === "YEAR") {
    return {
      dateFrom: `${period}-01-01`,
      dateTo: `${period}-12-31`,
      grain,
      label: period,
      timeZone: "America/Toronto",
    };
  }
  const [year, quarterText] = period.split("-Q") as [string, string];
  const quarter = Number(quarterText);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    dateFrom: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(endMonth).padStart(2, "0")}-${new Date(
      Date.UTC(Number(year), endMonth, 0),
    ).getUTCDate()}`,
    grain,
    label: period,
    timeZone: "America/Toronto",
  };
}

const freshness = {
  connections: [
    {
      connectionId: "connection-rbc",
      institutionName: "RBC",
      lastSuccessAt: "2026-07-17T10:30:00.000Z",
      nextActionCode: "REAUTHENTICATE",
      stale: true,
      status: "ACTION_REQUIRED",
    },
  ],
  generatedAt: "2026-07-17T12:00:00.000Z",
  isStale: true,
  staleAfterMinutes: 60,
} as const;

function cashFlowSection(currency: "CAD" | "USD", seed: number) {
  const current = {
    incomeMinor: seed * 1_000,
    netCashFlowMinor: seed * 600,
    netSpendingMinor: seed * 400,
  };
  return {
    currency,
    current,
    previousPeriod: {
      income: metric(current.incomeMinor, seed === 2026 ? 0 : current.incomeMinor - 1_000),
      netCashFlow: metric(current.netCashFlowMinor, current.netCashFlowMinor - 600),
      netSpending: metric(current.netSpendingMinor, current.netSpendingMinor - 400),
    },
    previousYear: {
      income: metric(current.incomeMinor, current.incomeMinor - 12_000),
      netCashFlow: metric(current.netCashFlowMinor, current.netCashFlowMinor - 7_200),
      netSpending: metric(current.netSpendingMinor, current.netSpendingMinor - 4_800),
    },
  };
}

function cashFlowResponse(url: URL) {
  const grain = url.searchParams.get("grain")!;
  const period = url.searchParams.get("period");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const seed =
    grain === "CUSTOM"
      ? 1_000
      : grain === "MONTH"
        ? Number(period!.replace("-", ""))
        : Number(period!.slice(0, 4));
  const current =
    grain === "CUSTOM"
      ? {
          dateFrom,
          dateTo,
          grain,
          label: `${dateFrom}/${dateTo}`,
          timeZone: "America/Toronto",
        }
      : periodMeta(grain, period!);
  const previousPeriod =
    grain === "MONTH"
      ? monthMeta(shiftMonth(period!, -1))
      : grain === "QUARTER"
        ? periodMeta("QUARTER", shiftQuarter(period!, -1))
        : grain === "CUSTOM"
          ? {
              dateFrom: "2025-12-01",
              dateTo: "2025-12-31",
              grain,
              label: "2025-12-01/2025-12-31",
              timeZone: "America/Toronto",
            }
          : periodMeta("YEAR", String(Number(period) - 1));
  const previousYear =
    grain === "MONTH"
      ? monthMeta(`${Number(period!.slice(0, 4)) - 1}-${period!.slice(5)}`)
      : grain === "QUARTER"
        ? periodMeta("QUARTER", `${Number(period!.slice(0, 4)) - 1}${period!.slice(4)}`)
        : grain === "CUSTOM"
          ? {
              dateFrom: "2025-01-01",
              dateTo: "2025-01-31",
              grain,
              label: "2025-01-01/2025-01-31",
              timeZone: "America/Toronto",
            }
          : periodMeta("YEAR", String(Number(period) - 1));
  return {
    data: {
      sections: [cashFlowSection("CAD", seed), cashFlowSection("USD", Math.max(1, seed - 1))],
    },
    meta: {
      freshness,
      periods: { current, previousPeriod, previousYear },
      query:
        grain === "CUSTOM"
          ? { accountId: "account-1", dateFrom, dateTo, grain }
          : { accountId: "account-1", grain, period },
    },
  };
}

function spendingResponse(url: URL) {
  const grain = url.searchParams.get("grain")!;
  const period = url.searchParams.get("period");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const meta =
    grain === "CUSTOM"
      ? {
          dateFrom,
          dateTo,
          grain,
          label: `${dateFrom}/${dateTo}`,
          timeZone: "America/Toronto",
        }
      : periodMeta(grain, period!);
  const baseDrillDown = {
    accountId: "account-1",
    currency: "CAD",
    dateFrom: meta.dateFrom,
    dateTo: meta.dateTo,
    reportMetric: "NET_SPENDING",
  };
  return {
    data: {
      sections: [
        {
          categoryDistribution: [
            {
              categoryId: "category-groceries",
              categoryName: "日用杂货",
              drillDown: { ...baseDrillDown, categoryId: "category-groceries" },
              netSpendingMinor: 84_000,
              transactionCount: 18,
            },
          ],
          currency: "CAD",
          merchantGroupCount: 2,
          merchantRanking: [
            {
              drillDown: { ...baseDrillDown, normalizedMerchant: "corner market" },
              merchantName: "Corner <script>market</script>",
              netSpendingMinor: 52_000,
              normalizedMerchant: "corner market",
              transactionCount: 9,
            },
            {
              drillDown: { ...baseDrillDown, merchantMissing: true },
              merchantName: null,
              netSpendingMinor: 32_000,
              normalizedMerchant: null,
              transactionCount: 9,
            },
          ],
          netSpendingMinor: 84_000,
        },
      ],
    },
    meta: {
      freshness,
      period: meta,
      query:
        grain === "CUSTOM"
          ? { accountId: "account-1", dateFrom, dateTo, grain, merchantLimit: 20 }
          : { accountId: "account-1", grain, merchantLimit: 20, period },
    },
  };
}

async function mockAnalysisApi(page: Page, empty = false) {
  let budgets: Array<{
    categoryId: string;
    currency: string;
    effectiveMonth: string;
    amountMinor: number | null;
    updatedAt: string;
  }> = [];

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith("/budgets")) {
      if (route.request().method() === "PUT") {
        const setting = route.request().postDataJSON() as (typeof budgets)[number];
        budgets = budgets.filter(
          (budget) =>
            !(
              budget.categoryId === setting.categoryId &&
              budget.currency === setting.currency &&
              budget.effectiveMonth === setting.effectiveMonth
            ),
        );
        budgets.push({ ...setting, updatedAt: "2026-09-05T12:00:00.000Z" });
        body = { data: { budget: budgets.at(-1) }, meta: {} };
      } else {
        const month = url.searchParams.get("month")!;
        const latest = new Map<string, (typeof budgets)[number]>();
        for (const budget of [...budgets].sort((a, b) =>
          a.effectiveMonth.localeCompare(b.effectiveMonth),
        )) {
          if (budget.effectiveMonth <= month)
            latest.set(`${budget.categoryId}-${budget.currency}`, budget);
        }
        body = { data: { budgets: [...latest.values()] }, meta: { month } };
      }
    } else if (url.pathname.endsWith("/categories")) {
      body = {
        data: {
          categories: [
            {
              id: "category-groceries",
              createdAt: "2026-09-05T12:00:00.000Z",
              updatedAt: "2026-09-05T12:00:00.000Z",
              name: "日用杂货",
              kind: "EXPENSE",
              active: true,
              editable: true,
              systemKey: null,
              version: 1,
            },
          ],
        },
        meta: {},
      };
    } else if (url.pathname.endsWith("/session")) {
      body = {
        data: {
          csrfToken: "budget.token",
          identity: { email: "owner@example.invalid" },
          timezone: "America/Toronto",
        },
        meta: {},
      };
    } else if (url.pathname.endsWith("/accounts")) {
      body = { data: { accounts: [{ id: "account-1", displayName: "Daily Chequing" }] }, meta: {} };
    } else if (url.pathname.endsWith("/reports/spending")) {
      const report = spendingResponse(url);
      if (empty) report.data.sections = [];
      body = report;
    } else if (url.pathname.endsWith("/transactions")) {
      body = {
        data: { transactions: [] },
        meta: {
          hasMore: false,
          nextCursor: null,
          query: {
            accountId: url.searchParams.get("accountId"),
            ...(url.searchParams.has("categoryId")
              ? { categoryId: url.searchParams.get("categoryId") }
              : {}),
            ...(url.searchParams.has("merchantFamily")
              ? { merchantFamily: url.searchParams.get("merchantFamily") }
              : {}),
            currency: url.searchParams.get("currency"),
            dateFrom: url.searchParams.get("dateFrom"),
            dateTo: url.searchParams.get("dateTo"),
            pageSize: 25,
            reportMetric: "NET_SPENDING",
            sort: "POSTED_DATE_DESC",
          },
        },
      };
    } else {
      const report = cashFlowResponse(url);
      if (empty) report.data.sections = [];
      body = report;
    }
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  });
}

test("sets monthly category limits, keeps them after reload, and shows over-budget and currency states", async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
  });
  await mockAnalysisApi(page);
  await page.goto("/analysis?grain=MONTH&period=2026-09");
  const goals = page.getByRole("region", { name: "Goal · 月度预算上限" });
  await expect(goals.getByText("未设置预算")).toBeVisible();
  await goals.getByRole("button", { name: "设置日用杂货预算" }).click();
  await expect(goals.getByLabel("日用杂货预算上限（CAD）")).toBeFocused();
  await goals.getByLabel("日用杂货预算上限（CAD）").fill("1000");
  await goals.getByRole("button", { name: "保存预算", exact: true }).click();
  await expect(goals.getByText("剩余 $160.00")).toBeVisible();
  await page.reload();
  await expect(goals.getByText("上限 $1,000.00")).toBeVisible();
  await page.getByRole("link", { name: "下一月" }).click();
  await expect(goals.getByText("上限 $1,000.00")).toBeVisible();
  await goals.getByRole("button", { name: "修改日用杂货预算" }).click();
  await goals.getByLabel("日用杂货预算上限（CAD）").fill("500");
  await goals.getByRole("button", { name: "保存预算", exact: true }).click();
  await expect(goals.getByText("超支 $340.00")).toBeVisible();
  await expect(goals.getByRole("progressbar")).toHaveAttribute("value", "100");
  await expect(page.getByRole("table", { name: "CAD 类别分布" }).getByText("100.0%")).toBeVisible();
  await goals.screenshot({ path: testInfo.outputPath("monthly-budgets.png") });
  await page.getByRole("link", { name: "上一月" }).click();
  await expect(goals.getByText("上限 $1,000.00")).toBeVisible();
  await goals.getByLabel("预算币种").selectOption("USD");
  await expect(goals.getByText("未设置预算")).toBeVisible();
  await goals.getByRole("button", { name: "设置日用杂货预算" }).click();
  await goals.getByLabel("日用杂货预算上限（USD）").fill("0");
  await goals.getByRole("button", { name: "保存预算", exact: true }).click();
  await expect(goals.getByText("零预算")).toBeVisible();
  await goals.getByRole("button", { name: "修改日用杂货预算" }).click();
  await goals.getByRole("button", { name: "取消该预算" }).click();
  await expect(goals.getByText("未设置预算")).toBeVisible();
  await page.getByLabel("月份", { exact: true }).fill("2026-12");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/period=2026-12/);
  expect(problems).toEqual([]);
});

test("allows planning an empty month and retains edits when saving fails", async ({ page }) => {
  await mockAnalysisApi(page, true);
  await page.goto("/analysis?grain=MONTH&period=2026-09");
  const goals = page.getByRole("region", { name: "Goal · 月度预算上限" });
  await expect(page.getByText("所选周期没有可计入报表的交易")).toBeVisible();
  await goals.getByRole("button", { name: "设置日用杂货预算" }).click();
  await goals.getByLabel("日用杂货预算上限（CAD）").fill("20.001");
  await goals.getByRole("button", { name: "保存预算", exact: true }).click();
  await expect(goals.getByRole("alert")).toContainText("最多两位小数");
  await goals.getByLabel("日用杂货预算上限（CAD）").fill("250");
  await page.route("**/api/v1/budgets", (route) => route.fulfill({ status: 500, body: "{}" }), {
    times: 1,
  });
  await goals.getByRole("button", { name: "保存预算", exact: true }).click();
  await expect(goals.getByRole("alert")).toContainText("未能确认预算保存结果");
  await expect(goals.getByLabel("日用杂货预算上限（CAD）")).toHaveValue("250");
  await goals.getByRole("button", { name: "保存预算", exact: true }).click();
  await expect(goals.getByText("剩余 $250.00")).toBeVisible();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("supports period analysis, separate currencies, accessible tables, and drill-down", async ({
  page,
}) => {
  const browserProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));
  await page.clock.setFixedTime(new Date("2026-07-17T12:00:00.000Z"));
  await mockAnalysisApi(page);
  await page.goto("/analysis?grain=YEAR&period=2026&accountId=account-1");

  await expect(page.getByRole("heading", { level: 1, name: "分析" })).toBeVisible();
  await expect(page.getByRole("link", { name: "年", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByLabel("账户")).toHaveValue("account-1");
  await expect(page.getByRole("heading", { name: "CAD 指标" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "USD 指标" })).toBeVisible();
  await expect(page.getByText("N/A", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据不是最新的" })).toHaveCount(0);

  await expect(page.locator('[data-analysis-trend="CAD"] tbody tr')).toHaveCount(12);
  await expect(page.locator('[data-analysis-trend="USD"] tbody tr')).toHaveCount(12);
  await expect(page.getByRole("table", { name: "CAD 现金流趋势" })).toBeVisible();
  await expect(page.getByRole("table", { name: "CAD 类别分布" })).toBeVisible();
  await expect(page.getByRole("table", { name: "CAD 商户排行" })).toBeVisible();
  await expect(page.getByText("Corner <script>market</script>", { exact: true })).toBeVisible();
  await expect(page.locator("script").filter({ hasText: "market" })).toHaveCount(0);

  const categoryLink = page.getByRole("link", { name: /查看日用杂货交易/ });
  await expect(categoryLink).toHaveAttribute(
    "href",
    /\/transactions\?.*categoryId=category-groceries.*reportMetric=NET_SPENDING/,
  );
  await categoryLink.click();
  await expect(page).toHaveURL(/\/transactions\?.*categoryId=category-groceries/);

  await page.goBack();
  await page.getByRole("link", { name: "下一年" }).click();
  await expect(page).toHaveURL(/grain=YEAR&period=2027&accountId=account-1/);
  expect(browserProblems).toEqual([]);
});

test("shows imported merchant descriptions when the separate merchant name is missing", async ({
  page,
}) => {
  await mockAnalysisApi(page);
  await page.route("**/api/v1/reports/spending?**", async (route) => {
    const report = spendingResponse(new URL(route.request().url()));
    const merchant = report.data.sections[0]!.merchantRanking[0]!;
    merchant.merchantName = null;
    merchant.normalizedMerchant = "aesop toronto eaton ct toronto";
    merchant.drillDown = { ...merchant.drillDown, normalizedMerchant: merchant.normalizedMerchant };
    await route.fulfill({ json: report });
  });
  await page.goto("/analysis?grain=MONTH&period=2026-09");
  const ranking = page.getByRole("table", { name: "CAD 商户排行" });
  const merchant = ranking.getByRole("link", { name: "aesop toronto eaton ct toronto" });
  await expect(merchant).toBeVisible();
  await expect(merchant).toHaveAttribute(
    "href",
    /normalizedMerchant=aesop\+toronto\+eaton\+ct\+toronto/,
  );
  await expect(ranking.getByRole("link", { name: "未提供商户" })).toHaveCount(1);
  await merchant.click();
  await expect(page).toHaveURL(/normalizedMerchant=aesop\+toronto\+eaton\+ct\+toronto/);
});

test("shows separate merchant services and preserves the family when opening transactions", async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  await mockAnalysisApi(page);
  await page.route("**/api/v1/reports/spending?**", async (route) => {
    const report = spendingResponse(new URL(route.request().url()));
    const section = report.data.sections[0]!;
    const base = section.merchantRanking[0]!;
    const { accountId, currency, dateFrom, dateTo, reportMetric } = base.drillDown;
    await route.fulfill({
      json: {
        ...report,
        data: {
          sections: [
            {
              ...section,
              merchantGroupCount: 2,
              merchantRanking: [
                {
                  ...base,
                  merchantName: "Amazon",
                  merchantFamily: "amazon-shopping",
                  normalizedMerchant: null,
                  drillDown: {
                    accountId,
                    currency,
                    dateFrom,
                    dateTo,
                    reportMetric,
                    merchantFamily: "amazon-shopping",
                  },
                },
                {
                  ...base,
                  merchantName: "Amazon Prime",
                  merchantFamily: "amazon-prime",
                  normalizedMerchant: null,
                  drillDown: {
                    accountId,
                    currency,
                    dateFrom,
                    dateTo,
                    reportMetric,
                    merchantFamily: "amazon-prime",
                  },
                },
              ],
            },
          ],
        },
      },
    });
  });
  await page.goto("/analysis?grain=MONTH&period=2026-09");
  const ranking = page.getByRole("table", { name: "CAD 商户排行" });
  await expect(ranking.getByRole("link", { name: "Amazon", exact: true })).toHaveCount(1);
  await expect(ranking.getByRole("link", { name: "Amazon Prime", exact: true })).toBeVisible();
  await ranking.screenshot({ path: testInfo.outputPath("merchant-families.png") });
  const transactionRequest = page.waitForRequest(
    (request) =>
      request.url().includes("/api/v1/transactions?") &&
      request.url().includes("merchantFamily=amazon-shopping"),
  );
  await ranking.getByRole("link", { name: "Amazon", exact: true }).click();
  await transactionRequest;
  await expect(page).toHaveURL(/merchantFamily=amazon-shopping/);
  await page.getByRole("combobox", { name: "排序", exact: true }).selectOption("AMOUNT_DESC");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page).toHaveURL(/merchantFamily=amazon-shopping/);
  expect(problems).toEqual([]);
});

test("keeps month, quarter, custom range, and account filtering in the URL", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-17T12:00:00.000Z"));
  await mockAnalysisApi(page);
  await page.goto("/analysis?grain=MONTH&period=2026-07&accountId=account-1");

  await page.getByRole("link", { name: "季度", exact: true }).click();
  await expect(page).toHaveURL(/grain=QUARTER&period=2026-Q3&accountId=account-1/);
  await expect(page.locator(".analysis-period-heading strong")).toHaveText("2026-Q3");

  await page.getByRole("link", { name: "自定义", exact: true }).click();
  await expect(page).toHaveURL(/grain=CUSTOM&dateFrom=2026-06-18&dateTo=2026-07-17/);
  await page.getByLabel("开始日期").fill("2026-01-01");
  await page.getByLabel("结束日期").fill("2026-01-31");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(
    /grain=CUSTOM&dateFrom=2026-01-01&dateTo=2026-01-31&accountId=account-1/,
  );
  await expect(page.getByRole("navigation", { name: "周期导航" })).toHaveCount(0);

  await page.getByLabel("账户").selectOption("");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).not.toHaveURL(/accountId=/);
});
