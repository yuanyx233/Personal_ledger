import { describe, expect, it } from "vitest";

import { buildInitialLinkTokenRequest, buildUpdateLinkTokenRequest } from "./index";

const request = buildInitialLinkTokenRequest({
  clientName: "Personal Ledger",
  clientUserId: "owner",
  language: "en",
  linkCustomizationName: "personal-ledger-account-select",
  webhookUrl: "https://sync.example.invalid/webhooks/plaid",
});

describe("initial Plaid Link request contract", () => {
  it("requests Canada-only Transactions Link with the full 730-day history", () => {
    expect(request.country_codes).toStrictEqual(["CA"]);
    expect(request.products).toStrictEqual(["transactions"]);
    expect(request.transactions).toStrictEqual({ days_requested: 730 });
  });

  it("selects the Account Select customization and only eligible account subtypes", () => {
    expect(request.link_customization_name).toBe("personal-ledger-account-select");
    expect(request.account_filters).toStrictEqual({
      credit: { account_subtypes: ["credit card"] },
      depository: { account_subtypes: ["checking"] },
    });
  });

  it("does not request forbidden products or update-mode fields", () => {
    const serialized = JSON.stringify(request);

    for (const forbidden of [
      "auth",
      "identity",
      "balance",
      "assets",
      "statements",
      "investments",
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    expect(request).not.toHaveProperty("access_token");
    expect(request).not.toHaveProperty("update");
  });
});

describe("update-mode Plaid Link request contract", () => {
  const updateInput = {
    accessToken: "access-token-private",
    clientName: "Personal Ledger",
    clientUserId: "owner",
    language: "en" as const,
    linkCustomizationName: "personal-ledger-account-select",
    reason: "LOGIN_REQUIRED" as const,
    webhookUrl: "https://sync.example.invalid/webhooks/plaid",
  };

  it.each(["LOGIN_REQUIRED", "CONSENT_RENEWAL"] as const)(
    "uses the existing access token for %s without adding products",
    (reason) => {
      const updateRequest = buildUpdateLinkTokenRequest({ ...updateInput, reason });

      expect(updateRequest).toStrictEqual({
        access_token: "access-token-private",
        client_name: "Personal Ledger",
        country_codes: ["CA"],
        language: "en",
        user: { client_user_id: "owner" },
        webhook: "https://sync.example.invalid/webhooks/plaid",
      });
      expect(updateRequest).not.toHaveProperty("products");
      expect(updateRequest).not.toHaveProperty("transactions");
      expect(updateRequest).not.toHaveProperty("update");
    },
  );

  it("enables Account Select and retains eligible-account filters only for account changes", () => {
    expect(
      buildUpdateLinkTokenRequest({ ...updateInput, reason: "ACCOUNT_SELECTION" }),
    ).toStrictEqual({
      access_token: "access-token-private",
      account_filters: {
        credit: { account_subtypes: ["credit card"] },
        depository: { account_subtypes: ["checking"] },
      },
      client_name: "Personal Ledger",
      country_codes: ["CA"],
      language: "en",
      link_customization_name: "personal-ledger-account-select",
      update: { account_selection_enabled: true },
      user: { client_user_id: "owner" },
      webhook: "https://sync.example.invalid/webhooks/plaid",
    });
  });
});
