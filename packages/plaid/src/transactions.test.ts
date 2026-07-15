import { describe, expect, it } from "vitest";

import { parseTransactionSyncResponse } from "./transactions";

const RAW_TRANSACTION = {
  account_id: "plaid-account-1",
  amount: 12.34,
  authorized_date: "2026-07-14",
  date: "2026-07-15",
  iso_currency_code: "CAD",
  merchant_name: "Fixture Merchant",
  name: "Fixture purchase",
  payment_meta: {
    by_order_of: null,
    payee: null,
    payer: null,
    payment_method: null,
    payment_processor: null,
    ppd_id: null,
    reason: null,
    reference_number: null,
  },
  pending: false,
  pending_transaction_id: null,
  transaction_id: "plaid-transaction-1",
};

function rawPage(overrides: Record<string, unknown> = {}) {
  return {
    added: [],
    has_more: false,
    modified: [],
    next_cursor: "cursor-next",
    removed: [],
    request_id: "request-1",
    ...overrides,
  };
}

describe("transactions sync response parsing", () => {
  it("accepts an empty not-ready page and maps absent optional metadata to null", () => {
    const transaction = {
      ...RAW_TRANSACTION,
      authorized_date: null,
      merchant_name: null,
      payment_meta: undefined,
    };

    const result = parseTransactionSyncResponse(
      rawPage({
        added: [transaction],
        next_cursor: "",
        removed: [{ account_id: "plaid-account-1", transaction_id: "removed-transaction" }],
      }),
    );

    expect(result).toMatchObject({
      hasMore: false,
      modified: [],
      nextCursor: "",
      removed: [{ accountId: "plaid-account-1", transactionId: "removed-transaction" }],
    });
    expect(result?.added[0]).toMatchObject({
      authorizedDate: null,
      merchantName: null,
      paymentMetadata: {
        byOrderOf: null,
        payee: null,
        payer: null,
        paymentMethod: null,
        paymentProcessor: null,
        ppdId: null,
        reason: null,
        referenceNumber: null,
      },
    });
  });

  it("preserves supplied empty payment text and ignores non-allowlisted fields", () => {
    const result = parseTransactionSyncResponse(
      rawPage({
        added: [
          {
            ...RAW_TRANSACTION,
            ignored: "private-extra",
            payment_meta: {
              ...RAW_TRANSACTION.payment_meta,
              ignored: "private-extra",
              payer: "",
            },
          },
        ],
      }),
    );

    expect(result?.added[0]?.paymentMetadata.payer).toBe("");
    expect(JSON.stringify(result)).not.toContain("private-extra");
  });

  it.each([
    { name: "non-object response", value: null },
    { name: "non-array changes", value: rawPage({ added: "invalid" }) },
    {
      name: "too many records in one array",
      value: rawPage({ added: Array.from({ length: 501 }, () => RAW_TRANSACTION) }),
    },
    {
      name: "too many combined records",
      value: rawPage({
        added: Array.from({ length: 251 }, () => RAW_TRANSACTION),
        modified: Array.from({ length: 250 }, () => RAW_TRANSACTION),
      }),
    },
    { name: "non-string cursor", value: rawPage({ next_cursor: 42 }) },
    { name: "oversized cursor", value: rawPage({ next_cursor: "x".repeat(257) }) },
    { name: "empty paginated cursor", value: rawPage({ has_more: true, next_cursor: "" }) },
    { name: "non-boolean has-more", value: rawPage({ has_more: "yes" }) },
    { name: "missing request id", value: rawPage({ request_id: "" }) },
    {
      name: "malformed removed record",
      value: rawPage({ removed: [{ account_id: "", transaction_id: "removed" }] }),
    },
  ])("rejects $name", ({ value }) => {
    expect(parseTransactionSyncResponse(value)).toBeUndefined();
  });

  it.each([
    { account_id: "" },
    { amount: Number.POSITIVE_INFINITY },
    { amount: 90_000_000_000_001 },
    { amount: "12.34" },
    { authorized_date: "2026-02-30" },
    { date: "2026-02-30" },
    { iso_currency_code: "cad" },
    { merchant_name: 42 },
    { name: "" },
    { payment_meta: [] },
    { payment_meta: { payer: 42 } },
    { pending: "false" },
    { pending_transaction_id: 42 },
    { transaction_id: "" },
  ])("rejects a malformed transaction %#", (override) => {
    expect(
      parseTransactionSyncResponse(rawPage({ added: [{ ...RAW_TRANSACTION, ...override }] })),
    ).toBeUndefined();
  });
});
