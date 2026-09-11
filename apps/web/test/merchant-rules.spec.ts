import {
  merchantRuleListResponseSchema,
  merchantRuleMutationResponseSchema,
  merchantRulePreviewResponseSchema,
} from "@ledger/domain/api-contracts";
import { MerchantRuleManagementRepository } from "@ledger/persistence";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";
import { clearCategoryAudits } from "./support/category-audits";

const CSRF_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const NOW = "2026-07-15T13:00:00.000Z";
const IDENTITY = {
  email: "owner@example.invalid",
  sessionBinding: "access-session-1",
  subject: "owner-subject",
};
const workerEnv = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  ASSETS: { fetch: () => Promise.resolve(new Response("workspace asset")) },
  CSRF_HMAC_KEY: CSRF_KEY,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;
let currentTime = NOW;
const worker = createAppWorker(
  () => Promise.resolve(IDENTITY),
  undefined,
  () => new Date(currentTime),
);
let csrfToken: string;

function read(pathAndQuery: string) {
  return worker.fetch(new Request(`https://ledger.example/api/v1${pathAndQuery}`), workerEnv);
}

function write(path: string, method: "DELETE" | "PATCH" | "POST", body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`https://ledger.example/api/v1${path}`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ledger.example",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrfToken,
      },
      method,
    }),
    workerEnv,
  );
}

beforeAll(async () => {
  await applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS);
  csrfToken = await issueCsrfToken(IDENTITY, CSRF_KEY);
});

beforeEach(async () => {
  currentTime = NOW;
  await clearCategoryAudits(cloudflareEnv.DB);
  await cloudflareEnv.DB.batch(
    ["transactions", "merchant_rules", "categories WHERE system_key IS NULL"].map((table) =>
      cloudflareEnv.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await cloudflareEnv.DB.batch(
    [
      ["category-old", "Old category", 1],
      ["category-new", "New category", 1],
      ["category-inactive", "Inactive category", 0],
    ].map(([id, name, active]) =>
      cloudflareEnv.DB.prepare(
        `INSERT INTO categories (
          id, name, kind, editable, active, created_at, updated_at, version
        ) VALUES (?, ?, 'EXPENSE', 1, ?, ?, ?, 1)`,
      ).bind(id, name, active, NOW, NOW),
    ),
  );

  const transaction = (id: string, normalizedMerchant: string, categoryId: string) =>
    cloudflareEnv.DB.prepare(
      `INSERT INTO transactions (
        id, source, account_label, import_fingerprint, status, posted_date,
        amount_minor, direction, currency, raw_description, merchant_name,
        category_id, categorization_source, normalized_merchant, needs_review,
        created_at, updated_at, version
      ) VALUES (
        ?, 'CSV', 'Imported account', ?, 'POSTED', '2026-07-15', 1234,
        'OUTFLOW', 'CAD', ?, ?, ?, 'PLAID', ?, 0, ?, ?, 1
      )`,
    ).bind(
      id,
      `fingerprint-${id}`,
      normalizedMerchant,
      normalizedMerchant,
      categoryId,
      normalizedMerchant,
      NOW,
      NOW,
    );
  await cloudflareEnv.DB.batch([
    transaction("transaction-rule-acme-1", "acme", "category-old"),
    transaction("transaction-rule-acme-2", "acme", "category-new"),
    transaction("transaction-rule-beta-1", "beta market", "category-old"),
  ]);
});

describe("merchant-rule management API", () => {
  it("previews conflicts without writing, then creates without rewriting history", async () => {
    const previewResponse = await read(
      "/merchant-rule-previews?displayMerchant=Acme+Store+42&categoryId=category-new",
    );
    const preview = merchantRulePreviewResponseSchema.parse(await previewResponse.json());
    expect(previewResponse.status).toBe(200);
    expect(preview).toEqual({
      data: {
        existingRule: null,
        proposedRule: {
          categoryId: "category-new",
          displayMerchant: "Acme Store 42",
          normalizedMerchant: "acme",
        },
      },
      meta: {
        conflictingTransactions: 2,
        historicalTransactionsChanged: 0,
        matchingTransactions: 2,
      },
    });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM merchant_rules").first<number>(
        "count",
      ),
    ).resolves.toBe(0);

    const createResponse = await write("/merchant-rules", "POST", {
      categoryId: "category-new",
      displayMerchant: "Acme Store 42",
    });
    const created = merchantRuleMutationResponseSchema.parse(await createResponse.json());
    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("Location")).toBe(
      `/api/v1/merchant-rules/${created.data.merchantRule.id}`,
    );
    expect(created.data.merchantRule).toMatchObject({
      active: true,
      categoryId: "category-new",
      displayMerchant: "Acme Store 42",
      normalizedMerchant: "acme",
      version: 1,
    });
    expect(created.meta).toEqual(preview.meta);
    await expect(
      cloudflareEnv.DB.prepare(
        `SELECT id, category_id, categorization_source, version
         FROM transactions WHERE normalized_merchant = 'acme' ORDER BY id`,
      ).all(),
    ).resolves.toMatchObject({
      results: [
        {
          categorization_source: "PLAID",
          category_id: "category-old",
          id: "transaction-rule-acme-1",
          version: 1,
        },
        {
          categorization_source: "PLAID",
          category_id: "category-new",
          id: "transaction-rule-acme-2",
          version: 1,
        },
      ],
    });

    const duplicate = await write("/merchant-rules", "POST", {
      categoryId: "category-old",
      displayMerchant: "  ACME store 999 ",
    });
    expect(duplicate.status).toBe(409);
  });

  it("lists with stable cursors, versions updates, and deactivates without deletion", async () => {
    const acme = merchantRuleMutationResponseSchema.parse(
      await (
        await write("/merchant-rules", "POST", {
          categoryId: "category-old",
          displayMerchant: "Acme",
        })
      ).json(),
    ).data.merchantRule;
    currentTime = "2026-07-15T13:01:00.000Z";
    const beta = merchantRuleMutationResponseSchema.parse(
      await (
        await write("/merchant-rules", "POST", {
          categoryId: "category-old",
          displayMerchant: "Beta Market",
        })
      ).json(),
    ).data.merchantRule;

    await expect(
      new MerchantRuleManagementRepository(cloudflareEnv.DB).listPage({
        active: true,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ hasMore: true });
    const firstResponse = await read("/merchant-rules?active=true&pageSize=1");
    const firstJson = await firstResponse.json();
    expect({ body: firstJson, status: firstResponse.status }).toMatchObject({ status: 200 });
    const first = merchantRuleListResponseSchema.parse(firstJson);
    expect(first.data.rules.map(({ id }) => id)).toEqual([beta.id]);
    expect(first.meta).toMatchObject({ hasMore: true, query: { active: true, pageSize: 1 } });
    const second = merchantRuleListResponseSchema.parse(
      await (
        await read(`/merchant-rules?active=true&pageSize=1&cursor=${first.meta.nextCursor}`)
      ).json(),
    );
    expect(second.data.rules.map(({ id }) => id)).toEqual([acme.id]);
    expect(second.meta).toMatchObject({ hasMore: false, nextCursor: null });

    currentTime = "2026-07-15T13:02:00.000Z";
    const updateResponse = await write(`/merchant-rules/${acme.id}`, "PATCH", {
      categoryId: "category-new",
      displayMerchant: "Acme Store 42",
      version: 1,
    });
    const updated = merchantRuleMutationResponseSchema.parse(await updateResponse.json());
    expect(updated.data.merchantRule).toMatchObject({
      active: true,
      categoryId: "category-new",
      normalizedMerchant: "acme",
      version: 2,
    });
    expect(updated.meta).toMatchObject({
      conflictingTransactions: 2,
      historicalTransactionsChanged: 0,
      matchingTransactions: 2,
    });

    const stale = await write(`/merchant-rules/${acme.id}`, "PATCH", {
      active: false,
      version: 1,
    });
    expect(stale.status).toBe(409);
    const deactivatedResponse = await write(`/merchant-rules/${acme.id}`, "PATCH", {
      active: false,
      version: 2,
    });
    const deactivated = merchantRuleMutationResponseSchema.parse(await deactivatedResponse.json());
    expect(deactivated.data.merchantRule).toMatchObject({ active: false, version: 3 });
    await expect(
      cloudflareEnv.DB.prepare("SELECT COUNT(*) AS count FROM merchant_rules").first<number>(
        "count",
      ),
    ).resolves.toBe(2);
  });

  it("rejects category, exact-key collision, invalid query/body, and destructive methods", async () => {
    const acme = merchantRuleMutationResponseSchema.parse(
      await (
        await write("/merchant-rules", "POST", {
          categoryId: "category-old",
          displayMerchant: "Acme",
        })
      ).json(),
    ).data.merchantRule;
    await write("/merchant-rules", "POST", {
      categoryId: "category-old",
      displayMerchant: "Beta Market",
    });

    const responses = await Promise.all([
      write(`/merchant-rules/${acme.id}`, "PATCH", {
        categoryId: "category-inactive",
        version: 1,
      }),
      write(`/merchant-rules/${acme.id}`, "PATCH", {
        categoryId: "category-system-unclassified",
        version: 1,
      }),
      write(`/merchant-rules/${acme.id}`, "PATCH", {
        displayMerchant: "Beta Market Store 42",
        version: 1,
      }),
      write(`/merchant-rules/${acme.id}`, "PATCH", { version: 1 }),
      read("/merchant-rules?sort=normalized_merchant"),
      read("/merchant-rule-previews?displayMerchant=%20%20&categoryId=category-new"),
      write(`/merchant-rules/${acme.id}`, "DELETE", {}),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([422, 422, 409, 422, 422, 422, 405]);
  });

  it("sanitizes preview, list, create, and update database failures", async () => {
    const privateDetail = "SQLITE_PRIVATE merchant transaction content";
    const failingEnv = {
      ...workerEnv,
      DB: {
        prepare() {
          throw new Error(privateDetail);
        },
      } as unknown as D1Database,
    };
    const mutation = (path: string, method: "PATCH" | "POST", body: object) =>
      new Request(`https://ledger.example/api/v1${path}`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://ledger.example",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": csrfToken,
        },
        method,
      });
    const responses = await Promise.all([
      worker.fetch(
        new Request(
          "https://ledger.example/api/v1/merchant-rule-previews?displayMerchant=Acme&categoryId=category-new",
        ),
        failingEnv,
      ),
      worker.fetch(
        new Request("https://ledger.example/api/v1/merchant-rules?pageSize=1"),
        failingEnv,
      ),
      worker.fetch(
        mutation("/merchant-rules", "POST", {
          categoryId: "category-new",
          displayMerchant: "Acme",
        }),
        failingEnv,
      ),
      worker.fetch(
        mutation("/merchant-rules/merchant-rule-acme", "PATCH", {
          active: false,
          version: 1,
        }),
        failingEnv,
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([500, 500, 500, 500]);
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(privateDetail);
      expect(JSON.parse(text)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    }
  });
});
