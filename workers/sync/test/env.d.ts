declare namespace Cloudflare {
  interface Env {
    APP_TIMEZONE: "America/Toronto";
    DB: D1Database;
    PLAID_CLIENT_ID: string;
    PLAID_ENV: "sandbox";
    PLAID_SECRET: string;
    PLAID_TOKEN_ENCRYPTION_KEY: string;
    SCHEDULED_SYNC_MAX_ITEMS: string;
    SCHEDULED_SYNC_MAX_PAGES: string;
    SCHEDULED_SYNC_MAX_RUNTIME_MS: string;
    SYNC_STALE_AFTER_MINUTES: string;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
    WEBHOOK_RATE_LIMITER: RateLimit;
  }

  interface Exports {
    default: Fetcher;
  }
}
