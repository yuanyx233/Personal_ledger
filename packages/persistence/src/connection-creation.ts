import { idempotencyKeySchema } from "@ledger/domain/api-contracts";
import type { EncryptedPlaidAccessToken } from "@ledger/domain/token-crypto";
import * as z from "zod";

import type { AccountRecord, ConnectionRecord } from "./repositories";

const identifierSchema = z.string().min(1).max(160);
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const instantSchema = z.iso.datetime({ offset: true });

const reservationSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  now: instantSchema,
  requestFingerprint: fingerprintSchema,
});

const accountCreationSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  displayName: z.string().min(1).max(256),
  id: identifierSchema,
  mask: z.string().max(32).nullable(),
  plaidAccountId: identifierSchema,
  subtype: z.enum(["CHECKING", "CREDIT_CARD"]),
  type: z.enum(["DEPOSITORY", "CREDIT"]),
});

const encryptedTokenSchema = z.strictObject({
  ciphertext: z.instanceof(Uint8Array).refine((value) => value.byteLength > 16),
  iv: z.instanceof(Uint8Array).refine((value) => value.byteLength === 12),
  keyVersion: z.int().positive(),
});

const completionSchema = z.strictObject({
  accounts: z.array(accountCreationSchema).min(1).max(32),
  connectionId: identifierSchema,
  encryptedAccessToken: encryptedTokenSchema,
  idempotencyKey: idempotencyKeySchema,
  institutionId: identifierSchema,
  institutionName: z.string().min(1).max(256),
  now: instantSchema,
  plaidItemId: identifierSchema,
  requestFingerprint: fingerprintSchema,
});

export type ConnectionReservation =
  | { kind: "STARTED" }
  | { kind: "CONFLICT" }
  | { connection: CreatedConnectionRecord; kind: "REPLAY" };

export interface CreatedConnectionRecord {
  accounts: AccountRecord[];
  connection: ConnectionRecord;
}

export type ConnectionCompletionInput = z.input<typeof completionSchema> & {
  encryptedAccessToken: EncryptedPlaidAccessToken;
};

interface ConnectionRow {
  consent_expires_at: string | null;
  id: string;
  institution_id: string;
  institution_name: string;
  last_error_code: string | null;
  last_success_at: string | null;
  plaid_item_id: string;
  status: ConnectionRecord["status"];
  sync_cursor: string | null;
  version: number;
}

interface AccountRow {
  connection_id: string;
  currency: string;
  display_name: string;
  enabled: number;
  id: string;
  mask: string | null;
  plaid_account_id: string;
  subtype: AccountRecord["subtype"];
  type: AccountRecord["type"];
  version: number;
}

function toConnectionRecord(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    consentExpiresAt: row.consent_expires_at,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    lastErrorCode: row.last_error_code,
    lastSuccessAt: row.last_success_at,
    plaidItemId: row.plaid_item_id,
    status: row.status,
    syncCursor: row.sync_cursor,
    version: row.version,
  };
}

function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    connectionId: row.connection_id,
    currency: row.currency,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    id: row.id,
    mask: row.mask,
    plaidAccountId: row.plaid_account_id,
    subtype: row.subtype,
    type: row.type,
    version: row.version,
  };
}

function copyBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

export class ConnectionCreationRepository {
  constructor(private readonly database: D1Database) {}

  async reserve(input: unknown): Promise<ConnectionReservation> {
    const reservation = reservationSchema.parse(input);
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO connection_requests (
          idempotency_key, request_fingerprint, status, created_at, updated_at
        ) VALUES (?, ?, 'PENDING', ?, ?)`,
      )
      .bind(
        reservation.idempotencyKey,
        reservation.requestFingerprint,
        reservation.now,
        reservation.now,
      )
      .run();
    if (result.meta.changes === 1) return { kind: "STARTED" };

    const existing = await this.database
      .prepare(
        `SELECT request_fingerprint
         FROM connection_requests WHERE idempotency_key = ?`,
      )
      .bind(reservation.idempotencyKey)
      .first<{ request_fingerprint: string }>();
    if (!existing || existing.request_fingerprint !== reservation.requestFingerprint) {
      return { kind: "CONFLICT" };
    }

    const connection = await this.findByCreationKey(reservation.idempotencyKey);
    return connection ? { connection, kind: "REPLAY" } : { kind: "CONFLICT" };
  }

  async complete(input: ConnectionCompletionInput): Promise<CreatedConnectionRecord> {
    const completion = completionSchema.parse(input);
    const statements = [
      this.database
        .prepare(
          `INSERT INTO connections (
            id, institution_id, institution_name, plaid_item_id,
            access_token_ciphertext, access_token_iv, token_key_version,
            status, created_at, updated_at, version, creation_idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'HEALTHY', ?, ?, 1, ?)`,
        )
        .bind(
          completion.connectionId,
          completion.institutionId,
          completion.institutionName,
          completion.plaidItemId,
          copyBuffer(completion.encryptedAccessToken.ciphertext),
          copyBuffer(completion.encryptedAccessToken.iv),
          completion.encryptedAccessToken.keyVersion,
          completion.now,
          completion.now,
          completion.idempotencyKey,
        ),
      ...completion.accounts.map((account) =>
        this.database
          .prepare(
            `INSERT INTO accounts (
              id, connection_id, plaid_account_id, display_name, mask,
              type, subtype, currency, enabled, created_at, updated_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
          )
          .bind(
            account.id,
            completion.connectionId,
            account.plaidAccountId,
            account.displayName,
            account.mask,
            account.type,
            account.subtype,
            account.currency,
            completion.now,
            completion.now,
          ),
      ),
      this.database
        .prepare(
          `UPDATE connection_requests SET status = 'COMPLETED', updated_at = ?
           WHERE idempotency_key = ? AND request_fingerprint = ? AND status = 'PENDING'`,
        )
        .bind(completion.now, completion.idempotencyKey, completion.requestFingerprint),
    ];
    await this.database.batch(statements);

    return {
      accounts: completion.accounts.map((account) => ({
        ...account,
        connectionId: completion.connectionId,
        enabled: true,
        version: 1,
      })),
      connection: {
        consentExpiresAt: null,
        id: completion.connectionId,
        institutionId: completion.institutionId,
        institutionName: completion.institutionName,
        lastErrorCode: null,
        lastSuccessAt: null,
        plaidItemId: completion.plaidItemId,
        status: "HEALTHY",
        syncCursor: null,
        version: 1,
      },
    };
  }

  async markFailed(input: unknown): Promise<void> {
    const reservation = reservationSchema.parse(input);
    await this.database
      .prepare(
        `UPDATE connection_requests SET status = 'FAILED', updated_at = ?
         WHERE idempotency_key = ? AND request_fingerprint = ? AND status = 'PENDING'`,
      )
      .bind(reservation.now, reservation.idempotencyKey, reservation.requestFingerprint)
      .run();
  }

  private async findByCreationKey(idempotencyKey: string): Promise<CreatedConnectionRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT id, institution_id, institution_name, plaid_item_id, status,
                sync_cursor, last_success_at, last_error_code, consent_expires_at, version
         FROM connections WHERE creation_idempotency_key = ?`,
      )
      .bind(idempotencyKey)
      .first<ConnectionRow>();
    if (!row) return null;

    const accounts = await this.database
      .prepare(
        `SELECT id, connection_id, plaid_account_id, display_name, mask, type,
                subtype, currency, enabled, version
         FROM accounts WHERE connection_id = ? ORDER BY id`,
      )
      .bind(row.id)
      .all<AccountRow>();
    return {
      accounts: accounts.results.map(toAccountRecord),
      connection: toConnectionRecord(row),
    };
  }
}
