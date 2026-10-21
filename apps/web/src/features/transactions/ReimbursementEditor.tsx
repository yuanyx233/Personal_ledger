import {
  transactionCategoryOverrideResponseSchema,
  type TransactionDetailResponse,
} from "@ledger/domain/api-contracts";
import { useState, type FormEvent } from "react";

import { BrowserApiError, writeApi } from "../../lib/browser-api";
import { ReimbursementFields } from "./ReimbursementFields";
import { useTranslation } from "../../i18n/useTranslation";
import { useMoney } from "../../i18n/useMoney";

export function ReimbursementEditor({
  transaction,
  onSaved,
}: {
  transaction: TransactionDetailResponse["data"]["transaction"];
  onSaved: () => Promise<void>;
}) {
  const formatMoney = useMoney();
  const { t } = useTranslation();
  const [value, setValue] = useState<string | null>(
    transaction.reimbursementMinor > 0 ? (transaction.reimbursementMinor / 100).toFixed(2) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await writeApi(
        `/api/v1/transactions/${encodeURIComponent(transaction.id)}`,
        "PATCH",
        {
          reimbursementAmount: value ?? "0",
          version: transaction.version,
        },
        transactionCategoryOverrideResponseSchema,
      );
      await onSaved();
    } catch (failure) {
      setError(
        failure instanceof BrowserApiError && failure.status === 409
          ? t("reimb.stale")
          : failure instanceof BrowserApiError && failure.status === 422
            ? t("reimb.tooLarge")
            : t("reimb.failed"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-section" aria-labelledby="reimbursement-heading">
      <h2 id="reimbursement-heading">{t("reimb.heading")}</h2>
      <p>
        {t("reimb.original", {
          amount: formatMoney(transaction.amountMinor, transaction.currency),
          offset: formatMoney(transaction.reimbursementMinor, transaction.currency),
        })}
      </p>
      {transaction.status === "POSTED" ? (
        <form className="correction-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="reimbursement-controls" disabled={busy}>
            <ReimbursementFields
              amount={(transaction.amountMinor / 100).toFixed(2)}
              currency={transaction.currency}
              direction={transaction.direction}
              value={value}
              onChange={setValue}
            />
            <button className="primary-action" type="submit">
              {busy ? t("reimb.saving") : t("reimb.save")}
            </button>
          </fieldset>
          {error ? (
            <p role="alert" className="detail-notice detail-notice--error">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="detail-muted">{t("reimb.postedOnly")}</p>
      )}
    </section>
  );
}
