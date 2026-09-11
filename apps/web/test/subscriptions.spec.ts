import { fullJsonExportSchema, subscriptionsResponseSchema } from "@ledger/domain";
import { SubscriptionRepository } from "@ledger/persistence";
import { applyD1Migrations, env as cloudflareEnv } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createAppWorker, type AppEnv } from "../worker/index";
import { issueCsrfToken } from "../worker/security/csrf";

const identity = {
  email: "owner@example.invalid",
  sessionBinding: "subscription-test",
  subject: "owner",
};
const key = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
let clock = new Date("2026-09-15T12:00:00.000Z");
const worker = createAppWorker(
  () => Promise.resolve(identity),
  undefined,
  () => clock,
);
const env = {
  API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
  APP_TIMEZONE: "America/Toronto",
  CSRF_HMAC_KEY: key,
  DB: cloudflareEnv.DB,
} as unknown as AppEnv;
const repo = new SubscriptionRepository(cloudflareEnv.DB);
const fields = {
  name: "Music",
  accountLabel: "RBC Credit",
  amountMinor: 1299,
  currency: "CAD",
  categoryId: "category-expense-food",
  nextChargeDate: "2026-06-10",
};

beforeAll(() => applyD1Migrations(cloudflareEnv.DB, cloudflareEnv.TEST_MIGRATIONS));
beforeEach(async () => {
  clock = new Date("2026-09-15T12:00:00.000Z");
  await cloudflareEnv.DB.batch([
    cloudflareEnv.DB.prepare("DELETE FROM subscription_occurrences"),
    cloudflareEnv.DB.prepare("DELETE FROM subscriptions"),
    cloudflareEnv.DB.prepare("DELETE FROM transactions"),
  ]);
});
async function request(path = "", method = "GET", body?: unknown) {
  return worker.fetch(
    new Request(`https://ledger.example/api/v1/subscriptions${path}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ledger.example",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": await issueCsrfToken(identity, key),
      },
    }),
    env,
  );
}
async function read() {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  return subscriptionsResponseSchema.parse(await response.json()).data;
}
async function create(extra = {}) {
  const input = { ...fields, requestId: crypto.randomUUID(), ...extra };
  const response = await request("", "POST", input);
  expect(response.status).toBe(201);
  return {
    input,
    plan: (await read()).subscriptions.find(({ id }) => id.endsWith(input.requestId))!,
  };
}

it("records monthly expenses once, removes the inclusive cancellation range, resumes without restoring the gap", async () => {
  const { input, plan } = await create();
  expect((await request("", "POST", input)).status).toBe(201);
  await repo.generateDue(clock.toISOString());
  expect((await read()).charges).toHaveLength(4);
  expect((await read()).subscriptions).toHaveLength(1);
  const unrelated = await create({ name: "Other", nextChargeDate: "2026-08-10" });
  const response = await request(`/${plan.id}`, "PATCH", {
    action: "CANCEL",
    version: plan.version,
    effectiveDate: "2026-07-10",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { removedCount: 3 } });
  const cancelled = (await read()).subscriptions.find(({ id }) => id === plan.id)!;
  expect(cancelled).toMatchObject({ status: "CANCELLED", cancellationEffectiveDate: "2026-07-10" });
  const history = (await read()).charges.filter(({ subscriptionId }) => subscriptionId === plan.id);
  expect(history.find(({ scheduledDate }) => scheduledDate === "2026-06-10")?.status).toBe(
    "GENERATED",
  );
  expect(history.filter(({ status }) => status === "NOT_CHARGED")).toHaveLength(3);
  expect(
    (await read()).charges.filter(
      ({ subscriptionId, status }) =>
        subscriptionId === unrelated.plan.id && status === "GENERATED",
    ),
  ).toHaveLength(2);
  expect(
    (
      await request(`/${plan.id}`, "PATCH", {
        action: "RESUME",
        version: cancelled.version,
        nextChargeDate: "2026-09-10",
      })
    ).status,
  ).toBe(200);
  await repo.generateDue(clock.toISOString());
  const resumed = (await read()).charges.filter(({ subscriptionId }) => subscriptionId === plan.id);
  expect(resumed).toHaveLength(4);
  expect(
    resumed
      .filter(({ status }) => status === "GENERATED")
      .map(({ scheduledDate }) => scheduledDate),
  ).toEqual(["2026-09-10", "2026-06-10"]);
  const posted = await env.DB.prepare(
    "SELECT COUNT(*) AS count, SUM(amount_minor) AS total FROM transactions WHERE status = 'POSTED'",
  ).first();
  expect(posted).toEqual({ count: 4, total: 1299 * 4 });
  const backup = await worker.fetch(
    new Request("https://ledger.example/api/v1/exports/data.json"),
    env,
  );
  expect(backup.status).toBe(200);
  expect(fullJsonExportSchema.parse(await backup.json()).data.subscriptions).toHaveLength(2);
});

it("handles future cancellation, month ends, and edits without changing old expenses", async () => {
  clock = new Date("2026-01-31T12:00:00Z");
  const { plan } = await create({ nextChargeDate: "2026-01-31" });
  expect(plan.nextChargeDate).toBe("2026-02-28");
  expect(
    (
      await request(`/${plan.id}`, "PATCH", {
        ...fields,
        action: "EDIT",
        version: plan.version,
        amountMinor: 1599,
        nextChargeDate: plan.nextChargeDate,
      })
    ).status,
  ).toBe(200);
  const edited = (await read()).subscriptions[0]!;
  expect(edited.anchorDay).toBe(31);
  expect(
    (
      await request(`/${plan.id}`, "PATCH", {
        action: "CANCEL",
        version: edited.version,
        effectiveDate: "2026-03-31",
      })
    ).status,
  ).toBe(200);
  clock = new Date("2026-04-01T12:00:00Z");
  await repo.generateDue(clock.toISOString());
  expect((await read()).charges).toMatchObject([
    { scheduledDate: "2026-02-28", amountMinor: 1599 },
    { scheduledDate: "2026-01-31", amountMinor: 1299 },
  ]);
  expect((await read()).subscriptions[0]?.status).toBe("CANCELLED");
});

it("guards stale generation and cancellation, races safely and rolls back partial writes", async () => {
  const plan = await repo.create(
    { ...fields, requestId: crypto.randomUUID() },
    clock.toISOString(),
  );
  await Promise.all([
    repo.generateOne(plan, clock.toISOString()),
    repo.generateOne(plan, clock.toISOString()),
  ]);
  expect((await repo.list()).charges).toHaveLength(1);
  await expect(
    repo.mutate(
      plan.id,
      { action: "CANCEL", version: plan.version, effectiveDate: "2026-01-01" },
      clock.toISOString(),
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  const latest = (await repo.find(plan.id))!;
  await repo.mutate(
    plan.id,
    { action: "CANCEL", version: latest.version, effectiveDate: "2026-07-01" },
    clock.toISOString(),
  );
  expect(await repo.generateOne(latest, clock.toISOString())).toBe(false);
  expect((await repo.list()).charges).toHaveLength(1);

  const another = await repo.create(
    { ...fields, requestId: crypto.randomUUID() },
    clock.toISOString(),
  );
  await env.DB.prepare(
    "CREATE TRIGGER fail_occurrence BEFORE INSERT ON subscription_occurrences BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  ).run();
  try {
    await expect(repo.generateOne(another, clock.toISOString())).rejects.toThrow();
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_occurrence").run();
  }
  expect((await repo.find(another.id))?.version).toBe(1);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM transactions").first()).toEqual({
    count: 1,
  });
});

it("validates input and refuses unauthenticated, CSRF-free or stale mutations", async () => {
  expect(
    (await request("", "POST", { ...fields, requestId: crypto.randomUUID(), amountMinor: -1 }))
      .status,
  ).toBe(422);
  expect(
    (
      await request("", "POST", {
        ...fields,
        requestId: crypto.randomUUID(),
        categoryId: "category-system-transfer",
      })
    ).status,
  ).toBe(422);
  expect((await request("?unexpected=true")).status).toBe(422);
  expect((await request("", "HEAD")).status).toBe(405);
  const { plan } = await create();
  expect(
    (
      await request(`/${plan.id}`, "PATCH", {
        action: "CANCEL",
        version: 999,
        effectiveDate: "2026-07-01",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request("/missing", "PATCH", {
        action: "CANCEL",
        version: 1,
        effectiveDate: "2026-07-01",
      })
    ).status,
  ).toBe(404);
  const denied = await worker.fetch(
    new Request("https://ledger.example/api/v1/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://ledger.example" },
      body: "{}",
    }),
    env,
  );
  expect(denied.status).toBe(403);
  const anonymous = createAppWorker(() => Promise.reject(new Error("Denied")));
  expect(
    (await anonymous.fetch(new Request("https://ledger.example/api/v1/subscriptions"), env)).status,
  ).toBe(403);
});
