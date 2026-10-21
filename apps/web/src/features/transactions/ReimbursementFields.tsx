import { decimalAmountSchema, decimalAmountToMinorUnits } from "@ledger/domain/api-contracts";

import { formatMoney } from "../overview/overview-data";
import { useTranslation } from "../../i18n/useTranslation";

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
  const { t } = useTranslation();
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
        {isReceipt ? t("reimb.receiptTitle") : t("reimb.offsetTitle")}
      </label>
      {value !== null ? (
        <>
          <label>
            {isReceipt ? t("reimb.receiptAmount") : t("reimb.offsetAmount")}
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
              ? t(isReceipt ? "reimb.resultIncome" : "reimb.resultPersonal", {
                  amount: formatMoney(personal, currency),
                })
              : t("reimb.invalid")}
          </p>
          <p className="detail-muted">
            {isReceipt ? t("reimb.receiptNote") : t("reimb.offsetNote")}
          </p>
        </>
      ) : null}
    </div>
  );
}
