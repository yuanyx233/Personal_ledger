import { describe, expect, it } from "vitest";

import { projectTransactionPaymentMetadata } from "./e-transfer";

describe("external e-Transfer semantics", () => {
  it("projects only the four display fields and preserves supplied empty text", () => {
    expect(
      projectTransactionPaymentMetadata({
        byOrderOf: "Hidden wire initiator",
        payee: "Alex",
        payer: "",
        paymentMethod: "INTERAC",
        paymentProcessor: "Hidden processor",
        ppdId: "Hidden PPD",
        reason: "Hidden private reason",
        referenceNumber: "reference-1",
      }),
    ).toEqual({
      payee: "Alex",
      payer: "",
      paymentMethod: "INTERAC",
      referenceNumber: "reference-1",
    });
  });

  it("represents absent or invalid display fields as not provided", () => {
    expect(projectTransactionPaymentMetadata(null)).toEqual({
      payee: null,
      payer: null,
      paymentMethod: null,
      referenceNumber: null,
    });
    expect(
      projectTransactionPaymentMetadata({
        payee: 42,
        payer: null,
        paymentMethod: "x".repeat(257),
      }),
    ).toEqual({
      payee: null,
      payer: null,
      paymentMethod: null,
      referenceNumber: null,
    });
  });
});
