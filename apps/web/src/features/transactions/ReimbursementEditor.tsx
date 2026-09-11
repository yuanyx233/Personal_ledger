import {
  transactionCategoryOverrideResponseSchema,
  type TransactionDetailResponse,
} from "@ledger/domain/api-contracts";
import { useState, type FormEvent } from "react";

import { BrowserApiError, writeApi } from "../../lib/browser-api";
import { formatMoney } from "../overview/overview-data";
import { ReimbursementFields } from "./ReimbursementFields";

export function ReimbursementEditor({
  transaction,
  onSaved,
}: {
  transaction: TransactionDetailResponse["data"]["transaction"];
  onSaved: () => Promise<void>;
}) {
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
          ? "这笔记录已变化，请刷新后重试。"
          : failure instanceof BrowserApiError && failure.status === 422
            ? "抵扣不能超过原金额，最多保留两位小数。"
            : "没有保存，请检查网络或重新登录后重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-section" aria-labelledby="reimbursement-heading">
      <h2 id="reimbursement-heading">分摊 / 报销</h2>
      <p>
        原金额：{formatMoney(transaction.amountMinor, transaction.currency)} · 已抵扣：
        {formatMoney(transaction.reimbursementMinor, transaction.currency)}
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
              {busy ? "正在保存…" : "保存抵扣"}
            </button>
          </fieldset>
          {error ? (
            <p role="alert" className="detail-notice detail-notice--error">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="detail-muted">只有已入账交易可以修改抵扣。</p>
      )}
    </section>
  );
}
