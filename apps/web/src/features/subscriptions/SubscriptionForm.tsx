import {
  parseBudgetAmount,
  type SubscriptionFields,
  type SubscriptionRecord,
} from "@ledger/domain";
import type { CategoriesResponse } from "@ledger/domain/api-contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { LEDGER_CURRENCIES } from "../../lib/app-config";
import { useTranslation } from "../../i18n/useTranslation";

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export function SubscriptionForm({
  plan,
  today,
  categories,
  saving,
  onClose,
  onSave,
}: {
  plan?: SubscriptionRecord;
  today: string;
  categories: CategoriesResponse["data"]["categories"];
  saving: boolean;
  onClose: () => void;
  onSave: (fields: SubscriptionFields, requestId: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => firstInput.current?.focus(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    let amountMinor: number;
    try {
      amountMinor = parseBudgetAmount(formText(data, "amount"));
      if (!amountMinor) throw new Error();
    } catch {
      setError(t("subForm.invalidAmount"));
      return;
    }
    if (
      await onSave(
        {
          name: formText(data, "name"),
          amountMinor,
          currency: formText(data, "currency"),
          accountLabel: formText(data, "accountLabel"),
          categoryId: formText(data, "categoryId"),
          nextChargeDate: formText(data, "nextChargeDate"),
        },
        requestId,
      )
    )
      onClose();
  }
  return (
    <section
      className="settings-section subscription-editor"
      aria-labelledby="subscription-form-title"
    >
      <h2 id="subscription-form-title">
        {plan ? t("subForm.title.edit") : t("subForm.title.add")}
      </h2>
      <p className="settings-muted">{plan ? t("subForm.lead.edit") : t("subForm.lead.add")}</p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving} className="subscription-fields">
          <label>
            {t("subForm.name")}
            <input
              ref={firstInput}
              name="name"
              required
              maxLength={160}
              defaultValue={plan?.name}
              placeholder={t("subForm.namePlaceholder")}
            />
          </label>
          <label>
            {t("subForm.amount")}
            <input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={plan ? (plan.amountMinor / 100).toFixed(2) : ""}
              placeholder="0.00"
            />
          </label>
          <label>
            {t("subForm.currency")}
            <select name="currency" defaultValue={plan?.currency ?? LEDGER_CURRENCIES[0]}>
              {LEDGER_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("subForm.account")}
            <input
              name="accountLabel"
              required
              maxLength={160}
              defaultValue={plan?.accountLabel ?? "RBC Credit"}
            />
          </label>
          <label>
            {t("subForm.category")}
            <select name="categoryId" required defaultValue={plan?.categoryId ?? ""}>
              <option value="" disabled>
                {t("subForm.categoryPlaceholder")}
              </option>
              {categories
                .filter(({ active, kind }) => active && kind === "EXPENSE")
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {plan ? t("subForm.nextChargeDate") : t("subForm.firstChargeDate")}
            <input
              type="date"
              name="nextChargeDate"
              required
              min={plan?.nextChargeDate ?? "1900-01-01"}
              max="9998-12-31"
              defaultValue={plan?.nextChargeDate ?? today}
            />
          </label>
        </fieldset>
        <p className="settings-muted">
          {plan?.cadence === "YEARLY" ? t("subForm.note.yearly") : t("subForm.note.monthly")}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="subscription-actions">
          <button className="primary-action" disabled={saving} type="submit">
            {saving ? t("subForm.saving") : t("subForm.save")}
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            {t("subForm.back")}
          </button>
        </div>
      </form>
    </section>
  );
}

export function SubscriptionDateForm({
  action,
  plan,
  today,
  saving,
  onClose,
  onSave,
}: {
  action: "CANCEL" | "RESUME";
  plan: SubscriptionRecord;
  today: string;
  saving: boolean;
  onClose: () => void;
  onSave: (date: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const dateInput = useRef<HTMLInputElement>(null);
  useEffect(() => dateInput.current?.focus(), []);
  const cancel = action === "CANCEL";
  return (
    <section
      className="settings-section subscription-editor"
      aria-labelledby="subscription-date-title"
    >
      <h2 id="subscription-date-title">
        {cancel ? t("subForm.cancelTitle") : t("subForm.resumeTitle")} · {plan.name}
      </h2>
      <p>{cancel ? t("subForm.cancelBody") : t("subForm.resumeBody")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const date = formText(new FormData(event.currentTarget), "date");
          void onSave(date).then((saved) => {
            if (saved) onClose();
          });
        }}
      >
        <label>
          {cancel ? t("subForm.cancelFrom") : t("subForm.resumeFrom")}
          <input
            ref={dateInput}
            name="date"
            type="date"
            min="1900-01-01"
            max="9998-12-31"
            required
            disabled={saving}
            defaultValue={cancel ? (plan.cancellationEffectiveDate ?? today) : today}
          />
        </label>
        <p className="settings-muted">{t("subForm.localOnly")}</p>
        <div className="subscription-actions">
          <button className="primary-action" disabled={saving} type="submit">
            {saving
              ? t("subForm.saving")
              : cancel
                ? t("subForm.confirmCancel")
                : t("subForm.confirmResume")}
          </button>
          <button disabled={saving} type="button" onClick={onClose}>
            {t("subForm.back")}
          </button>
        </div>
      </form>
    </section>
  );
}
