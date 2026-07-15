import { describe, expect, it } from "vitest";

import { createStructuredLogger } from "./logging";

const SENSITIVE_VALUES = {
  accessToken: "access-sandbox-super-secret",
  accountMask: "9876543210123456",
  csvRow: '=HYPERLINK("https://evil.example","click"),123.45',
  merchantName: "Private Health Merchant",
  webhookBody: '{"item_id":"item-private","new_transactions":42}',
};

describe("allowlisted structured logging", () => {
  it("emits stable structured fields with an injected timestamp", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      sink: (line) => lines.push(line),
    });

    expect(
      logger.write({
        connectionId: "connection-1",
        durationMs: 42,
        errorCode: "UPSTREAM_UNAVAILABLE",
        event: "SYNC_RUN",
        level: "ERROR",
        outcome: "FAILED",
        requestId: "request-1",
        status: 503,
      }),
    ).toBe(true);
    expect(lines).toEqual([
      JSON.stringify({
        connectionId: "connection-1",
        durationMs: 42,
        errorCode: "UPSTREAM_UNAVAILABLE",
        event: "SYNC_RUN",
        level: "ERROR",
        outcome: "FAILED",
        requestId: "request-1",
        status: 503,
        timestamp: "2026-07-15T12:00:00.000Z",
      }),
    ]);
  });

  it("drops token, account, merchant, CSV, webhook, message, and error fields", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      sink: (line) => lines.push(line),
    });

    expect(
      logger.write({
        ...SENSITIVE_VALUES,
        error: new Error(Object.values(SENSITIVE_VALUES).join(" | ")),
        event: "PLAID_WEBHOOK",
        level: "WARN",
        message: Object.values(SENSITIVE_VALUES).join(" | "),
        outcome: "DENIED",
        requestId: "request-2",
        status: 403,
      }),
    ).toBe(true);

    const output = lines.join("\n");
    for (const sensitiveValue of Object.values(SENSITIVE_VALUES)) {
      expect(output).not.toContain(sensitiveValue);
    }
    expect(output).not.toContain("message");
    expect(output).not.toContain("error");
    expect(JSON.parse(output)).toEqual({
      event: "PLAID_WEBHOOK",
      level: "WARN",
      outcome: "DENIED",
      requestId: "request-2",
      status: 403,
      timestamp: "2026-07-15T12:00:00.000Z",
    });
  });

  it("rejects sensitive values smuggled through allowlisted fields without throwing", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({ sink: (line) => lines.push(line) });

    for (const sensitiveValue of Object.values(SENSITIVE_VALUES)) {
      expect(
        logger.write({
          accountId: sensitiveValue,
          event: "API_REQUEST",
          level: "INFO",
          outcome: "SUCCESS",
        }),
      ).toBe(false);
    }
    expect(lines).toEqual([]);
  });

  it("contains sink and clock failures without serializing input", () => {
    const logger = createStructuredLogger({
      now: () => {
        throw new Error(SENSITIVE_VALUES.accessToken);
      },
      sink: () => {
        throw new Error(SENSITIVE_VALUES.webhookBody);
      },
    });

    expect(logger.write({ event: "API_REQUEST", level: "INFO", outcome: "SUCCESS" })).toBe(false);
  });
});
