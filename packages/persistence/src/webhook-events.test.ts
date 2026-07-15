import { describe, expect, it } from "vitest";

import { WebhookEventPersistenceError, WebhookEventRepository } from "./webhook-events";

interface RecordedQuery {
  bindings: unknown[];
  sql: string;
}

function recordingDatabase({
  connectionId = "connection-1",
  failFirst = false,
  failRun = false,
  runChanges = 1,
}: {
  connectionId?: string | null;
  failFirst?: boolean;
  failRun?: boolean;
  runChanges?: number;
} = {}) {
  const queries: RecordedQuery[] = [];
  const database = {
    prepare(sql: string) {
      const query: RecordedQuery = { bindings: [], sql };
      queries.push(query);
      const statement = {
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return statement;
        },
        first() {
          return failFirst
            ? Promise.reject(new Error("private read detail"))
            : Promise.resolve(connectionId);
        },
        run() {
          return failRun
            ? Promise.reject(new Error("private write detail"))
            : Promise.resolve({ meta: { changes: runChanges } });
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { database, queries };
}

const EVENT = {
  eventHash: "a".repeat(64),
  eventId: "sync-event-1",
  itemId: "plaid-item-1",
  receivedAt: "2026-07-15T12:00:00.000Z",
  webhookCode: "SYNC_UPDATES_AVAILABLE",
  webhookType: "TRANSACTIONS",
};

describe("WebhookEventRepository", () => {
  it("binds and stores only the reviewed minimal payload", async () => {
    const recording = recordingDatabase();

    await expect(new WebhookEventRepository(recording.database).record(EVENT)).resolves.toBe(
      "INSERTED",
    );

    expect(recording.queries).toHaveLength(2);
    expect(recording.queries[0]?.bindings).toEqual(["plaid-item-1"]);
    expect(recording.queries[1]?.sql).toContain("ON CONFLICT(event_hash) DO NOTHING");
    expect(recording.queries[1]?.sql).not.toContain("plaid-item-1");
    expect(recording.queries[1]?.bindings).toContain(
      JSON.stringify({
        itemId: "plaid-item-1",
        webhookCode: "SYNC_UPDATES_AVAILABLE",
        webhookType: "TRANSACTIONS",
      }),
    );
  });

  it("distinguishes duplicate and unknown Item results", async () => {
    await expect(
      new WebhookEventRepository(recordingDatabase({ runChanges: 0 }).database).record(EVENT),
    ).resolves.toBe("DUPLICATE");

    const unknown = recordingDatabase({ connectionId: null });
    await expect(new WebhookEventRepository(unknown.database).record(EVENT)).resolves.toBe(
      "UNKNOWN_ITEM",
    );
    expect(unknown.queries).toHaveLength(1);
  });

  it("rejects invalid input without preparing SQL", async () => {
    const recording = recordingDatabase();

    await expect(
      new WebhookEventRepository(recording.database).record({ ...EVENT, eventHash: "invalid" }),
    ).rejects.toEqual(new WebhookEventPersistenceError("INVALID_EVENT"));
    expect(recording.queries).toHaveLength(0);
  });

  it.each([{ failFirst: true }, { failRun: true }])(
    "sanitizes database failures %#",
    async (failure) => {
      const repository = new WebhookEventRepository(recordingDatabase(failure).database);
      const operation = repository.record(EVENT);

      await expect(operation).rejects.toEqual(
        new WebhookEventPersistenceError("DATABASE_UNAVAILABLE"),
      );
      await expect(operation).rejects.not.toThrow(/private/);
    },
  );
});
