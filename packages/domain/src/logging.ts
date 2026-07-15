import * as z from "zod";

import { apiErrorCodeSchema } from "./api-contracts";

function internalIdSchema(prefix: string) {
  return z
    .string()
    .min(prefix.length + 1)
    .max(160)
    .regex(new RegExp(`^${prefix}[A-Za-z0-9][A-Za-z0-9_-]*$`));
}

const structuredLogInputSchema = z.object({
  accountId: internalIdSchema("account-").optional(),
  connectionId: internalIdSchema("connection-").optional(),
  durationMs: z.int().nonnegative().max(3_600_000).optional(),
  errorCode: z
    .union([apiErrorCodeSchema, z.enum(["ITEM_LOGIN_REQUIRED", "SYNC_NOT_READY"])])
    .optional(),
  event: z.enum([
    "ACCESS_CHECK",
    "API_REQUEST",
    "CSV_IMPORT",
    "PLAID_TOKEN_CRYPTO",
    "PLAID_WEBHOOK",
    "SYNC_RUN",
  ]),
  importBatchId: internalIdSchema("import-").optional(),
  level: z.enum(["INFO", "WARN", "ERROR"]),
  outcome: z.enum(["STARTED", "SUCCESS", "DENIED", "FAILED"]),
  requestId: internalIdSchema("request-").optional(),
  status: z.int().min(100).max(599).optional(),
  syncRunId: internalIdSchema("sync-run-").optional(),
  transactionId: internalIdSchema("transaction-").optional(),
});

export type StructuredLogInput = z.infer<typeof structuredLogInputSchema>;

export interface StructuredLoggerConfig {
  now?: () => Date;
  sink: (serializedLine: string) => void;
}

export interface StructuredLogger {
  write(input: unknown): boolean;
}

export function createStructuredLogger({
  now = () => new Date(),
  sink,
}: StructuredLoggerConfig): StructuredLogger {
  return {
    write(input) {
      const parsed = structuredLogInputSchema.safeParse(input);
      if (!parsed.success) return false;

      try {
        sink(JSON.stringify({ ...parsed.data, timestamp: now().toISOString() }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
