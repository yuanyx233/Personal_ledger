import { describe, expect, it } from "vitest";

import { CategoryRepository } from "./categories";

const NOW = "2026-07-16T00:00:00.000Z";
const OWNER_CATEGORY_ROW = {
  active: 1,
  created_at: NOW,
  editable: 1,
  id: "category-owner-1",
  kind: "EXPENSE",
  name: "Restaurant",
  system_key: null,
  updated_at: NOW,
  version: 1,
} as const;

describe("category taxonomy repository", () => {
  it("previews an active exact merchant rule without executing any write", async () => {
    const queries: Array<{ bindings: unknown[]; sql: string }> = [];
    const database = {
      prepare(sql: string) {
        const query = { bindings: [] as unknown[], sql };
        queries.push(query);
        const statement = {
          bind(...bindings: unknown[]) {
            query.bindings = bindings;
            return statement;
          },
          first: () => Promise.resolve(OWNER_CATEGORY_ROW),
        };
        return statement;
      },
    } as unknown as D1Database;

    await expect(
      new CategoryRepository(database).previewMerchant({
        description: " Restaurant ",
        preferredCategoryId: null,
      }),
    ).resolves.toEqual({
      category: {
        active: true,
        createdAt: NOW,
        editable: true,
        id: "category-owner-1",
        kind: "EXPENSE",
        name: "Restaurant",
        systemKey: null,
        updatedAt: NOW,
        version: 1,
      },
      kind: "KNOWN_MERCHANT",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.bindings).toEqual(["restaurant"]);
    expect(queries[0]!.sql).toContain("merchant_rules");
    expect(queries[0]!.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);
  });

  it("previews one preferred category for a new merchant without writing", async () => {
    const queries: Array<{ bindings: unknown[]; sql: string }> = [];
    const firstResults: unknown[] = [
      null,
      { ...OWNER_CATEGORY_ROW, id: "category-expense-shopping", name: "Shopping" },
    ];
    const database = {
      prepare(sql: string) {
        const query = { bindings: [] as unknown[], sql };
        queries.push(query);
        const statement = {
          bind(...bindings: unknown[]) {
            query.bindings = bindings;
            return statement;
          },
          first: () => Promise.resolve(firstResults.shift() ?? null),
        };
        return statement;
      },
    } as unknown as D1Database;

    await expect(
      new CategoryRepository(database).previewMerchant({
        description: "IKEA",
        preferredCategoryId: "category-expense-shopping",
      }),
    ).resolves.toMatchObject({
      category: { id: "category-expense-shopping", name: "Shopping" },
      kind: "NEW_MERCHANT",
    });
    expect(queries).toHaveLength(2);
    expect(queries[1]!.bindings).toEqual([
      "ikea",
      "category-expense-shopping",
      "category-expense-shopping",
    ]);
    expect(queries[1]!.sql).toContain("categorization_source IN ('MANUAL', 'RULE')");
    expect(queries[1]!.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);
  });

  it("can ignore an exact rule for a merchant that must be confirmed every time", async () => {
    const queries: Array<{ bindings: unknown[]; sql: string }> = [];
    const database = {
      prepare(sql: string) {
        const query = { bindings: [] as unknown[], sql };
        queries.push(query);
        const statement = {
          bind(...bindings: unknown[]) {
            query.bindings = bindings;
            return statement;
          },
          first: () =>
            Promise.resolve({
              ...OWNER_CATEGORY_ROW,
              id: "category-expense-shopping",
              name: "Shopping",
            }),
        };
        return statement;
      },
    } as unknown as D1Database;

    await expect(
      new CategoryRepository(database).previewMerchant({
        description: "Amazon",
        ignoreExactRule: true,
        preferredCategoryId: "category-expense-shopping",
      }),
    ).resolves.toMatchObject({
      category: { id: "category-expense-shopping", name: "Shopping" },
      kind: "NEW_MERCHANT",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.bindings).toEqual([
      "amazon",
      "category-expense-shopping",
      "category-expense-shopping",
    ]);
    expect(queries[0]!.sql).not.toContain("merchant_rules");
  });

  it("returns a stable complete read model from one prepared statement", async () => {
    const queries: string[] = [];
    const database = {
      prepare(sql: string) {
        queries.push(sql);
        return {
          all: () =>
            Promise.resolve({
              results: [
                {
                  active: 1,
                  created_at: "2026-07-16T00:00:00.000Z",
                  editable: 0,
                  id: "category-system-transfer",
                  kind: "TRANSFER",
                  name: "Transfer",
                  system_key: "TRANSFER",
                  updated_at: "2026-07-16T00:00:00.000Z",
                  version: 1,
                },
              ],
            }),
        };
      },
    } as unknown as D1Database;

    await expect(new CategoryRepository(database).list()).resolves.toEqual([
      {
        active: true,
        createdAt: "2026-07-16T00:00:00.000Z",
        editable: false,
        id: "category-system-transfer",
        kind: "TRANSFER",
        name: "Transfer",
        systemKey: "TRANSFER",
        updatedAt: "2026-07-16T00:00:00.000Z",
        version: 1,
      },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("ORDER BY kind ASC, name ASC, id ASC");
    expect(queries[0]).not.toContain("WHERE active = 1");
  });

  it("creates one normalized expense category and reports a normalized-name conflict", async () => {
    const queries: Array<{ bindings: unknown[]; sql: string }> = [];
    const results: unknown[] = [
      null,
      {
        active: 1,
        created_at: "2026-07-16T00:00:00.000Z",
        editable: 1,
        id: "category-owner-1",
        kind: "EXPENSE",
        name: "Restaurant",
        system_key: null,
        updated_at: "2026-07-16T00:00:00.000Z",
        version: 1,
      },
    ];
    const database = {
      prepare(sql: string) {
        const query = { bindings: [] as unknown[], sql };
        queries.push(query);
        const statement = {
          bind(...bindings: unknown[]) {
            query.bindings = bindings;
            return statement;
          },
          first: () => Promise.resolve(results.shift() ?? null),
        };
        return statement;
      },
    } as unknown as D1Database;
    const repository = new CategoryRepository(database, { createId: () => "category-owner-1" });

    await expect(
      repository.createExpense({ name: "  Restaurant  ", now: "2026-07-16T00:00:00.000Z" }),
    ).resolves.toMatchObject({ kind: "CREATED", category: { id: "category-owner-1" } });
    expect(queries[0]!.bindings).toEqual(["restaurant"]);
    expect(queries[1]!.sql).toContain("normalized_name");
    expect(queries[1]!.bindings).toContain("Restaurant");

    const conflictResults: unknown[] = [
      {
        active: 1,
        created_at: "2026-07-16T00:00:00.000Z",
        editable: 1,
        id: "category-owner-1",
        kind: "EXPENSE",
        name: "Restaurant",
        system_key: null,
        updated_at: "2026-07-16T00:00:00.000Z",
        version: 1,
      },
    ];
    const conflictDatabase = {
      prepare() {
        const statement = {
          bind() {
            return statement;
          },
          first: () => Promise.resolve(conflictResults.shift() ?? null),
        };
        return statement;
      },
    } as unknown as D1Database;
    await expect(
      new CategoryRepository(conflictDatabase).createExpense({
        name: "restaurant",
        now: "2026-07-16T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ kind: "NAME_CONFLICT", category: { id: "category-owner-1" } });
  });

  it("returns the winning category when normalized-name creation loses a database race", async () => {
    const constraintFailure = new Error("unique normalized_name");
    const outcomes: unknown[] = [null, constraintFailure, OWNER_CATEGORY_ROW];
    const database = {
      prepare() {
        const statement = {
          bind() {
            return statement;
          },
          first() {
            const outcome = outcomes.shift() ?? null;
            return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await expect(
      new CategoryRepository(database).createExpense({ name: " restaurant ", now: NOW }),
    ).resolves.toEqual({
      category: {
        active: true,
        createdAt: NOW,
        editable: true,
        id: "category-owner-1",
        kind: "EXPENSE",
        name: "Restaurant",
        systemKey: null,
        updatedAt: NOW,
        version: 1,
      },
      kind: "NAME_CONFLICT",
    });
  });

  it("preserves an unexplained insert failure when no concurrent category exists", async () => {
    const insertFailure = new Error("database unavailable");
    const outcomes: unknown[] = [null, insertFailure, null];
    const database = {
      prepare() {
        const statement = {
          bind() {
            return statement;
          },
          first() {
            const outcome = outcomes.shift() ?? null;
            return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await expect(
      new CategoryRepository(database).createExpense({ name: "Restaurant", now: NOW }),
    ).rejects.toBe(insertFailure);
  });

  it("rejects unsafe category creation input before accessing the database", async () => {
    let prepareCalls = 0;
    const database = {
      prepare() {
        prepareCalls += 1;
        throw new Error("database must not be reached");
      },
    } as unknown as D1Database;
    const repository = new CategoryRepository(database);
    const invalidInputs = [
      { name: "   ", now: NOW },
      { name: "Dining <script>", now: NOW },
      { name: "Dining\u0000", now: NOW },
      { name: "x".repeat(161), now: NOW },
      { name: "Dining", now: "not-a-date" },
      { extra: true, name: "Dining", now: NOW },
    ];

    for (const input of invalidInputs) {
      await expect(repository.createExpense(input)).rejects.toBeDefined();
    }
    expect(prepareCalls).toBe(0);
  });
});
