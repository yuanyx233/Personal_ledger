import { parseBudgetAmount, type BudgetSetting } from "@ledger/domain";
import { useRef, useState, type FormEvent } from "react";

import { formatMoney } from "./analysis-data";

export function BudgetRow({
  categoryId,
  name,
  currency,
  month,
  spent,
  limit,
  editable,
  saving,
  onSave,
}: {
  categoryId: string;
  name: string;
  currency: string;
  month: string;
  spent: number;
  limit: number | null;
  editable: boolean;
  saving: boolean;
  onSave: (setting: BudgetSetting) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const remaining = limit === null ? null : limit - spent;
  const progress =
    limit === null
      ? 0
      : limit === 0
        ? spent > 0
          ? 100
          : 0
        : Math.min(100, Math.max(0, (spent / limit) * 100));
  const over = remaining !== null && remaining < 0;

  function close() {
    setEditing(false);
    setError(null);
    editButton.current?.focus();
  }

  async function save(amountMinor: number | null) {
    if (await onSave({ categoryId, currency, effectiveMonth: month, amountMinor })) close();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const value = new FormData(event.currentTarget).get("amount");
      const amount = parseBudgetAmount(typeof value === "string" ? value.trim() : "");
      setError(null);
      void save(amount);
    } catch {
      setError("请输入有效金额，最多两位小数，零表示不计划支出。");
    }
  }

  return (
    <li className={`budget-row${over ? " budget-row--over" : ""}`}>
      <div className="budget-row-heading">
        <div>
          <h3>{name}</h3>
          <p>
            已花 {formatMoney(spent, currency)}
            {spent < 0 ? " · 净退款" : ""}
          </p>
        </div>
        <div className="budget-row-limit">
          <strong>{limit === null ? "未设置预算" : `上限 ${formatMoney(limit, currency)}`}</strong>
          {editable ? (
            <button
              className="secondary-action"
              disabled={saving}
              onClick={() => {
                setEditing(true);
                setError(null);
              }}
              ref={editButton}
              type="button"
              aria-expanded={editing}
              aria-label={`${limit === null ? "设置" : "修改"}${name}预算`}
            >
              {limit === null ? "设置预算" : "修改"}
            </button>
          ) : null}
        </div>
      </div>
      {remaining !== null ? (
        <>
          <progress aria-label={`${name}预算使用进度`} max={100} value={progress} />
          <p className="budget-status">
            <span>
              {over
                ? `超支 ${formatMoney(-remaining, currency)}`
                : `剩余 ${formatMoney(remaining, currency)}`}
            </span>
            <span>
              {limit === 0 ? "零预算" : `已用 ${Math.max(0, (spent / limit!) * 100).toFixed(1)}%`}
            </span>
          </p>
        </>
      ) : null}
      {editing ? (
        <form className="budget-edit-form" onSubmit={submit}>
          <label>
            {name}预算上限（{currency}）
            <input
              autoFocus
              defaultValue={limit === null ? "" : (limit / 100).toFixed(2)}
              disabled={saving}
              inputMode="decimal"
              name="amount"
              placeholder="例如 500.00"
              required
              type="text"
            />
          </label>
          <div className="budget-edit-actions">
            <button className="primary-action" disabled={saving} type="submit">
              {saving ? "保存中…" : "保存预算"}
            </button>
            <button className="secondary-action" disabled={saving} onClick={close} type="button">
              返回
            </button>
            {limit !== null ? (
              <button
                className="secondary-action"
                disabled={saving}
                onClick={() => void save(null)}
                type="button"
              >
                取消该预算
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="detail-notice detail-notice--error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}
