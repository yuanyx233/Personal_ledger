import * as z from "zod";

export const APP_WORKER_SECRET_NAMES = [
  "ACCESS_AUD",
  "ACCESS_TEAM_DOMAIN",
  "CSRF_HMAC_KEY",
  "OWNER_EMAIL",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_TOKEN_ENCRYPTION_KEY",
] as const;

export const SYNC_WORKER_SECRET_NAMES = [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_TOKEN_ENCRYPTION_KEY",
] as const;

const filledSecretSchema = z
  .string()
  .min(8)
  .refine((value) => !value.startsWith("REPLACE_ME_"), "Secret placeholder must be replaced");

const encryptionKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "Expected a base64-encoded 32-byte key")
  .refine((value) => !value.startsWith("REPLACE_ME_"), "Secret placeholder must be replaced");

const plaidInstitutionIdSchema = z.string().regex(/^ins_[A-Za-z0-9]+$/);
const boundedIntegerString = (minimum: number, maximum: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.int().min(minimum).max(maximum));

const sharedWorkerEnvShape = {
  APP_TIMEZONE: z.literal("America/Toronto"),
  PLAID_CLIENT_ID: filledSecretSchema,
  PLAID_ENV: z.enum(["sandbox", "production"]),
  PLAID_SECRET: filledSecretSchema,
  PLAID_TOKEN_ENCRYPTION_KEY: encryptionKeySchema,
};

export const publicClientEnvSchema = z.strictObject({
  VITE_API_BASE_PATH: z.literal("/api/v1"),
  VITE_APP_TIMEZONE: z.literal("America/Toronto"),
});

export const appWorkerEnvSchema = z.object({
  ...sharedWorkerEnvShape,
  ACCESS_AUD: filledSecretSchema,
  ACCESS_TEAM_DOMAIN: z
    .string()
    .regex(
      /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i,
      "Expected the HTTPS Cloudflare Access team domain",
    ),
  CSRF_HMAC_KEY: encryptionKeySchema,
  OWNER_EMAIL: z.email(),
  PLAID_BMO_INSTITUTION_ID: plaidInstitutionIdSchema,
  PLAID_LINK_CUSTOMIZATION_NAME: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  PLAID_RBC_INSTITUTION_ID: plaidInstitutionIdSchema,
  PLAID_WEBHOOK_URL: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/webhooks/plaid" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "Expected the public HTTPS Plaid webhook URL"),
});

export const syncWorkerEnvSchema = z
  .object({
    ...sharedWorkerEnvShape,
    SCHEDULED_SYNC_MAX_ITEMS: boundedIntegerString(1, 10),
    SCHEDULED_SYNC_MAX_PAGES: boundedIntegerString(1, 20),
    SCHEDULED_SYNC_MAX_RUNTIME_MS: boundedIntegerString(1_000, 120_000),
    SYNC_STALE_AFTER_MINUTES: boundedIntegerString(60, 1_440),
  })
  .refine((config) => config.SCHEDULED_SYNC_MAX_ITEMS * config.SCHEDULED_SYNC_MAX_PAGES <= 40, {
    message: "Scheduled Item and page caps exceed the free-plan subrequest budget",
    path: ["SCHEDULED_SYNC_MAX_PAGES"],
  });

export type AppWorkerEnv = z.infer<typeof appWorkerEnvSchema>;
export type PublicClientEnv = z.infer<typeof publicClientEnvSchema>;
export type SyncWorkerEnv = z.infer<typeof syncWorkerEnvSchema>;
