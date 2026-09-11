import { decimalAmountSchema, decimalAmountToMinorUnits } from "@ledger/domain/api-contracts";

import { formatMoney } from "../overview/overview-data";

export function ReimbursementFields({
  amount,
  currency,
  direction,
  value,
  onChange,
}: {
  amount: string;
  currency: string;
  direction: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const total = decimalAmountSchema.safeParse(amount);
  const deduction = decimalAmountSchema.safeParse(value ?? "0");
  const personal =
    total.success && deduction.success
      ? decimalAmountToMinorUnits(total.data, "CAD") -
        decimalAmountToMinorUnits(deduction.data, "CAD")
      : null;
  const isReceipt = direction === "INFLOW";

  return (
    <div className="reimbursement-fields">
      <label className="reimbursement-toggle">
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(event) =>
            onChange(event.currentTarget.checked ? (isReceipt ? amount : "") : null)
          }
        />
        {isReceipt ? "这是分摊 / 报销回款" : "分摊 / 报销抵扣"}
      </label>
      {value !== null ? (
        <>
          <label>
            {isReceipt ? "回款金额（不计收入）" : "抵扣金额"}
            <input
              autoComplete="off"
              inputMode="decimal"
              type="number"
              min="0"
              max={total.success ? amount : undefined}
              step="0.01"
              required
              value={value}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
          </label>
          <p className="reimbursement-preview" aria-live="polite">
            {personal !== null && personal >= 0
              ? `${isReceipt ? "计入收入" : "个人消费"}：${formatMoney(personal, currency)}`
              : "请输入有效金额，抵扣不能超过原金额。"}
          </p>
          <p className="detail-muted">
            {isReceipt
              ? "回款部分不计收入，也不会再次抵扣消费；请在原付款中填写抵扣金额。"
              : "保留原始付款，只把扣除后的金额计入消费。另录收款时，请标记为分摊 / 报销回款。"}
          </p>
        </>
      ) : null}
    </div>
  );
}
