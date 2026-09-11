import { expect, test, type Page } from "@playwright/test";

function colorChannels(value: string) {
  if (value.startsWith("#")) {
    return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  }
  return (value.match(/[0-9.]+/g) ?? []).slice(0, 3).map(Number);
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = colorChannels(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

const category = {
  active: true,
  createdAt: "2026-07-17T12:00:00.000Z",
  editable: true,
  id: "category-expense",
  kind: "EXPENSE",
  name: "日常支出",
  systemKey: null,
  updatedAt: "2026-07-17T12:00:00.000Z",
  version: 1,
};

export async function mockSettingsReads(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith("/categories")) {
      body = { data: { categories: [category] }, meta: {} };
    } else if (url.pathname.endsWith("/merchant-rules")) {
      body = {
        data: { rules: [] },
        meta: {
          hasMore: false,
          nextCursor: null,
          query: { pageSize: 100 },
        },
      };
    } else {
      body = { error: { code: "NOT_FOUND", message: "Not found" } };
    }
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: "error" in (body as object) ? 404 : 200,
    });
  });
}

test("shows subscription management, categories, CSV import and export", async ({ page }) => {
  await mockSettingsReads(page);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "银行连接与账户" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "类别与商户规则" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "订阅管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CSV 导入" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "完整导出" })).toBeVisible();

  await expect(page.getByRole("link", { name: "下载交易 CSV" })).toHaveAttribute(
    "href",
    "/api/v1/exports/transactions.csv",
  );
  await expect(page.getByRole("link", { name: "下载完整 JSON" })).toHaveAttribute(
    "href",
    "/api/v1/exports/data.json",
  );
});

test("performs scoped rule writes with CSRF", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body: unknown;
    if (url.pathname.endsWith("/session")) {
      body = {
        data: {
          csrfToken: "csrf.payload",
          identity: { email: "owner@example.invalid" },
          timezone: "America/Toronto",
        },
        meta: {},
      };
    } else if (url.pathname.endsWith("/categories")) {
      body = { data: { categories: [category] }, meta: {} };
    } else if (url.pathname.endsWith("/merchant-rule-previews")) {
      body = {
        data: {
          existingRule: null,
          proposedRule: {
            categoryId: "category-expense",
            displayMerchant: "Corner Market",
            normalizedMerchant: "corner market",
          },
        },
        meta: {
          conflictingTransactions: 1,
          historicalTransactionsChanged: 0,
          matchingTransactions: 2,
        },
      };
    } else if (url.pathname.endsWith("/merchant-rules") && method === "GET") {
      body = {
        data: { rules: [] },
        meta: { hasMore: false, nextCursor: null, query: { pageSize: 100 } },
      };
    } else if (url.pathname.endsWith("/merchant-rules")) {
      body = {
        data: {
          merchantRule: {
            active: true,
            categoryId: "category-expense",
            createdAt: "2026-07-17T12:00:00.000Z",
            displayMerchant: "Corner Market",
            id: "merchant-rule-corner",
            normalizedMerchant: "corner market",
            updatedAt: "2026-07-17T12:00:00.000Z",
            version: 1,
          },
        },
        meta: {
          conflictingTransactions: 1,
          historicalTransactionsChanged: 0,
          matchingTransactions: 2,
        },
      };
    } else {
      body = { error: { code: "NOT_FOUND", message: "Not found" } };
    }
    const isError = "error" in (body as Record<string, unknown>);
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      status: isError ? 404 : 200,
    });
  });
  await page.goto("/settings");

  await page.getByLabel("商户显示名称").fill("Corner Market");
  await page.getByRole("button", { name: "预览 exact 规则" }).click();
  await expect(page.getByText("规范化键：corner market")).toBeVisible();
  await page.getByRole("button", { name: "确认保存未来规则" }).click();
  await expect(page.getByText("未来商户规则已保存；历史交易没有改变。")).toBeVisible();
});

test("previews RBC CSV without exposing account numbers and summarizes automatic and owner merges", async ({
  page,
}) => {
  let commitBody: unknown;
  let commitKey = "";
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown;
    if (url.pathname.endsWith("/session")) {
      body = {
        data: {
          csrfToken: "csrf.payload",
          identity: { email: "owner@example.invalid" },
          timezone: "America/Toronto",
        },
        meta: {},
      };
    } else if (url.pathname.endsWith("/categories")) {
      body = { data: { categories: [category] }, meta: {} };
    } else if (url.pathname.endsWith("/merchant-rules")) {
      body = {
        data: { rules: [] },
        meta: { hasMore: false, nextCursor: null, query: { pageSize: 100 } },
      };
    } else if (url.pathname.endsWith("/imports/csv")) {
      body = {
        data: {
          preview: {
            adapter: "RBC_CA_V1",
            columns: [
              "Account Type",
              "Account Number",
              "Transaction Date",
              "Cheque Number",
              "Description 1",
              "Description 2",
              "CAD$",
              "USD$",
            ],
            counts: { duplicate: 2, invalid: 0, total: 2, valid: 0 },
            expiresAt: "2026-07-17T12:30:00.000Z",
            fileName: "rbc.csv",
            id: "import-preview-fixture",
            mapping: null,
            reviewRows: [],
            rows: [
              {
                canonicalFingerprint: "a".repeat(64),
                duplicateEvidence: "SUSPECTED_EXISTING",
                errors: [],
                existingMatch: {
                  candidates: [
                    {
                      dateDistanceDays: 0,
                      description: "Apple subscription",
                      evidence: "SUBSCRIPTION_EXACT",
                      postedDate: "2026-07-22",
                      subscriptionName: "Apple",
                      subscriptionOccurrenceId: "occurrence-apple-july",
                      transactionId: "transaction-apple-generated",
                      transactionVersion: 1,
                    },
                  ],
                  disposition: "AUTO_MERGE_EXISTING",
                },
                raw: {
                  accountLabel: "RBC Credit",
                  amount: "11.49",
                  category: null,
                  currency: "CAD",
                  description: "APPLE.COM/BILL TORONTO ON",
                  direction: "OUTFLOW",
                  merchant: "APPLE.COM/BILL TORONTO ON",
                  postedDate: "2026-07-22",
                },
                rowNumber: 2,
                status: "DUPLICATE",
              },
              {
                canonicalFingerprint: "d".repeat(64),
                duplicateEvidence: "SUSPECTED_EXISTING",
                errors: [],
                existingMatch: {
                  candidates: [
                    {
                      dateDistanceDays: 0,
                      description: "Costco",
                      evidence: "DESCRIPTION_EXACT",
                      postedDate: "2026-07-23",
                      subscriptionName: null,
                      subscriptionOccurrenceId: null,
                      transactionId: "transaction-costco-manual",
                      transactionVersion: 3,
                    },
                  ],
                  disposition: "SUSPECTED_EXISTING",
                },
                raw: {
                  accountLabel: "RBC Credit",
                  amount: "66.25",
                  category: null,
                  currency: "CAD",
                  description: "COSTCO WHOLESALE W1316 EAST YORK ON",
                  direction: "OUTFLOW",
                  merchant: "COSTCO WHOLESALE W1316 EAST YORK ON",
                  postedDate: "2026-07-23",
                },
                rowNumber: 3,
                status: "DUPLICATE",
              },
            ],
            status: "PREVIEWED",
            version: 1,
          },
        },
        meta: { ledgerTransactionsCreated: 0, replayed: false, rowsTruncated: false },
      };
    } else if (url.pathname.includes("/imports/import-preview-fixture/commit")) {
      commitKey = request.headers()["idempotency-key"] ?? "";
      commitBody = request.postDataJSON();
      body = {
        data: {
          importBatch: {
            committedAt: "2026-07-17T12:05:00.000Z",
            contentChecksum: "b".repeat(64),
            counts: {
              autoMerged: 1,
              importedNew: 0,
              ownerMerged: 1,
              skippedDuplicate: 0,
              skippedInvalid: 0,
              total: 2,
            },
            id: "import-preview-fixture",
            rows: [
              {
                duplicateEvidence: "SUSPECTED_EXISTING",
                outcome: "AUTO_MERGED",
                rowNumber: 2,
                transactionId: "transaction-apple-generated",
              },
              {
                duplicateEvidence: "SUSPECTED_EXISTING",
                outcome: "OWNER_MERGED",
                rowNumber: 3,
                transactionId: "transaction-costco-manual",
              },
            ],
            sourceFileNameHash: "c".repeat(64),
            status: "COMMITTED",
            version: 2,
          },
        },
        meta: { replayed: false },
      };
    } else {
      body = { error: { code: "NOT_FOUND", message: "Not found" } };
    }
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/settings");
  await page.getByLabel("CSV 文件").setInputFiles({
    buffer: Buffer.from(
      "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$\nVisa,4512345678901234,7/22/2026,,APPLE.COM/BILL,TORONTO ON,-11.49,\nVisa,4512345678901234,7/23/2026,,COSTCO WHOLESALE W1316,EAST YORK ON,-66.25,",
    ),
    mimeType: "text/csv",
    name: "rbc.csv",
  });
  await page.getByRole("button", { name: "只预览，不写账本" }).click();
  await expect(page.getByRole("table", { name: "CSV 导入预览" })).toBeVisible();
  await expect(page.getByText("识别方式：RBC 加拿大流水")).toBeVisible();
  await expect(page.getByText(/高置信度，将合并到：Apple subscription/)).toBeVisible();
  await expect(page.getByText("4512345678901234")).toHaveCount(0);
  await page.getByRole("button", { name: "丢弃预览" }).click();
  await expect(page.getByText("丢弃当前 CSV 预览？")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("table", { name: "CSV 导入预览" })).toBeVisible();
  await page.getByLabel("第 3 行决定").selectOption("MERGE:0");
  await page.getByRole("button", { name: "提交已确认行" }).click();
  await expect(
    page.getByText("CSV 已提交：新增 0 笔，自动合并 1 笔，人工合并 1 笔。"),
  ).toBeVisible();
  expect(commitBody).toEqual({
    reviewDecisions: [
      {
        action: "MERGE_EXISTING",
        candidateTransactionId: "transaction-costco-manual",
        candidateVersion: 3,
        rowNumber: 3,
      },
    ],
    version: 1,
  });
  expect(commitKey.length).toBeGreaterThanOrEqual(16);
});

test("keeps settings keyboard-visible, labeled, reduced-motion safe, and reflowable", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockSettingsReads(page);
  await page.goto("/settings");

  const unnamedControls = await page
    .locator('button, input:not([type="hidden"]), select')
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const element = control as HTMLInputElement;
          const label = element.labels?.[0]?.textContent?.trim();
          return !label && !element.getAttribute("aria-label") && !element.textContent?.trim();
        })
        .map((control) => control.outerHTML),
    );
  expect(unnamedControls).toEqual([]);
  await expect(page.locator('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])')).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
  const focusOutline = await page
    .getByRole("link", { name: "跳到主要内容" })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
  expect(focusOutline.style).not.toBe("none");
  expect(focusOutline.width).toBeGreaterThanOrEqual(2);

  const motion = await page.locator(".settings-page").evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, transition: style.transitionDuration };
  });
  expect(motion.animation).toBe("none");
  expect(motion.transition).toBe("0s");
  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const button = getComputedStyle(
      document.querySelector(".settings-export-actions .primary-action")!,
    );
    return {
      canvas: root.getPropertyValue("--canvas").trim(),
      muted: root.getPropertyValue("--muted").trim(),
      primaryBackground: button.backgroundColor,
      primaryText: button.color,
    };
  });
  expect(contrastRatio(colors.muted, colors.canvas)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.primaryText, colors.primaryBackground)).toBeGreaterThanOrEqual(4.5);
  if (testInfo.project.name === "chromium-desktop") {
    await page.setViewportSize({ height: 900, width: 320 });
  }
  const overflowing = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("body *"));
    return elements
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
      .slice(0, 10);
  });
  expect(overflowing).toEqual([]);
});
