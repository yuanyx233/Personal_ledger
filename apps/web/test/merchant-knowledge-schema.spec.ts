import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("merchant knowledge categories", () => {
  it("seeds every stable category referenced by the knowledge base", async () => {
    const result = await env.DB.prepare(
      `SELECT id FROM categories
       WHERE id IN (
         'category-expense-entertainment',
         'category-expense-healthcare',
         'category-expense-travel'
       )
       ORDER BY id`,
    ).all<{ id: string }>();

    expect(result.results.map(({ id }) => id)).toEqual([
      "category-expense-entertainment",
      "category-expense-healthcare",
      "category-expense-travel",
    ]);
    const migration = env.TEST_MIGRATIONS.find(({ name }) =>
      name.includes("0022_merchant_knowledge_categories"),
    );
    expect(migration?.queries.join("\n")).toContain("ON CONFLICT(id) DO NOTHING");
    expect(migration?.queries.join("\n")).not.toContain("INSERT OR IGNORE");
  });

  it("moves an existing IKEA rule from Shopping to Housing", async () => {
    await env.DB.prepare(
      `INSERT INTO merchant_rules (
        id, normalized_merchant, display_merchant, category_id,
        active, created_at, updated_at, version
      ) VALUES (
        'merchant-rule-legacy-ikea', 'ikea', 'IKEA',
        'category-expense-shopping', 1,
        '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 1
      )`,
    ).run();
    const migration = env.TEST_MIGRATIONS.find(({ name }) =>
      name.includes("0022_merchant_knowledge_categories"),
    );
    expect(migration).toBeDefined();
    await env.DB.batch(migration!.queries.map((query) => env.DB.prepare(query)));

    await expect(
      env.DB.prepare(
        "SELECT category_id, version FROM merchant_rules WHERE normalized_merchant = 'ikea'",
      ).first(),
    ).resolves.toEqual({ category_id: "category-expense-housing", version: 2 });
  });
});
