import * as z from "zod";

import { timeZoneSchema } from "./time-zone";

export const APP_WORKER_SECRET_NAMES = [
  "ACCESS_AUD",
  "ACCESS_TEAM_DOMAIN",
  "CSRF_HMAC_KEY",
  "OWNER_EMAIL",
] as const;

const filledSecretSchema = z
  .string()
  .min(8)
  .refine((value) => !value.startsWith("REPLACE_ME_"), "Secret placeholder must be replaced");
export const publicClientEnvSchema = z.strictObject({
  VITE_API_BASE_PATH: z.literal("/api/v1"),
  VITE_APP_TIMEZONE: timeZoneSchema,
});
export const appWorkerEnvSchema = z.object({
  ACCESS_AUD: filledSecretSchema,
  ACCESS_TEAM_DOMAIN: z.string().regex(/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i),
  APP_TIMEZONE: timeZoneSchema,
  CSRF_HMAC_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  OWNER_EMAIL: z.email(),
});
