import { expect, test } from "@playwright/test";

test("renders the local workspace shell without horizontal overflow", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Personal Ledger");
  await expect(page.getByRole("heading", { level: 1, name: "Personal Ledger" })).toBeVisible();

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(widths.scroll).toBe(widths.client);
});
