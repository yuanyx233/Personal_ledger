import { currencyCodeSchema, type ConnectionCreationResponse } from "@ledger/domain/api-contracts";
import { encryptPlaidAccessToken } from "@ledger/domain/token-crypto";
import { ConnectionCreationRepository, type CreatedConnectionRecord } from "@ledger/persistence";
import { PlaidAdapterError, type PlaidAccountSnapshot, type PlaidClient } from "@ledger/plaid";

export type ConnectionCreationServiceErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "NO_SUPPORTED_ACCOUNTS"
  | "UNSUPPORTED_INSTITUTION"
  | "UPSTREAM_UNAVAILABLE";

export class ConnectionCreationServiceError extends Error {
  constructor(readonly code: ConnectionCreationServiceErrorCode) {
    super(code);
    this.name = "ConnectionCreationServiceError";
  }
}

export interface ConnectionCreationConfig {
  bmoInstitutionId: string;
  database: D1Database;
  plaid: PlaidClient;
  rbcInstitutionId: string;
  tokenEncryptionKey: string;
}

export interface ConnectionCreationInput {
  idempotencyKey: string;
  publicToken: string;
}

type ConnectionPayload = ConnectionCreationResponse["data"]["connection"];

export interface ConnectionCreationResult {
  connection: ConnectionPayload;
  replayed: boolean;
}

interface SupportedInstitution {
  code: "RBC" | "BMO";
  id: string;
  name: string;
}

function isIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 160;
}

function allowedInstitutions(config: ConnectionCreationConfig): SupportedInstitution[] {
  if (
    !isIdentifier(config.rbcInstitutionId) ||
    !isIdentifier(config.bmoInstitutionId) ||
    config.rbcInstitutionId === config.bmoInstitutionId
  ) {
    throw new ConnectionCreationServiceError("INTERNAL_ERROR");
  }
  return [
    { code: "RBC", id: config.rbcInstitutionId, name: "Royal Bank of Canada" },
    { code: "BMO", id: config.bmoInstitutionId, name: "Bank of Montreal" },
  ];
}

async function fingerprintPublicToken(publicToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicToken));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function eligibleAccount(account: PlaidAccountSnapshot) {
  const currency = account.isoCurrencyCode;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return undefined;
  if (account.type === "depository" && account.subtype === "checking") {
    return { currency, subtype: "CHECKING" as const, type: "DEPOSITORY" as const };
  }
  if (account.type === "credit" && account.subtype === "credit card") {
    return { currency, subtype: "CREDIT_CARD" as const, type: "CREDIT" as const };
  }
  return undefined;
}

function mapConnection(
  record: CreatedConnectionRecord,
  institution: SupportedInstitution,
): ConnectionPayload {
  return {
    accounts: [...record.accounts]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((account) => ({
        currency: currencyCodeSchema.parse(account.currency),
        displayName: account.displayName,
        enabled: account.enabled,
        id: account.id,
        subtype: account.subtype,
        type: account.type,
      })),
    id: record.connection.id,
    institutionCode: institution.code,
    institutionName: institution.name,
    status: "HEALTHY",
  };
}

function mapFailure(error: unknown): ConnectionCreationServiceError {
  if (error instanceof ConnectionCreationServiceError) return error;
  if (error instanceof PlaidAdapterError && error.code === "UPSTREAM_UNAVAILABLE") {
    return new ConnectionCreationServiceError("UPSTREAM_UNAVAILABLE");
  }
  return new ConnectionCreationServiceError("INTERNAL_ERROR");
}

export function createConnectionCreationService(config: ConnectionCreationConfig) {
  const institutions = allowedInstitutions(config);
  const repository = new ConnectionCreationRepository(config.database);

  return {
    async create(input: ConnectionCreationInput): Promise<ConnectionCreationResult> {
      const now = new Date().toISOString();
      const requestFingerprint = await fingerprintPublicToken(input.publicToken);
      const reservationInput = {
        idempotencyKey: input.idempotencyKey,
        now,
        requestFingerprint,
      };
      const reservation = await repository.reserve(reservationInput);
      if (reservation.kind === "CONFLICT") {
        throw new ConnectionCreationServiceError("IDEMPOTENCY_CONFLICT");
      }
      if (reservation.kind === "REPLAY") {
        const institution = institutions.find(
          (candidate) => candidate.id === reservation.connection.connection.institutionId,
        );
        if (!institution) throw new ConnectionCreationServiceError("INTERNAL_ERROR");
        return {
          connection: mapConnection(reservation.connection, institution),
          replayed: true,
        };
      }

      try {
        const exchanged = await config.plaid.exchangePublicToken(input.publicToken);
        const item = await config.plaid.getItemAccounts(exchanged.accessToken);
        if (item.itemId !== exchanged.itemId) {
          throw new ConnectionCreationServiceError("UPSTREAM_UNAVAILABLE");
        }
        const institution = institutions.find((candidate) => candidate.id === item.institutionId);
        if (!institution) {
          throw new ConnectionCreationServiceError("UNSUPPORTED_INSTITUTION");
        }

        const seenAccountIds = new Set<string>();
        const accounts = item.accounts.flatMap((account) => {
          const eligible = eligibleAccount(account);
          if (!eligible) return [];
          if (seenAccountIds.has(account.id)) {
            throw new ConnectionCreationServiceError("UPSTREAM_UNAVAILABLE");
          }
          seenAccountIds.add(account.id);
          return [
            {
              ...eligible,
              displayName: account.name,
              id: `account-${crypto.randomUUID()}`,
              mask: account.mask,
              plaidAccountId: account.id,
            },
          ];
        });
        if (accounts.length === 0) {
          throw new ConnectionCreationServiceError("NO_SUPPORTED_ACCOUNTS");
        }

        const connectionId = `connection-${crypto.randomUUID()}`;
        const encryptedAccessToken = await encryptPlaidAccessToken(
          exchanged.accessToken,
          { connectionId, plaidItemId: exchanged.itemId },
          { encodedKey: config.tokenEncryptionKey, version: 1 },
        );
        const record = await repository.complete({
          accounts,
          connectionId,
          encryptedAccessToken,
          idempotencyKey: input.idempotencyKey,
          institutionId: institution.id,
          institutionName: institution.name,
          now,
          plaidItemId: exchanged.itemId,
          requestFingerprint,
        });
        return { connection: mapConnection(record, institution), replayed: false };
      } catch (error) {
        try {
          await repository.markFailed(reservationInput);
        } catch {
          // Preserve the original stable error when failure-state recording also fails.
        }
        throw mapFailure(error);
      }
    },
  };
}
