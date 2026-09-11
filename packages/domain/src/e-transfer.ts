import * as z from "zod";

export const transactionPaymentMetadataSchema = z.strictObject({
  payee: z.string().max(256).nullable(),
  payer: z.string().max(256).nullable(),
  paymentMethod: z.string().max(256).nullable(),
  referenceNumber: z.string().max(256).nullable(),
});

export type TransactionPaymentMetadata = z.infer<typeof transactionPaymentMetadataSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectedText(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.length <= 256 ? value : null;
}

export function projectTransactionPaymentMetadata(value: unknown): TransactionPaymentMetadata {
  const record = isRecord(value) ? value : {};
  return {
    payee: projectedText(record, "payee"),
    payer: projectedText(record, "payer"),
    paymentMethod: projectedText(record, "paymentMethod"),
    referenceNumber: projectedText(record, "referenceNumber"),
  };
}
