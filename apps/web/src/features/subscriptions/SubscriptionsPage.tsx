import { useRef, useState } from "react";
import type { SubscriptionCharge, SubscriptionRecord } from "@ledger/domain";
import { DataState } from "../../components/DataState/DataState";
import { SubscriptionDateForm, SubscriptionForm } from "./SubscriptionForm";
import { useSubscriptions } from "./useSubscriptions";
import { useTranslation } from "../../i18n/useTranslation";

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
  const { t } = useTranslation();
  const stopped = cancelled(plan, today);
  const status = stopped
    ? t("sub.status.cancelled")
    : plan.status === "PAUSED"
      ? t("sub.status.paused")
      : plan.cancellationEffectiveDate
        ? t("sub.status.pendingCancel")
        : t("sub.status.active");
  return (
    <article className="subscription-item" aria-label={plan.name}>
      <div className="subscription-item-heading">
        <div>
          <h2>{plan.name}</h2>
          <span className="subscription-status">{status}</span>
        </div>
        <p className="subscription-price">
          {money(plan.amountMinor, plan.currency)}
          <small>
            {" "}
            / {plan.cadence === "MONTHLY" ? t("sub.cadence.monthly") : t("sub.cadence.yearly")}
          </small>
        </p>
      </div>
      <p className="settings-muted">
        {plan.accountLabel} · {category}
      </p>
      <p>
        {plan.cancellationEffectiveDate
          ? t("sub.cancelEffective", { date: plan.cancellationEffectiveDate })
          : t("sub.noCancelDate")}
      </p>
      {!stopped && plan.status === "ACTIVE" && (
        <p>
          {t("sub.nextCharge", { date: plan.nextChargeDate })}
          {plan.nextChargeDate <= today ? t("sub.awaitingCatchUp") : ""}
        </p>
      )}
      {plan.lastErrorCode && <p role="status">{t("sub.needsCheck")}</p>}
      <div className="subscription-actions">
        <button type="button" onClick={() => onAction("EDIT")}>
          {t("sub.edit")}
        </button>
        {stopped || plan.status === "PAUSED" || plan.cancellationEffectiveDate ? (
          <button type="button" onClick={() => onAction("RESUME")}>
            {t("sub.resume")}
          </button>
        ) : null}
        <button type="button" onClick={() => onAction("CANCEL")}>
          {plan.cancellationEffectiveDate ? t("sub.changeCancelDate") : t("sub.cancel")}
        </button>
      </div>
      <details className="subscription-history">
        <summary>
          {t("sub.recentCharges")}
          {charges.length === 0 ? t("sub.recentCharges.none") : ""}
        </summary>
        {charges.length > 0 ? (
          <ul>
            {charges.map((charge) => (
              <li key={charge.id}>
                <span>{charge.scheduledDate}</span>
                <span>{money(charge.amountMinor, charge.currency)}</span>
                <span>
                  {charge.status === "NOT_CHARGED"
                    ? t("sub.charge.removed")
                    : t("sub.charge.recorded")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-muted">{t("sub.charges.empty")}</p>
        )}
      </details>
    </article>
  );
}

export function SubscriptionsPage({ online }: { online: boolean }) {
  const { t } = useTranslation();
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
        <p className="page-kicker">{t("sub.page.kicker")}</p>
        <h1>{t("sub.page.title")}</h1>
        <p className="page-description">{t("sub.page.lead")}</p>
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
              {t("sub.reload")}
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
              {t("sub.activeCount")}
            </p>
            <button
              ref={addButton}
              type="button"
              className="primary-action"
              disabled={saving}
              onClick={() => setSelection({ action: "CREATE" })}
            >
              {t("sub.add")}
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
              <h2>{t("sub.empty.title")}</h2>
              <p>{t("sub.empty.body")}</p>
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
                    t("sub.originalCategory")
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
