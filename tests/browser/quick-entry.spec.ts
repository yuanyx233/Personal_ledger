import { expect, test, type Page } from "@playwright/test";

import { torontoCalendarDate } from "../../apps/web/src/features/quick-entry/quick-entry-preferences";

const browserProblems = new WeakMap<Page, string[]>();

function category(id: string, name: string) {
  return {
    active: true,
    createdAt: "2026-08-31T16:00:00.000Z",
    editable: true,
    id,
    kind: "EXPENSE",
    name,
    systemKey: null,
    updatedAt: "2026-08-31T16:00:00.000Z",
    version: 1,
  };
}

test.beforeEach(({ page }) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
});

test.afterEach(({ page }) => {
  expect(browserProblems.get(page)).toEqual([]);
});

for (const direction of ["OUTFLOW", "INFLOW"] as const) {
  test(`records optional reimbursements and resets the choice: ${direction}`, async ({
    page,
  }, testInfo) => {
    let submitted: Record<string, unknown> | null = null;
    await page.route("**/api/v1/**", async (route) => {
      if (new URL(route.request().url()).pathname.endsWith("/session")) {
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
        return;
      }
      if (new URL(route.request().url()).pathname.endsWith("/transaction-previews")) {
        await route.fulfill({
          json: {
            data: {
              category: category("category-expense-food", "Food & Dining"),
              kind: "KNOWN_MERCHANT",
            },
            meta: {},
          },
        });
        return;
      }
      if (
        new URL(route.request().url()).pathname.endsWith("/transactions") &&
        route.request().method() === "POST"
      ) {
        submitted = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          json: {
            data: {
              categoryConfirmationRequired: false,
              transaction: {
                accountLabel: submitted.accountLabel,
                amountMinor: Number(submitted.amount) * 100,
                reimbursementMinor: Number(submitted.reimbursementAmount ?? 0) * 100,
                categorizationSource: "RULE",
                categoryId: "category-expense-food",
                createdAt: "2026-09-04T12:00:00.000Z",
                updatedAt: "2026-09-04T12:00:00.000Z",
                currency: submitted.currency,
                description: submitted.description,
                direction: submitted.direction,
                id: "transaction-reimbursement",
                merchantName: submitted.description,
                normalizedMerchant: "meal",
                postedDate: submitted.postedDate,
                source: "MANUAL",
                status: "POSTED",
                version: 1,
              },
            },
            meta: {},
          },
        });
        return;
      }
      await route.fulfill({ status: 404 });
    });
    await page.goto("/add");
    await page
      .getByRole("textbox", { name: "金额", exact: true })
      .fill(direction === "OUTFLOW" ? "300" : "200");
    await page.getByLabel("商户或描述").fill(direction === "OUTFLOW" ? "Dinner" : "EMT");
    if (direction === "INFLOW") {
      await page.getByText("日期、币种和方向", { exact: true }).click();
      await page.getByLabel("方向").selectOption("INFLOW");
    }
    const checkbox = page.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();
    await checkbox.focus();
    await page.keyboard.press("Space");
    if (direction === "OUTFLOW") {
      await page.getByLabel("抵扣金额", { exact: true }).fill("301");
      await page.getByRole("button", { name: "记入账本" }).click();
      expect(submitted).toBeNull();
      await page.getByLabel("抵扣金额", { exact: true }).fill("200");
    }
    await expect(page.locator(".reimbursement-preview")).toContainText(
      direction === "OUTFLOW" ? "100.00" : "0.00",
    );
    await page.screenshot({
      path: testInfo.outputPath(`reimbursement-${direction}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "记入账本" }).click();
    await expect(page.getByRole("status")).toContainText("已记下");
    expect(submitted).toMatchObject({
      amount: direction === "OUTFLOW" ? "300" : "200",
      reimbursementAmount: "200",
      direction,
    });
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(page.getByRole("textbox", { name: "金额", exact: true })).toHaveValue("");
  });
}

test("can cancel a deduction or change direction without carrying a hidden deduction", async ({
  page,
}) => {
  await page.goto("/add");
  await page.getByRole("textbox", { name: "金额", exact: true }).fill("300");
  await page.getByRole("checkbox").check();
  await page.getByLabel("抵扣金额", { exact: true }).fill("200");
  await page.getByRole("checkbox").uncheck();
  await expect(page.getByLabel("抵扣金额", { exact: true })).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByText("日期、币种和方向", { exact: true }).click();
  await page.getByLabel("方向").selectOption("INFLOW");
  await expect(page.getByRole("checkbox", { name: "这是分摊 / 报销回款" })).not.toBeChecked();
});

test("opens a purchase-ready form at /add with safe editable defaults", async ({ page }) => {
  await page.goto("/add");

  await expect(page.getByRole("heading", { level: 1, name: "记一笔" })).toBeVisible();
  await expect(page.getByLabel("金额")).toHaveAttribute("inputmode", "decimal");
  await expect(page.getByLabel("商户或描述")).toBeVisible();
  await expect(page.getByLabel("账户")).toHaveValue("RBC Credit");
  await expect(page.getByLabel("日期")).toHaveValue(torontoCalendarDate(new Date()));
  await expect(page.getByLabel("币种")).toHaveValue("CAD");
  await expect(page.getByLabel("方向")).toHaveValue("OUTFLOW");
  await expect(page.getByRole("button", { name: "记入账本" })).toBeVisible();
});

test("amount only accepts digits and up to two decimal places", async ({ page }) => {
  await page.goto("/add");

  const amount = page.getByRole("textbox", { name: "金额", exact: true });
  await amount.fill("12abc-3.456");
  await expect(amount).toHaveValue("123.45");

  await amount.fill(".5");
  await expect(amount).toHaveValue("0.5");
});

test("keeps the reimbursement control usable across narrow and wide layouts", async ({ page }) => {
  await page.goto("/add");
  await page.getByRole("textbox", { name: "金额", exact: true }).fill("300");
  await page.getByRole("checkbox", { name: "分摊 / 报销抵扣" }).check();
  await page.getByLabel("抵扣金额", { exact: true }).fill("200");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".reimbursement-preview")).toContainText("100.00");
    await expect(page.getByRole("button", { name: "记入账本" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("publishes an installable standalone manifest that launches /add", async ({ page }) => {
  await page.goto("/add");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  const response = await page.request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    display: "standalone",
    id: "/add",
    scope: "/",
    start_url: "/add",
  });
});

test("saves a known merchant once without persisting financial fields", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/session")) {
      await route.fulfill({
        body: JSON.stringify({
          data: {
            csrfToken: "csrf.payload",
            identity: { email: "owner@example.invalid" },
            timezone: "America/Toronto",
          },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/transaction-previews") && request.method() === "POST") {
      await route.fulfill({
        json: {
          data: {
            category: category("category-expense-food", "Food & Dining"),
            kind: "KNOWN_MERCHANT",
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith("/transactions") && request.method() === "POST") {
      submitted = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        body: JSON.stringify({
          data: {
            categoryConfirmationRequired: false,
            transaction: {
              accountLabel: submitted.accountLabel,
              amountMinor: 1250,
              categorizationSource: "RULE",
              categoryId: "category-expense-food",
              createdAt: "2026-08-31T16:00:00.000Z",
              currency: submitted.currency,
              description: submitted.description,
              direction: submitted.direction,
              id: "transaction-quick-known",
              merchantName: submitted.description,
              normalizedMerchant: "corner cafe",
              postedDate: submitted.postedDate,
              source: "MANUAL",
              status: "POSTED",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 1,
            },
          },
          meta: {},
        }),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.goto("/add");

  await page.getByLabel("金额").fill("12.50");
  await page.getByLabel("商户或描述").fill("Corner Cafe");
  await page.getByLabel("账户").fill("BMO Credit");
  await page.getByRole("button", { name: "记入账本" }).click();

  await expect(page.getByRole("status")).toContainText("已记下");
  await expect(page.getByLabel("金额")).toHaveValue("");
  await expect(page.getByLabel("商户或描述")).toHaveValue("");
  await expect(page.getByLabel("账户")).toHaveValue("RBC Credit");
  await expect(page.getByLabel("金额")).toBeFocused();
  expect(submitted).toEqual({
    accountLabel: "BMO Credit",
    amount: "12.50",
    currency: "CAD",
    description: "Corner Cafe",
    direction: "OUTFLOW",
    postedDate: torontoCalendarDate(new Date()),
  });
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    })),
  ).toEqual({
    local: {},
    session: {},
  });
});

test("shows an explicit sign-in action when Access expires before submission", async ({ page }) => {
  let transactionWrites = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith("/session")) {
      await route.fulfill({ status: 403 });
      return;
    }
    if (request.method() === "POST") transactionWrites += 1;
    await route.fulfill({ status: 404 });
  });
  await page.goto("/add");

  await page.getByLabel("金额").fill("12.50");
  await page.getByLabel("商户或描述").fill("Corner Cafe");
  await page.getByRole("button", { name: "记入账本" }).click();

  await expect(page.getByRole("alert")).toContainText("登录已过期");
  await expect(page.getByRole("button", { name: "重新登录" })).toBeVisible();
  expect(transactionWrites).toBe(0);
  browserProblems.set(
    page,
    (browserProblems.get(page) ?? []).filter(
      (problem) => !problem.includes("server responded with a status of 403"),
    ),
  );
});

test("confirms a new merchant before writing and offers the complete category list", async ({
  page,
}, testInfo) => {
  const transactionBodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/session")) {
      await route.fulfill({
        body: JSON.stringify({
          data: {
            csrfToken: "csrf.payload",
            identity: { email: "owner@example.invalid" },
            timezone: "America/Toronto",
          },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/transaction-previews") && request.method() === "POST") {
      await route.fulfill({
        json: {
          data: {
            category: category("category-expense-shopping", "Shopping"),
            kind: "NEW_MERCHANT",
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith("/categories") && request.method() === "GET") {
      await route.fulfill({
        json: {
          data: {
            categories: [
              category("category-expense-food", "Food & Dining"),
              category("category-expense-shopping", "Shopping"),
              { ...category("category-inactive", "Inactive"), active: false },
              { ...category("category-income-other", "Other Income"), kind: "INCOME" },
            ],
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith("/transactions") && request.method() === "POST") {
      const submitted = request.postDataJSON() as Record<string, unknown>;
      transactionBodies.push(submitted);
      await route.fulfill({
        json: {
          data: {
            categoryConfirmationRequired: false,
            transaction: {
              accountLabel: submitted.accountLabel,
              amountMinor: 875,
              reimbursementMinor: 0,
              categorizationSource: "RULE",
              categoryId: submitted.categoryId,
              createdAt: "2026-08-31T16:00:00.000Z",
              currency: submitted.currency,
              description: submitted.description,
              direction: submitted.direction,
              id: "transaction-quick-unknown",
              merchantName: submitted.description,
              normalizedMerchant: "ikea",
              postedDate: submitted.postedDate,
              source: "MANUAL",
              status: "POSTED",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 1,
            },
          },
          meta: {},
        },
        status: 201,
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.goto("/add");

  await page.getByLabel("金额").fill("8.75");
  await page.getByLabel("商户或描述").fill("IKEA");
  await page.getByRole("button", { name: "记入账本" }).click();

  const dialog = page.getByRole("dialog", { name: "确认新商户" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "确认新商户" })).toBeFocused();
  await expect(page.getByLabel("分类")).toHaveValue("category-expense-shopping");
  await expect(page.getByRole("option", { name: "Food & Dining" })).toBeAttached();
  await expect(page.getByRole("option", { name: "Shopping" })).toBeAttached();
  await expect(page.getByRole("option", { name: "Inactive" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Other Income" })).toHaveCount(0);
  expect(transactionBodies).toHaveLength(0);

  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并录入" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (width === 320) {
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath("new-merchant-confirmation-320.png"),
      });
    }
  }

  await page.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("金额")).toHaveValue("8.75");
  await expect(page.getByLabel("商户或描述")).toHaveValue("IKEA");
  expect(transactionBodies).toHaveLength(0);

  await page.getByRole("button", { name: "记入账本" }).click();
  await page.getByLabel("分类").selectOption("category-expense-food");
  await page.getByRole("button", { name: "确认并录入" }).click();
  await expect(page.getByRole("status")).toContainText("已记下");
  expect(transactionBodies).toEqual([
    expect.objectContaining({
      categoryId: "category-expense-food",
      description: "IKEA",
      rememberMerchant: true,
    }),
  ]);
});

test("keeps a new-merchant confirmation intact when the final write needs retry", async ({
  page,
}) => {
  let transactionAttempts = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
      return;
    }
    if (url.pathname.endsWith("/transaction-previews")) {
      await route.fulfill({
        json: {
          data: {
            category: category("category-expense-shopping", "Shopping"),
            kind: "NEW_MERCHANT",
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith("/categories") && request.method() === "GET") {
      await route.fulfill({
        json: {
          data: { categories: [category("category-expense-shopping", "Shopping")] },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith("/transactions") && request.method() === "POST") {
      transactionAttempts += 1;
      if (transactionAttempts === 1) {
        await route.fulfill({ status: 500 });
        return;
      }
      const submitted = request.postDataJSON() as Record<string, string> & {
        categoryId: string;
      };
      await route.fulfill({
        json: {
          data: {
            categoryConfirmationRequired: false,
            transaction: {
              accountLabel: submitted.accountLabel,
              amountMinor: 1999,
              reimbursementMinor: 0,
              categorizationSource: "RULE",
              categoryId: submitted.categoryId,
              createdAt: "2026-08-31T16:00:00.000Z",
              currency: submitted.currency,
              description: submitted.description,
              direction: submitted.direction,
              id: "transaction-retry",
              merchantName: submitted.description,
              normalizedMerchant: "ikea",
              postedDate: submitted.postedDate,
              source: "MANUAL",
              status: "POSTED",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 1,
            },
          },
          meta: {},
        },
        status: 201,
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.goto("/add");
  await page.getByLabel("金额").fill("19.99");
  await page.getByLabel("商户或描述").fill("IKEA");
  await page.getByRole("button", { name: "记入账本" }).click();
  await page.getByRole("button", { name: "确认并录入" }).click();

  await expect(page.getByRole("alert")).toContainText("尚未录入");
  await expect(page.getByRole("dialog", { name: "确认新商户" })).toBeVisible();
  await expect(page.getByLabel("金额")).toHaveValue("19.99");
  await expect(page.getByLabel("分类")).toHaveValue("category-expense-shopping");

  await page.getByRole("button", { name: "确认并录入" }).click();
  await expect(page.getByRole("status")).toContainText("已记下");
  expect(transactionAttempts).toBe(2);
  browserProblems.set(
    page,
    (browserProblems.get(page) ?? []).filter(
      (problem) => !problem.includes("server responded with a status of 500"),
    ),
  );
});

test("accepts a suggestion and learns an exact future merchant rule", async ({ page }) => {
  const mutations: Array<{ body: unknown; method: string; path: string }> = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/session")) {
      await route.fulfill({
        body: JSON.stringify({
          data: {
            csrfToken: "csrf.payload",
            identity: { email: "owner@example.invalid" },
            timezone: "America/Toronto",
          },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/transaction-previews") && request.method() === "POST") {
      await route.fulfill({
        json: {
          data: {
            category: category("category-expense-food", "Food & Dining"),
            kind: "NEW_MERCHANT",
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith("/transactions") && request.method() === "POST") {
      const submitted = request.postDataJSON() as Record<string, string>;
      mutations.push({ body: submitted, method: request.method(), path: url.pathname });
      await route.fulfill({
        body: JSON.stringify({
          data: {
            categoryConfirmationRequired: false,
            transaction: {
              accountLabel: submitted.accountLabel,
              amountMinor: 875,
              reimbursementMinor: 0,
              categorizationSource: "RULE",
              categoryId: submitted.categoryId,
              createdAt: "2026-08-31T16:00:00.000Z",
              currency: submitted.currency,
              description: submitted.description,
              direction: submitted.direction,
              id: "transaction-quick-rule",
              merchantName: submitted.description,
              normalizedMerchant: "new corner",
              postedDate: submitted.postedDate,
              source: "MANUAL",
              status: "POSTED",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 1,
            },
          },
          meta: {},
        }),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    if (url.pathname.endsWith("/category-suggestions")) {
      await route.fulfill({
        body: JSON.stringify({
          data: {
            suggestions: [
              {
                category: category("category-expense-food", "Food & Dining"),
                reason: "POPULAR_EXPENSE",
              },
            ],
            transactionId: "transaction-quick-rule",
          },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/categories") && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          data: { categories: [category("category-expense-food", "Food & Dining")] },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/merchant-rule") && request.method() === "PUT") {
      mutations.push({
        body: request.postDataJSON(),
        method: request.method(),
        path: url.pathname,
      });
      await route.fulfill({
        body: JSON.stringify({
          data: {
            merchantRule: {
              active: true,
              categoryId: "category-expense-food",
              createdAt: "2026-08-31T16:00:00.000Z",
              displayMerchant: "New Corner",
              id: "merchant-rule-new-corner",
              normalizedMerchant: "new corner",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 1,
            },
            transaction: {
              accountId: null,
              accountLabel: "RBC Credit",
              amountMinor: 875,
              authorizedDate: null,
              categorizationSource: "RULE",
              categoryId: "category-expense-food",
              categoryRuleId: "merchant-rule-new-corner",
              createdAt: "2026-08-31T16:00:00.000Z",
              currency: "CAD",
              description: "New Corner",
              direction: "OUTFLOW",
              id: "transaction-quick-rule",
              merchantName: "New Corner",
              needsReview: false,
              normalizedMerchant: "new corner",
              paymentMetadata: {
                payee: null,
                payer: null,
                paymentMethod: null,
                referenceNumber: null,
              },
              postedDate: "2026-08-31",
              reviewReason: null,
              source: "MANUAL",
              status: "POSTED",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 2,
            },
          },
          meta: { historicalTransactionsChanged: 0 },
        }),
        contentType: "application/json",
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.goto("/add");

  await page.getByLabel("金额").fill("8.75");
  await page.getByLabel("商户或描述").fill("New Corner");
  await page.getByRole("button", { name: "记入账本" }).click();
  await page.getByRole("button", { name: "确认并录入" }).click();

  await expect(page.getByRole("status")).toContainText("已记下");
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatchObject({
    body: {
      categoryId: "category-expense-food",
      description: "New Corner",
      rememberMerchant: true,
    },
    method: "POST",
    path: "/api/v1/transactions",
  });
});

test("searches existing categories and requires a second confirmation before creating one", async ({
  page,
}) => {
  let createdCategory = false;
  const ruleCategoryIds: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/session")) {
      await route.fulfill({
        body: JSON.stringify({
          data: {
            csrfToken: "csrf.payload",
            identity: { email: "owner@example.invalid" },
            timezone: "America/Toronto",
          },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/transaction-previews") && request.method() === "POST") {
      await route.fulfill({
        json: {
          data: {
            category: category("category-expense-restaurant", "Restaurant"),
            kind: "NEW_MERCHANT",
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith("/transactions") && request.method() === "POST") {
      const submitted = request.postDataJSON() as Record<string, string> & {
        categoryId: string;
      };
      ruleCategoryIds.push(submitted.categoryId);
      await route.fulfill({
        body: JSON.stringify({
          data: {
            categoryConfirmationRequired: false,
            transaction: {
              accountLabel: submitted.accountLabel,
              amountMinor: 2200,
              reimbursementMinor: 0,
              categorizationSource: "RULE",
              categoryId: submitted.categoryId,
              createdAt: "2026-08-31T16:00:00.000Z",
              currency: submitted.currency,
              description: submitted.description,
              direction: submitted.direction,
              id: "transaction-quick-new-category",
              merchantName: submitted.description,
              normalizedMerchant: "brunch room",
              postedDate: submitted.postedDate,
              source: "MANUAL",
              status: "POSTED",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 1,
            },
          },
          meta: {},
        }),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    if (url.pathname.endsWith("/category-suggestions")) {
      await route.fulfill({
        body: JSON.stringify({
          data: { suggestions: [], transactionId: "transaction-quick-new-category" },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/categories") && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          data: {
            categories: [category("category-expense-restaurant", "Restaurant")],
          },
          meta: {},
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname.endsWith("/categories") && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ kind: "EXPENSE", name: "Brunch" });
      createdCategory = true;
      await route.fulfill({
        body: JSON.stringify({
          data: { category: category("category-expense-brunch", "Brunch") },
          meta: {},
        }),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    if (url.pathname.endsWith("/merchant-rule") && request.method() === "PUT") {
      const body = request.postDataJSON() as { categoryId: string };
      ruleCategoryIds.push(body.categoryId);
      await route.fulfill({
        body: JSON.stringify({
          data: {
            merchantRule: {
              active: true,
              categoryId: body.categoryId,
              createdAt: "2026-08-31T16:00:00.000Z",
              displayMerchant: "Brunch Room",
              id: "merchant-rule-brunch-room",
              normalizedMerchant: "brunch room",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 1,
            },
            transaction: {
              accountId: null,
              accountLabel: "RBC Credit",
              amountMinor: 2200,
              authorizedDate: null,
              categorizationSource: "RULE",
              categoryId: body.categoryId,
              categoryRuleId: "merchant-rule-brunch-room",
              createdAt: "2026-08-31T16:00:00.000Z",
              currency: "CAD",
              description: "Brunch Room",
              direction: "OUTFLOW",
              id: "transaction-quick-new-category",
              merchantName: "Brunch Room",
              needsReview: false,
              normalizedMerchant: "brunch room",
              paymentMetadata: {
                payee: null,
                payer: null,
                paymentMethod: null,
                referenceNumber: null,
              },
              postedDate: "2026-08-31",
              reviewReason: null,
              source: "MANUAL",
              status: "POSTED",
              updatedAt: "2026-08-31T16:00:00.000Z",
              version: 2,
            },
          },
          meta: { historicalTransactionsChanged: 0 },
        }),
        contentType: "application/json",
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.goto("/add");
  await page.getByLabel("金额").fill("22.00");
  await page.getByLabel("商户或描述").fill("Brunch Room");
  await page.getByRole("button", { name: "记入账本" }).click();

  await page.getByRole("button", { name: "搜索或创建类别…" }).click();
  await page.getByLabel("搜索或输入类别").fill("Rest");
  await expect(page.getByRole("button", { name: "Restaurant" })).toBeVisible();
  await expect(page.getByRole("button", { name: /创建新类别/ })).toHaveCount(0);

  await page.getByLabel("搜索或输入类别").fill("Brunch");
  await page.getByRole("button", { name: "创建新类别“Brunch”" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "确认创建新类别" })).toBeVisible();
  expect(createdCategory).toBe(false);
  await page.getByRole("button", { name: "确认创建类别" }).click();

  await expect.poll(() => createdCategory).toBe(true);
  await expect(page.getByLabel("分类")).toHaveValue("category-expense-brunch");
  await page.getByRole("button", { name: "确认并录入" }).click();
  await expect(page.getByRole("status")).toContainText("已记下");
  expect(ruleCategoryIds).toEqual(["category-expense-brunch"]);
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    })),
  ).toEqual({ local: {}, session: {} });
});
