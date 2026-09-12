import type { Page } from "@playwright/test";

function previousMonth(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodMeta(period: string) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return {
    dateFrom: `${period}-01`,
    dateTo: `${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`,
    grain: "MONTH",
    label: period,
    timeZone: "America/Toronto",
  };
}

export async function mockEmptyOverviewApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname.endsWith("/reports/cash-flow")) {
      const period = url.searchParams.get("period")!;
      const prior = previousMonth(period);
      body = {
        data: { sections: [] },
        meta: {
          freshness: { generatedAt: "2026-07-17T12:00:00.000Z" },
          periods: {
            current: periodMeta(period),
            previousPeriod: periodMeta(prior),
            previousYear: periodMeta(`${Number(period.slice(0, 4)) - 1}-${period.slice(5)}`),
          },
          query: { grain: "MONTH", period },
        },
      };
    }
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  });
}
