import { useId, useState } from "react";

export function InstallmentFields() {
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
        分期付款
      </label>
      {enabled ? (
        <div className="installment-controls">
          <label>
            期数
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
            总金额将从所选日期开始按月拆分，最后一期自动补齐余数。
          </p>
        </div>
      ) : null}
    </div>
  );
}
