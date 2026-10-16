import { useId, useState } from "react";
import { useTranslation } from "../../i18n/useTranslation";

export function InstallmentFields() {
  const { t } = useTranslation();
  const hintId = useId();
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState("3");

  return (
    <div className="installment-fields">
      <label className="installment-toggle">
        <input
          checked={enabled}
          name="installments"
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        {t("installments.title")}
      </label>
      {enabled ? (
        <div className="installment-controls">
          <label>
            {t("installments.count")}
            <input
              aria-describedby={hintId}
              inputMode="numeric"
              max={60}
              min={2}
              name="installmentCount"
              onChange={(event) => setCount(event.currentTarget.value)}
              required
              step={1}
              type="number"
              value={count}
            />
          </label>
          <p className="detail-muted" id={hintId}>
            {t("installments.note")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
