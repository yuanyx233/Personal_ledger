import { describe, expect, it } from "vitest";

import { API_PREFIX, PRODUCT_NAME } from "./index";

describe("workspace domain constants", () => {
  it("exposes the stable application name and versioned API prefix", () => {
    expect(PRODUCT_NAME).toBe("Personal Ledger");
    expect(API_PREFIX).toBe("/api/v1");
  });
});
