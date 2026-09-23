import {
  parseBudgetAmount,
  type SubscriptionFields,
  type SubscriptionRecord,
} from "@ledger/domain";
import type { CategoriesResponse } from "@ledger/domain/api-contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

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
      setError("请输入大于 0 的金额，最多两位小数。");
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
      <h2 id="subscription-form-title">{plan ? "编辑订阅" : "添加订阅"}</h2>
      <p className="settings-muted">
        {plan
          ? "修改只影响之后的扣款，已记录的金额保持不变。"
          : "从首次扣款日起按月记入支出；选择过去的日期会补记到期月份。"}
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving} className="subscription-fields">
          <label>
            订阅名称
            <input
              ref={firstInput}
              name="name"
              required
              maxLength={160}
              defaultValue={plan?.name}
              placeholder="例如 Apple Music"
            />
          </label>
          <label>
            每次金额
            <input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={plan ? (plan.amountMinor / 100).toFixed(2) : ""}
              placeholder="0.00"
            />
          </label>
          <label>
            币种
            <select name="currency" defaultValue={plan?.currency ?? "CAD"}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>
            扣款账户
            <input
              name="accountLabel"
              required
              maxLength={160}
              defaultValue={plan?.accountLabel ?? "RBC Credit"}
            />
          </label>
          <label>
            支出类别
            <select name="categoryId" required defaultValue={plan?.categoryId ?? ""}>
              <option value="" disabled>
                选择支出类别
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
            {plan ? "下次扣款日" : "首次扣款日"}
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
          {plan?.cadence === "YEARLY"
            ? "此历史订阅按年扣款。"
            : "每月按所选日期扣款；当月没有对应日期时，使用当月最后一天。"}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="subscription-actions">
          <button className="primary-action" disabled={saving} type="submit">
            {saving ? "保存中…" : "保存订阅"}
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            返回列表
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
  const dateInput = useRef<HTMLInputElement>(null);
  useEffect(() => dateInput.current?.focus(), []);
  const cancel = action === "CANCEL";
  return (
    <section
      className="settings-section subscription-editor"
      aria-labelledby="subscription-date-title"
    >
      <h2 id="subscription-date-title">
        {cancel ? "取消订阅" : "恢复订阅"} · {plan.name}
      </h2>
      <p>
        {cancel
          ? "从所选日期（含当天）起停止记账，该日期起已经自动记录的支出也会删除，支出统计随之更新。更早的记录保留。"
          : "从新的首次扣款日继续按原周期记账，取消期间的月份不会补回。选择过去的日期会补记新开始日期之后的到期支出。"}
      </p>
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
          {cancel ? "从哪天开始取消" : "新的首次扣款日"}
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
        <p className="settings-muted">此操作只调整本站的订阅记账。</p>
        <div className="subscription-actions">
          <button className="primary-action" disabled={saving} type="submit">
            {saving ? "保存中…" : cancel ? "确认取消并删除对应支出" : "确认恢复"}
          </button>
          <button disabled={saving} type="button" onClick={onClose}>
            返回列表
          </button>
        </div>
      </form>
    </section>
  );
}
