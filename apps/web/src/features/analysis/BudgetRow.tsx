import { parseBudgetAmount, type BudgetSetting } from "@ledger/domain";
import { useRef, useState, type FormEvent } from "react";

import { useTranslation } from "../../i18n/useTranslation";
import { useMoney } from "../../i18n/useMoney";

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
  const formatMoney = useMoney();
  const { t } = useTranslation();
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
      setError(t("bud.invalidAmount"));
    }
  }

  return (
    <li className={`budget-row${over ? " budget-row--over" : ""}`}>
      <div className="budget-row-heading">
        <div>
          <h3>{name}</h3>
          <p>
            {t("bud.spent", { amount: formatMoney(spent, currency) })}
            {spent < 0 ? t("bud.spentRefund") : ""}
          </p>
        </div>
        <div className="budget-row-limit">
          <strong>
            {limit === null
              ? t("bud.noLimit")
              : t("bud.limit", { amount: formatMoney(limit, currency) })}
          </strong>
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
              aria-label={t("bud.editLabel", {
                action: limit === null ? t("bud.action.set") : t("bud.action.change"),
                name,
              })}
            >
              {limit === null ? t("bud.setButton") : t("bud.changeButton")}
            </button>
          ) : null}
        </div>
      </div>
      {remaining !== null ? (
        <>
          <progress aria-label={t("bud.progressLabel", { name })} max={100} value={progress} />
          <p className="budget-status">
            <span>
              {over
                ? t("bud.over", { amount: formatMoney(-remaining, currency) })
                : t("bud.remaining", { amount: formatMoney(remaining, currency) })}
            </span>
            <span>
              {limit === 0
                ? t("bud.zero")
                : t("bud.used", { percent: Math.max(0, (spent / limit!) * 100).toFixed(1) })}
            </span>
          </p>
        </>
      ) : null}
      {editing ? (
        <form className="budget-edit-form" onSubmit={submit}>
          <label>
            {t("bud.fieldLabel", { currency, name })}
            <input
              autoFocus
              defaultValue={limit === null ? "" : (limit / 100).toFixed(2)}
              disabled={saving}
              inputMode="decimal"
              name="amount"
              placeholder={t("bud.placeholder")}
              required
              type="text"
            />
          </label>
          <div className="budget-edit-actions">
            <button className="primary-action" disabled={saving} type="submit">
              {saving ? t("bud.saving") : t("bud.save")}
            </button>
            <button className="secondary-action" disabled={saving} onClick={close} type="button">
              {t("bud.back")}
            </button>
            {limit !== null ? (
              <button
                className="secondary-action"
                disabled={saving}
                onClick={() => void save(null)}
                type="button"
              >
                {t("bud.clear")}
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
