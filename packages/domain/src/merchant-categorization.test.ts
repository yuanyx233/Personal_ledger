import { describe, expect, it } from "vitest";

import { normalizeMerchantName } from "./merchant-categorization";

describe("merchant normalization", () => {
  it.each([
    ["  ＡＭＡＺＯＮ   Marketplace #1234  ", "amazon marketplace"],
    ["Acme Store 0042", "acme"],
    ["Café\tDépôt", "café dépôt"],
    ["Whole Foods Market", "whole foods market"],
    [null, null],
    ["   ", null],
  ])("normalizes %j deterministically", (input, expected) => {
    expect(normalizeMerchantName(input)).toBe(expected);
  });

  it("keeps similar-but-not-equal merchants distinct", () => {
    expect(normalizeMerchantName("Whole Foods")).not.toBe(
      normalizeMerchantName("Whole Foods Market"),
    );
    expect(normalizeMerchantName("Amazon Marketplace")).not.toBe(
      normalizeMerchantName("Amazon Prime"),
    );
    expect(normalizeMerchantName("Studio 54")).not.toBe(normalizeMerchantName("Studio 55"));
  });

  it("fails closed when Unicode normalization expands beyond the stored key limit", () => {
    expect(normalizeMerchantName("ﬃ".repeat(100))).toBeNull();
  });
});
