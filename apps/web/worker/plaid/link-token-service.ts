import type { LinkTokenRequest, LinkTokenResponse } from "@ledger/domain/api-contracts";
import { decryptPlaidAccessToken } from "@ledger/domain/token-crypto";
import { ConnectionRepository } from "@ledger/persistence";
import { PlaidAdapterError, type PlaidClient } from "@ledger/plaid";

export type LinkTokenServiceErrorCode =
  | "ADDITIONAL_ITEM_CONFIRMATION_REQUIRED"
  | "CONNECTION_NOT_REPAIRABLE"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "UPSTREAM_UNAVAILABLE";

export class LinkTokenServiceError extends Error {
  constructor(
    readonly code: LinkTokenServiceErrorCode,
    readonly institutionCode?: "RBC" | "BMO",
  ) {
    super(code);
    this.name = "LinkTokenServiceError";
  }
}

export interface LinkTokenServiceConfig {
  bmoInstitutionId: string;
  clientName: string;
  database: D1Database;
  linkCustomizationName: string;
  plaid: PlaidClient;
  rbcInstitutionId: string;
  tokenEncryptionKey: string;
  webhookUrl: string;
}

type LinkTokenPayload = LinkTokenResponse["data"];

function mappedFailure(error: unknown): LinkTokenServiceError {
  if (error instanceof LinkTokenServiceError) return error;
  if (error instanceof PlaidAdapterError && error.code === "UPSTREAM_UNAVAILABLE") {
    return new LinkTokenServiceError("UPSTREAM_UNAVAILABLE");
  }
  return new LinkTokenServiceError("INTERNAL_ERROR");
}

export function createLinkTokenService(config: LinkTokenServiceConfig) {
  const repository = new ConnectionRepository(config.database);
  const commonInput = {
    clientName: config.clientName,
    clientUserId: "owner",
    language: "en" as const,
    linkCustomizationName: config.linkCustomizationName,
    webhookUrl: config.webhookUrl,
  };

  return {
    async create(input: LinkTokenRequest): Promise<LinkTokenPayload> {
      try {
        if (input.mode === "INITIAL") {
          const institutionId =
            input.institutionCode === "RBC" ? config.rbcInstitutionId : config.bmoInstitutionId;
          const activeCount = await repository.countActiveByInstitutionId(institutionId);
          if (activeCount > 0 && input.confirmAdditionalItem !== true) {
            throw new LinkTokenServiceError(
              "ADDITIONAL_ITEM_CONFIRMATION_REQUIRED",
              input.institutionCode,
            );
          }
          return await config.plaid.createInitialLinkToken(commonInput);
        }

        const access = await repository.findAccessById(input.connectionId);
        if (!access) throw new LinkTokenServiceError("NOT_FOUND");
        if (access.connection.status === "DISCONNECTED") {
          throw new LinkTokenServiceError("CONNECTION_NOT_REPAIRABLE");
        }
        const accessToken = await decryptPlaidAccessToken(
          access.encryptedAccessToken,
          {
            connectionId: access.connection.id,
            plaidItemId: access.connection.plaidItemId,
          },
          [
            {
              encodedKey: config.tokenEncryptionKey,
              version: access.encryptedAccessToken.keyVersion,
            },
          ],
        );
        return await config.plaid.createUpdateLinkToken({
          ...commonInput,
          accessToken,
          reason: input.reason,
        });
      } catch (error) {
        throw mappedFailure(error);
      }
    },
  };
}
