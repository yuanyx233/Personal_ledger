import { budgetsResponseSchema, fullJsonExportSchema } from "@ledger/domain";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const identity = {
  email: "owner@example.invalid",
  sessionBinding: "budget-test",
  subject: "owner",
};
const key = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const worker = createAppWorker(() => Promise.resolve(identity));
const env = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  CSRF_HMAC_KEY: key,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;

beforeAll(() => applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS));

beforeEach(() => cloudflareEnv.DB.prepare("DELETE FROM category_budgets").run());

async function save(amountMinor: number | null, effectiveMonth: string, extra = {}) {
  return worker.fetch(
    new Request("https://ledger.example/api/v1/budgets", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ledger.example",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": await issueCsrfToken(identity, key),
      },
      body: JSON.stringify({
        categoryId: "category-expense-food",
        currency: "CAD",
        effectiveMonth,
        amountMinor,
        ...extra,
      }),
    }),
    env,
  );
}

async function read(month: string) {
  const response = await worker.fetch(
    new Request(`https://ledger.example/api/v1/budgets?month=${month}`),
    env,
  );
  expect(response.status).toBe(200);
  return budgetsResponseSchema.parse(await response.json());
}

it("persists monthly limits, inherits them, and preserves history when changing or cancelling", async () => {
  expect((await save(50_000, "2026-09")).status).toBe(200);
  expect((await read("2026-08")).data.budgets).toEqual([]);
  expect((await read("2026-10")).data.budgets).toMatchObject([
    { amountMinor: 50_000, effectiveMonth: "2026-09" },
  ]);
  expect((await save(60_000, "2026-10")).status).toBe(200);
  expect((await save(null, "2026-11")).status).toBe(200);
  expect((await read("2026-09")).data.budgets).toMatchObject([{ amountMinor: 50_000 }]);
  expect((await read("2026-10")).data.budgets).toMatchObject([{ amountMinor: 60_000 }]);
  expect((await read("2027-01")).data.budgets).toMatchObject([{ amountMinor: null }]);
  expect((await save(0, "2026-10", { currency: "USD" })).status).toBe(200);
  expect((await read("2026-10")).data.budgets).toMatchObject([
    { amountMinor: 60_000, currency: "CAD" },
    { amountMinor: 0, currency: "USD" },
  ]);
  expect((await save(45_000, "2026-09")).status).toBe(200);
  expect((await read("2026-10")).data.budgets[0]?.amountMinor).toBe(60_000);
  const backupResponse = await worker.fetch(
    new Request("https://ledger.example/api/v1/exports/data.json"),
    env,
  );
  expect(backupResponse.status).toBe(200);
  const backup = fullJsonExportSchema.parse(await backupResponse.json());
  expect(backup.recordCounts.budgets).toBe(4);
  expect(backup.data.budgets).toContainEqual(
    expect.objectContaining({ amountMinor: null, effectiveMonth: "2026-11" }),
  );
});

it("rejects invalid limits, months and non-expense categories without writing", async () => {
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect((await save(amount, "2026-09")).status).toBe(422);
  expect((await save(10, "2026-13")).status).toBe(422);
  expect((await save(10, "2026-09", { categoryId: "category-system-transfer" })).status).toBe(422);
  expect((await save(10, "2026-09", { categoryId: "missing" })).status).toBe(422);
  expect((await save(10, "2026-09", { currency: "cad" })).status).toBe(422);
  const denied = await worker.fetch(
    new Request("https://ledger.example/api/v1/budgets", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ledger.example",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
    }),
    env,
  );
  expect(denied.status).toBe(403);
  await expect(denied.json()).resolves.toMatchObject({ error: { code: "CSRF_INVALID" } });
  expect((await read("2026-09")).data.budgets).toEqual([]);
});

it("validates month queries and reports database failures without returning an empty budget", async () => {
  for (const query of [
    "",
    "?month=2026-13",
    "?month=2026-09&month=2026-10",
    "?month=2026-09&currency=CAD",
  ]) {
    expect(
      (await worker.fetch(new Request(`https://ledger.example/api/v1/budgets${query}`), env))
        .status,
    ).toBe(422);
  }
  expect(
    (
      await worker.fetch(
        new Request("https://ledger.example/api/v1/budgets", { method: "HEAD" }),
        env,
      )
    ).status,
  ).toBe(405);
  const failed = await worker.fetch(
    new Request("https://ledger.example/api/v1/budgets?month=2026-09"),
    {
      ...env,
      DB: {
        prepare() {
          throw new Error("Test database unavailable");
        },
      } as unknown as D1Database,
    },
  );
  expect(failed.status).toBe(500);
  await expect(failed.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
});
