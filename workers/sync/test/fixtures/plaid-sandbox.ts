export const SANDBOX_PENDING_SYNC_PAGE = {
  added: [
    {
      account_id: "plaid-account-1",
      amount: 18.75,
      authorized_date: "2026-07-14",
      date: "2026-07-15",
      iso_currency_code: "CAD",
      merchant_name: "Sandbox Coffee",
      name: "Sandbox pending purchase",
      payment_meta: {},
      pending: true,
      pending_transaction_id: null,
      transaction_id: "sandbox-pending-1",
    },
  ],
  has_more: false,
  modified: [],
  next_cursor: "sandbox-cursor-pending",
  removed: [],
  request_id: "sandbox-request-pending",
} as const;

export const SANDBOX_POSTED_SYNC_PAGE = {
  added: [
    {
      account_id: "plaid-account-1",
      amount: 18.75,
      authorized_date: "2026-07-14",
      date: "2026-07-16",
      iso_currency_code: "CAD",
      merchant_name: "Sandbox Coffee",
      name: "Sandbox posted purchase",
      payment_meta: {},
      pending: false,
      pending_transaction_id: "sandbox-pending-1",
      transaction_id: "sandbox-posted-1",
    },
  ],
  has_more: false,
  modified: [],
  next_cursor: "sandbox-cursor-posted",
  removed: [{ account_id: "plaid-account-1", transaction_id: "sandbox-pending-1" }],
  request_id: "sandbox-request-posted",
} as const;

export const SANDBOX_CATCH_UP_SYNC_PAGE = {
  added: [],
  has_more: false,
  modified: [],
  next_cursor: "sandbox-cursor-catch-up",
  removed: [],
  request_id: "sandbox-request-catch-up",
} as const;

export const SANDBOX_ITEM_LOGIN_REQUIRED = {
  display_message: null,
  error_code: "ITEM_LOGIN_REQUIRED",
  error_message: "sandbox login reset requires update mode",
  error_type: "ITEM_ERROR",
  request_id: "sandbox-request-login-required",
} as const;

export function sandboxTransactionsWebhook(webhookCode: string): string {
  return JSON.stringify({
    item_id: "plaid-item-1",
    webhook_code: webhookCode,
    webhook_type: "TRANSACTIONS",
  });
}
