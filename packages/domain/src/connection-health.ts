export const CONNECTION_STATUSES = [
  "HEALTHY",
  "ACTION_REQUIRED",
  "SYNCING",
  "ERROR",
  "DISCONNECTED",
] as const;

export const CONSENT_STATES = ["NOT_REQUIRED", "CURRENT", "EXPIRING_SOON", "EXPIRED"] as const;

export const CONNECTION_FAILURE_CODES = [
  "LOGIN_REQUIRED",
  "CONSENT_REQUIRED",
  "ACCOUNT_SELECTION_REQUIRED",
  "SYNC_FAILED",
] as const;

export const CONNECTION_NEXT_ACTION_CODES = [
  "NONE",
  "REAUTHENTICATE",
  "RENEW_CONSENT",
  "MANAGE_ACCOUNTS",
  "WAIT_FOR_SYNC",
  "RETRY_SYNC",
  "REPAIR_CONNECTION",
  "RECONNECT",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type ConsentState = (typeof CONSENT_STATES)[number];
export type ConnectionFailureCode = (typeof CONNECTION_FAILURE_CODES)[number];
export type ConnectionNextActionCode = (typeof CONNECTION_NEXT_ACTION_CODES)[number];

export interface ConnectionHealthInput {
  consentExpiresAt: string | null;
  lastErrorCode: string | null;
  lastSuccessAt: string | null;
  status: ConnectionStatus;
}

export interface ConnectionHealth {
  consentExpiresAt: string | null;
  consentState: ConsentState;
  lastFailureCode: ConnectionFailureCode | null;
  lastSuccessAt: string | null;
  nextActionCode: ConnectionNextActionCode;
  status: ConnectionStatus;
}

const CONSENT_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function consentState(expiresAt: string | null, now: Date): ConsentState {
  if (expiresAt === null) return "NOT_REQUIRED";
  const remaining = Date.parse(expiresAt) - now.getTime();
  if (remaining <= 0) return "EXPIRED";
  if (remaining <= CONSENT_WARNING_WINDOW_MS) return "EXPIRING_SOON";
  return "CURRENT";
}

function mappedProviderFailure(
  lastErrorCode: string | null,
): Pick<ConnectionHealth, "lastFailureCode" | "nextActionCode"> | undefined {
  if (lastErrorCode === "ITEM_LOGIN_REQUIRED") {
    return { lastFailureCode: "LOGIN_REQUIRED", nextActionCode: "REAUTHENTICATE" };
  }
  if (
    lastErrorCode === "CONSENT_EXPIRED" ||
    lastErrorCode === "OAUTH_CONSENT_EXPIRED" ||
    lastErrorCode === "PENDING_DISCONNECT"
  ) {
    return { lastFailureCode: "CONSENT_REQUIRED", nextActionCode: "RENEW_CONSENT" };
  }
  if (
    lastErrorCode === "ACCOUNT_SELECTION_REQUIRED" ||
    lastErrorCode === "NEW_ACCOUNTS_AVAILABLE"
  ) {
    return {
      lastFailureCode: "ACCOUNT_SELECTION_REQUIRED",
      nextActionCode: "MANAGE_ACCOUNTS",
    };
  }
  return undefined;
}

export function mapConnectionHealth(
  input: ConnectionHealthInput,
  now = new Date(),
): ConnectionHealth {
  const currentConsentState = consentState(input.consentExpiresAt, now);
  const providerFailure = mappedProviderFailure(input.lastErrorCode);

  if (input.status === "DISCONNECTED") {
    return {
      consentExpiresAt: input.consentExpiresAt,
      consentState: currentConsentState,
      lastFailureCode: providerFailure?.lastFailureCode ?? null,
      lastSuccessAt: input.lastSuccessAt,
      nextActionCode: "RECONNECT",
      status: "DISCONNECTED",
    };
  }
  if (providerFailure) {
    return {
      consentExpiresAt: input.consentExpiresAt,
      consentState: currentConsentState,
      lastFailureCode: providerFailure.lastFailureCode,
      lastSuccessAt: input.lastSuccessAt,
      nextActionCode: providerFailure.nextActionCode,
      status: "ACTION_REQUIRED",
    };
  }
  if (input.status === "SYNCING") {
    return {
      consentExpiresAt: input.consentExpiresAt,
      consentState: currentConsentState,
      lastFailureCode: null,
      lastSuccessAt: input.lastSuccessAt,
      nextActionCode: "WAIT_FOR_SYNC",
      status: "SYNCING",
    };
  }
  if (currentConsentState === "EXPIRING_SOON" || currentConsentState === "EXPIRED") {
    return {
      consentExpiresAt: input.consentExpiresAt,
      consentState: currentConsentState,
      lastFailureCode: "CONSENT_REQUIRED",
      lastSuccessAt: input.lastSuccessAt,
      nextActionCode: "RENEW_CONSENT",
      status: "ACTION_REQUIRED",
    };
  }
  if (input.status === "ERROR") {
    return {
      consentExpiresAt: input.consentExpiresAt,
      consentState: currentConsentState,
      lastFailureCode: "SYNC_FAILED",
      lastSuccessAt: input.lastSuccessAt,
      nextActionCode: "RETRY_SYNC",
      status: "ERROR",
    };
  }
  if (input.status === "ACTION_REQUIRED") {
    return {
      consentExpiresAt: input.consentExpiresAt,
      consentState: currentConsentState,
      lastFailureCode: null,
      lastSuccessAt: input.lastSuccessAt,
      nextActionCode: "REPAIR_CONNECTION",
      status: "ACTION_REQUIRED",
    };
  }
  return {
    consentExpiresAt: input.consentExpiresAt,
    consentState: currentConsentState,
    lastFailureCode: null,
    lastSuccessAt: input.lastSuccessAt,
    nextActionCode: "NONE",
    status: "HEALTHY",
  };
}
