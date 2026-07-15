import {
  buildInitialLinkTokenRequest,
  buildUpdateLinkTokenRequest,
  type InitialLinkTokenInput,
  type UpdateLinkTokenInput,
} from "./link-token";

const PLAID_ORIGINS = {
  production: "https://production.plaid.com",
  sandbox: "https://sandbox.plaid.com",
} as const;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;

export type PlaidEnvironment = keyof typeof PLAID_ORIGINS;
export type PlaidAdapterErrorCode = "INVALID_CONFIGURATION" | "UPSTREAM_UNAVAILABLE";

export class PlaidAdapterError extends Error {
  constructor(readonly code: PlaidAdapterErrorCode) {
    super(code);
    this.name = "PlaidAdapterError";
  }
}

export interface PlaidClientConfig {
  clientId: string;
  environment: PlaidEnvironment;
  fetcher?: typeof fetch;
  secret: string;
}

export interface InitialLinkToken {
  expiresAt: string;
  linkToken: string;
}

export interface ExchangedPlaidItem {
  accessToken: string;
  itemId: string;
}

export interface PlaidAccountSnapshot {
  id: string;
  isoCurrencyCode: string | null;
  mask: string | null;
  name: string;
  subtype: string;
  type: string;
}

export interface PlaidItemAccounts {
  accounts: PlaidAccountSnapshot[];
  institutionId: string | null;
  institutionName: string | null;
  itemId: string;
}

export interface PlaidClient {
  createInitialLinkToken(input: InitialLinkTokenInput): Promise<InitialLinkToken>;
  createUpdateLinkToken(input: UpdateLinkTokenInput): Promise<InitialLinkToken>;
  exchangePublicToken(publicToken: string): Promise<ExchangedPlaidItem>;
  getItemAccounts(accessToken: string): Promise<PlaidItemAccounts>;
}

function isValidUpdateLinkInput(input: UpdateLinkTokenInput): boolean {
  return (
    isValidInitialLinkInput(input) &&
    isNonEmptyBoundedString(input.accessToken, 2048) &&
    ["LOGIN_REQUIRED", "CONSENT_RENEWAL", "ACCOUNT_SELECTION"].includes(input.reason)
  );
}

function isNonEmptyBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function isValidInitialLinkInput(input: InitialLinkTokenInput): boolean {
  if (
    !isNonEmptyBoundedString(input.clientName, 64) ||
    !isNonEmptyBoundedString(input.clientUserId, 128) ||
    !isNonEmptyBoundedString(input.linkCustomizationName, 128)
  ) {
    return false;
  }

  try {
    const webhookUrl = new URL(input.webhookUrl);
    return (
      webhookUrl.protocol === "https:" && webhookUrl.username === "" && webhookUrl.password === ""
    );
  } catch {
    return false;
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > MAXIMUM_RESPONSE_BYTES) {
    throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseInitialLinkTokenResponse(value: unknown): InitialLinkToken | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyBoundedString(record.link_token, 2048) ||
    !isNonEmptyBoundedString(record.expiration, 64) ||
    !isNonEmptyBoundedString(record.request_id, 256) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(record.expiration) ||
    Number.isNaN(Date.parse(record.expiration))
  ) {
    return undefined;
  }
  return { expiresAt: record.expiration, linkToken: record.link_token };
}

function parseExchangedItemResponse(value: unknown): ExchangedPlaidItem | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyBoundedString(record.access_token, 2048) ||
    !isNonEmptyBoundedString(record.item_id, 160) ||
    !isNonEmptyBoundedString(record.request_id, 256)
  ) {
    return undefined;
  }
  return { accessToken: record.access_token, itemId: record.item_id };
}

function nullableBoundedString(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null) return null;
  return isNonEmptyBoundedString(value, maximumLength) ? value : undefined;
}

function parseItemAccountsResponse(value: unknown): PlaidItemAccounts | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.accounts) ||
    record.accounts.length > 64 ||
    typeof record.item !== "object" ||
    record.item === null ||
    Array.isArray(record.item) ||
    !isNonEmptyBoundedString(record.request_id, 256)
  ) {
    return undefined;
  }

  const item = record.item as Record<string, unknown>;
  const institutionId = nullableBoundedString(item.institution_id, 160);
  const institutionName = nullableBoundedString(item.institution_name, 256);
  if (
    institutionId === undefined ||
    institutionName === undefined ||
    !isNonEmptyBoundedString(item.item_id, 160)
  ) {
    return undefined;
  }

  const accounts: PlaidAccountSnapshot[] = [];
  for (const rawAccount of record.accounts) {
    if (typeof rawAccount !== "object" || rawAccount === null || Array.isArray(rawAccount)) {
      return undefined;
    }
    const account = rawAccount as Record<string, unknown>;
    if (
      typeof account.balances !== "object" ||
      account.balances === null ||
      Array.isArray(account.balances)
    ) {
      return undefined;
    }
    const balances = account.balances as Record<string, unknown>;
    const isoCurrencyCode = nullableBoundedString(balances.iso_currency_code, 3);
    const mask = nullableBoundedString(account.mask, 32);
    if (
      isoCurrencyCode === undefined ||
      mask === undefined ||
      !isNonEmptyBoundedString(account.account_id, 160) ||
      !isNonEmptyBoundedString(account.name, 256) ||
      !isNonEmptyBoundedString(account.subtype, 64) ||
      !isNonEmptyBoundedString(account.type, 64)
    ) {
      return undefined;
    }
    accounts.push({
      id: account.account_id,
      isoCurrencyCode,
      mask,
      name: account.name,
      subtype: account.subtype,
      type: account.type,
    });
  }

  return {
    accounts,
    institutionId,
    institutionName,
    itemId: item.item_id,
  };
}

export function createPlaidClient({
  clientId,
  environment,
  fetcher = fetch,
  secret,
}: PlaidClientConfig): PlaidClient {
  if (
    !isNonEmptyBoundedString(clientId, 256) ||
    !isNonEmptyBoundedString(secret, 512) ||
    !(environment in PLAID_ORIGINS)
  ) {
    throw new PlaidAdapterError("INVALID_CONFIGURATION");
  }
  const origin = PLAID_ORIGINS[environment];

  async function postJson(path: string, body: object): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
        method: "POST",
      });
    } catch {
      throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
    }

    if (!response.ok) throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");

    try {
      return JSON.parse(await readBoundedResponse(response));
    } catch (error) {
      if (error instanceof PlaidAdapterError) throw error;
      throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
    }
  }

  return {
    async createInitialLinkToken(input) {
      if (!isValidInitialLinkInput(input)) {
        throw new PlaidAdapterError("INVALID_CONFIGURATION");
      }

      const parsed = parseInitialLinkTokenResponse(
        await postJson("/link/token/create", buildInitialLinkTokenRequest(input)),
      );
      if (!parsed) throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
      return parsed;
    },
    async createUpdateLinkToken(input) {
      if (!isValidUpdateLinkInput(input)) {
        throw new PlaidAdapterError("INVALID_CONFIGURATION");
      }

      const parsed = parseInitialLinkTokenResponse(
        await postJson("/link/token/create", buildUpdateLinkTokenRequest(input)),
      );
      if (!parsed) throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
      return parsed;
    },
    async exchangePublicToken(publicToken) {
      if (!isNonEmptyBoundedString(publicToken, 2048)) {
        throw new PlaidAdapterError("INVALID_CONFIGURATION");
      }
      const parsed = parseExchangedItemResponse(
        await postJson("/item/public_token/exchange", { public_token: publicToken }),
      );
      if (!parsed) throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
      return parsed;
    },
    async getItemAccounts(accessToken) {
      if (!isNonEmptyBoundedString(accessToken, 2048)) {
        throw new PlaidAdapterError("INVALID_CONFIGURATION");
      }
      const parsed = parseItemAccountsResponse(
        await postJson("/accounts/get", { access_token: accessToken }),
      );
      if (!parsed) throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
      return parsed;
    },
  };
}
