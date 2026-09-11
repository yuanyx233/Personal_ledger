import { useRef, useState } from "react";
import type { SubscriptionCharge, SubscriptionRecord } from "@ledger/domain";
import { DataState } from "../../components/DataState/DataState";
import { SubscriptionDateForm, SubscriptionForm } from "./SubscriptionForm";
import { useSubscriptions } from "./useSubscriptions";

function money(amount: number, currency: string) {
  return `${currency} ${(amount / 100).toFixed(2)}`;
}
function cancelled(plan: SubscriptionRecord, today: string) {
  return (
    plan.status === "CANCELLED" ||
    (plan.cancellationEffectiveDate !== null && plan.cancellationEffectiveDate <= today)
  );
}
function SubscriptionItem({
  plan,
  charges,
  today,
  category,
  onAction,
}: {
  plan: SubscriptionRecord;
  charges: SubscriptionCharge[];
  today: string;
  category: string;
  onAction: (action: "EDIT" | "CANCEL" | "RESUME") => void;
}) {
  const stopped = cancelled(plan, today);
  const status = stopped
    ? "已取消"
    : plan.status === "PAUSED"
      ? "已暂停"
      : plan.cancellationEffectiveDate
        ? "待取消"
        : "订阅中";
  return (
    <article className="subscription-item" aria-label={plan.name}>
      <div className="subscription-item-heading">
        <div>
          <h2>{plan.name}</h2>
          <span className="subscription-status">{status}</span>
        </div>
        <p className="subscription-price">
          {money(plan.amountMinor, plan.currency)}
          <small> / {plan.cadence === "MONTHLY" ? "月" : "年"}</small>
        </p>
      </div>
      <p className="settings-muted">
        {plan.accountLabel} · {category}
      </p>
      <p>
        {plan.cancellationEffectiveDate
          ? `取消生效日：${plan.cancellationEffectiveDate}（含当天）`
          : "未设置取消日期"}
      </p>
      {!stopped && plan.status === "ACTIVE" && (
        <p>
          下次扣款：{plan.nextChargeDate}
          {plan.nextChargeDate <= today ? " · 等待后台补记" : ""}
        </p>
      )}
      {plan.lastErrorCode && <p role="status">自动记账需要检查，请核对订阅设置。</p>}
      <div className="subscription-actions">
        <button type="button" onClick={() => onAction("EDIT")}>
          编辑
        </button>
        {stopped || plan.status === "PAUSED" || plan.cancellationEffectiveDate ? (
          <button type="button" onClick={() => onAction("RESUME")}>
            恢复订阅
          </button>
        ) : null}
        <button type="button" onClick={() => onAction("CANCEL")}>
          {plan.cancellationEffectiveDate ? "修改取消日期" : "取消订阅"}
        </button>
      </div>
      <details className="subscription-history">
        <summary>最近记账记录{charges.length === 0 ? " · 暂无" : ""}</summary>
        {charges.length > 0 ? (
          <ul>
            {charges.map((charge) => (
              <li key={charge.id}>
                <span>{charge.scheduledDate}</span>
                <span>{money(charge.amountMinor, charge.currency)}</span>
                <span>{charge.status === "NOT_CHARGED" ? "已删除" : "已记支出"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-muted">到期后，自动支出会显示在这里。</p>
        )}
      </details>
    </article>
  );
}

export function SubscriptionsPage({ online }: { online: boolean }) {
  const { state, saving, notice, save, retry } = useSubscriptions();
  const [selection, setSelection] = useState<{
    id?: string;
    action: "CREATE" | "EDIT" | "CANCEL" | "RESUME";
  } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  function close() {
    setSelection(null);
    requestAnimationFrame(() => addButton.current?.focus());
  }
  const selected =
    state.status === "ready"
      ? state.data.data.subscriptions.find(({ id }) => id === selection?.id)
      : undefined;
  return (
    <div className="route-content settings-page subscriptions-page">
      <header className="page-header">
        <p className="page-kicker">每月自动记账</p>
        <h1>订阅管理</h1>
        <p className="page-description">
          管理每一项固定支出。取消可追溯到过去，重新订阅也可以从新日期开始。
        </p>
      </header>
      {notice && (
        <p className="subscription-notice" role={notice.error ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
      {!online ? (
        <DataState variant="offline" />
      ) : state.status === "loading" ? (
        <DataState variant="loading" />
      ) : state.status === "error" ? (
        <DataState
          variant="error"
          action={
            <button type="button" className="primary-action" onClick={retry}>
              重新加载
            </button>
          }
        />
      ) : (
        <>
          <div className="subscription-toolbar">
            <p>
              {
                state.data.data.subscriptions.filter(
                  (plan) => !cancelled(plan, state.data.meta.today) && plan.status === "ACTIVE",
                ).length
              }{" "}
              项正在订阅
            </p>
            <button
              ref={addButton}
              type="button"
              className="primary-action"
              disabled={saving}
              onClick={() => setSelection({ action: "CREATE" })}
            >
              添加订阅
            </button>
          </div>
          {selection?.action === "CREATE" || (selection?.action === "EDIT" && selected) ? (
            <SubscriptionForm
              key={`${selection.action}-${selected?.id ?? "new"}-${selected?.version ?? 0}`}
              {...(selected ? { plan: selected } : {})}
              today={state.data.meta.today}
              categories={state.data.categories}
              saving={saving}
              onClose={close}
              onSave={(fields, requestId) =>
                selected
                  ? save({ ...fields, action: "EDIT", version: selected.version }, selected.id)
                  : save({ ...fields, requestId })
              }
            />
          ) : selection &&
            selected &&
            (selection.action === "CANCEL" || selection.action === "RESUME") ? (
            <SubscriptionDateForm
              key={`${selection.action}-${selected.id}-${selected.version}`}
              action={selection.action}
              plan={selected}
              today={state.data.meta.today}
              saving={saving}
              onClose={close}
              onSave={(date) =>
                save(
                  selection.action === "CANCEL"
                    ? { action: "CANCEL", version: selected.version, effectiveDate: date }
                    : { action: "RESUME", version: selected.version, nextChargeDate: date },
                  selected.id,
                )
              }
            />
          ) : state.data.data.subscriptions.length === 0 ? (
            <section className="settings-section">
              <h2>还没有订阅</h2>
              <p>添加名称、金额和首次扣款日，以后每个月会自动记入支出。</p>
            </section>
          ) : (
            <div className="subscription-list">
              {state.data.data.subscriptions.map((plan) => (
                <SubscriptionItem
                  key={plan.id}
                  plan={plan}
                  today={state.data.meta.today}
                  category={
                    state.data.categories.find(({ id }) => id === plan.categoryId)?.name ??
                    "原支出类别"
                  }
                  charges={state.data.data.charges.filter(
                    ({ subscriptionId }) => subscriptionId === plan.id,
                  )}
                  onAction={(action) => setSelection({ id: plan.id, action })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
