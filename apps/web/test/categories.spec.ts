import {
  categoriesResponseSchema,
  categoryMutationResponseSchema,
} from "@ledger/domain/api-contracts";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const CSRF_HMAC_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const worker = createAppWorker(() => Promise.resolve(IDENTITY));
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
});

describe("category taxonomy API", () => {
  it("returns owner and protected system categories in stable order", async () => {
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/categories"),
      workerEnv,
    );
    const body = categoriesResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.categories.length).toBeGreaterThanOrEqual(10);
    expect(body.data.categories).toContainEqual(
      expect.objectContaining({
        editable: false,
        id: "category-system-transfer",
        systemKey: "TRANSFER",
      }),
    );
    expect(body.data.categories.map(({ id }) => id)).toContain("category-expense-food");
  });

  it("creates an owner expense category once and rejects the normalized duplicate", async () => {
    const csrfToken = await issueCsrfToken(IDENTITY, CSRF_HMAC_KEY);
    const response = await worker.fetch(
      new Request("https://ledger.example/api/v1/categories", {
        body: JSON.stringify({ kind: "EXPENSE", name: "  Restaurant  " }),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://ledger.example",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      }),
      workerEnv,
    );

    expect(response.status).toBe(201);
    const created = categoryMutationResponseSchema.parse(await response.json()).data.category;
    expect(created).toMatchObject({ editable: true, kind: "EXPENSE", name: "Restaurant" });
    expect(response.headers.get("Location")).toBe(`/api/v1/categories/${created.id}`);

    const conflict = await worker.fetch(
      new Request("https://ledger.example/api/v1/categories", {
        body: JSON.stringify({ kind: "EXPENSE", name: "restaurant" }),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://ledger.example",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      }),
      workerEnv,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "CATEGORY_NAME_CONFLICT" },
    });
    await expect(
      cloudflareEnv.DB.prepare(
        "SELECT COUNT(*) AS count FROM categories WHERE normalized_name = 'restaurant'",
      ).first<number>("count"),
    ).resolves.toBe(1);
  });
});
