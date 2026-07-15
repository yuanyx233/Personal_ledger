export const PLAID_CANADA_COUNTRY_CODES = ["CA"] as const;
export const PLAID_TRANSACTION_HISTORY_DAYS = 730 as const;

const ELIGIBLE_ACCOUNT_FILTERS = {
  credit: { account_subtypes: ["credit card"] as const },
  depository: { account_subtypes: ["checking"] as const },
} as const;

export interface InitialLinkTokenInput {
  clientName: string;
  clientUserId: string;
  language: "en" | "fr";
  linkCustomizationName: string;
  webhookUrl: string;
}

export interface InitialLinkTokenRequest {
  account_filters: {
    credit: { account_subtypes: readonly ["credit card"] };
    depository: { account_subtypes: readonly ["checking"] };
  };
  client_name: string;
  country_codes: typeof PLAID_CANADA_COUNTRY_CODES;
  language: "en" | "fr";
  link_customization_name: string;
  products: readonly ["transactions"];
  transactions: { days_requested: typeof PLAID_TRANSACTION_HISTORY_DAYS };
  user: { client_user_id: string };
  webhook: string;
}

export type UpdateLinkReason = "LOGIN_REQUIRED" | "CONSENT_RENEWAL" | "ACCOUNT_SELECTION";

export interface UpdateLinkTokenInput extends InitialLinkTokenInput {
  accessToken: string;
  reason: UpdateLinkReason;
}

interface BaseUpdateLinkTokenRequest {
  access_token: string;
  client_name: string;
  country_codes: typeof PLAID_CANADA_COUNTRY_CODES;
  language: "en" | "fr";
  user: { client_user_id: string };
  webhook: string;
}

export type UpdateLinkTokenRequest = BaseUpdateLinkTokenRequest &
  (
    | {
        account_filters: typeof ELIGIBLE_ACCOUNT_FILTERS;
        link_customization_name: string;
        update: { account_selection_enabled: true };
      }
    | {
        account_filters?: never;
        link_customization_name?: never;
        update?: never;
      }
  );

export function buildInitialLinkTokenRequest(
  input: InitialLinkTokenInput,
): InitialLinkTokenRequest {
  return {
    account_filters: {
      credit: { account_subtypes: [...ELIGIBLE_ACCOUNT_FILTERS.credit.account_subtypes] },
      depository: {
        account_subtypes: [...ELIGIBLE_ACCOUNT_FILTERS.depository.account_subtypes],
      },
    },
    client_name: input.clientName,
    country_codes: PLAID_CANADA_COUNTRY_CODES,
    language: input.language,
    link_customization_name: input.linkCustomizationName,
    products: ["transactions"],
    transactions: { days_requested: PLAID_TRANSACTION_HISTORY_DAYS },
    user: { client_user_id: input.clientUserId },
    webhook: input.webhookUrl,
  };
}

export function buildUpdateLinkTokenRequest(input: UpdateLinkTokenInput): UpdateLinkTokenRequest {
  const base = {
    access_token: input.accessToken,
    client_name: input.clientName,
    country_codes: PLAID_CANADA_COUNTRY_CODES,
    language: input.language,
    user: { client_user_id: input.clientUserId },
    webhook: input.webhookUrl,
  } satisfies BaseUpdateLinkTokenRequest;

  if (input.reason !== "ACCOUNT_SELECTION") return base;
  return {
    ...base,
    account_filters: ELIGIBLE_ACCOUNT_FILTERS,
    link_customization_name: input.linkCustomizationName,
    update: { account_selection_enabled: true },
  };
}
