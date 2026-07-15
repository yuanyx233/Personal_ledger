import * as z from "zod";

const identifierSchema = z.string().min(1).max(160);
const webhookSegmentSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);
const webhookEventInputSchema = z.strictObject({
  eventHash: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/),
  eventId: identifierSchema,
  itemId: identifierSchema,
  receivedAt: z.iso.datetime({ offset: true }),
  webhookCode: webhookSegmentSchema,
  webhookType: webhookSegmentSchema,
});

export type WebhookEventRecordResult = "DUPLICATE" | "INSERTED" | "UNKNOWN_ITEM";
export type WebhookEventPersistenceErrorCode = "DATABASE_UNAVAILABLE" | "INVALID_EVENT";

export class WebhookEventPersistenceError extends Error {
  constructor(readonly code: WebhookEventPersistenceErrorCode) {
    super(code);
    this.name = "WebhookEventPersistenceError";
  }
}

export class WebhookEventRepository {
  constructor(private readonly database: D1Database) {}

  async record(input: unknown): Promise<WebhookEventRecordResult> {
    const parsed = webhookEventInputSchema.safeParse(input);
    if (!parsed.success) throw new WebhookEventPersistenceError("INVALID_EVENT");
    const event = parsed.data;

    try {
      const connectionId = await this.database
        .prepare("SELECT id FROM connections WHERE plaid_item_id = ?")
        .bind(event.itemId)
        .first<string>("id");
      if (!connectionId) return "UNKNOWN_ITEM";

      const minimalPayload = JSON.stringify({
        itemId: event.itemId,
        webhookCode: event.webhookCode,
        webhookType: event.webhookType,
      });
      const result = await this.database
        .prepare(
          `INSERT INTO sync_events (
            id, event_hash, connection_id, event_type, minimal_payload_json,
            status, received_at
          ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
          ON CONFLICT(event_hash) DO NOTHING`,
        )
        .bind(
          event.eventId,
          event.eventHash,
          connectionId,
          `${event.webhookType}.${event.webhookCode}`,
          minimalPayload,
          event.receivedAt,
        )
        .run();
      return result.meta.changes === 1 ? "INSERTED" : "DUPLICATE";
    } catch {
      throw new WebhookEventPersistenceError("DATABASE_UNAVAILABLE");
    }
  }
}
