import {
  manualTransactionCreateResponseSchema,
  manualTransactionPreviewResponseSchema,
  type ManualTransactionPreviewResponse,
} from "@ledger/domain/api-contracts";
import { merchantRequiresCategoryConfirmation, reportMerchantFamily } from "@ledger/domain";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { BrowserApiError, writeApi } from "../../lib/browser-api";
import { NewMerchantConfirmation } from "./NewMerchantConfirmation";
import { InstallmentFields } from "./InstallmentFields";
import { LEDGER_CURRENCIES, LEDGER_TIME_ZONE } from "../../lib/app-config";
import { DEFAULT_QUICK_ENTRY_ACCOUNT, ledgerCalendarDate } from "./quick-entry-preferences";
import { ReimbursementFields } from "../transactions/ReimbursementFields";
import { useTranslation } from "../../i18n/useTranslation";

function formValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function sanitizeAmountInput(value: string) {
  const numeric = value.replace(/[^0-9.]/g, "");
  const [whole, ...fractionParts] = numeric.split(".");
  if (fractionParts.length === 0) return whole ?? "";
  return `${whole || "0"}.${fractionParts.join("").slice(0, 2)}`;
}

type QuickEntryDraft = {
  accountLabel: string;
  amount: string;
  currency: string;
  description: string;
  direction: string;
  installmentCount?: number;
  postedDate: string;
  reimbursementAmount?: string;
};

type NewMerchantPreview = {
  confirmEveryTime: boolean;
  draft: QuickEntryDraft;
  matchedMerchant: string | null;
  suggestedCategory: ManualTransactionPreviewResponse["data"]["category"];
};

export function QuickEntryPage({ online, route }: { online: boolean; route: AppRoute }) {
  const { t } = useTranslation();
  const categorySuffix = (confirmEveryTime: boolean) =>
    confirmEveryTime ? t("entry.categorySuffix.once") : t("entry.categorySuffix.remembered");
  const [formKey, setFormKey] = useState(0);
  const [newMerchantPreview, setNewMerchantPreview] = useState<NewMerchantPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(LEDGER_CURRENCIES[0]!);
  const [direction, setDirection] = useState("OUTFLOW");
  const [reimbursementAmount, setReimbursementAmount] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (formKey > 0 && newMerchantPreview === null) amountRef.current?.focus();
  }, [formKey, newMerchantPreview]);

  function finish(text: string) {
    setAmount("");
    setCurrency(LEDGER_CURRENCIES[0]!);
    setDirection("OUTFLOW");
    setReimbursementAmount(null);
    setNewMerchantPreview(null);
    setFormKey((current) => current + 1);
    setNotice({ kind: "success", text });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const installmentCount = formValue(form, "installmentCount");
    const draft: QuickEntryDraft = {
      accountLabel: formValue(form, "accountLabel"),
      amount: formValue(form, "amount"),
      ...(reimbursementAmount === null ? {} : { reimbursementAmount }),
      currency: formValue(form, "currency"),
      description: formValue(form, "description"),
      direction: formValue(form, "direction"),
      ...(formValue(form, "installments") === "on"
        ? { installmentCount: Number(installmentCount) }
        : {}),
      postedDate: formValue(form, "postedDate"),
    };
    setBusy(true);
    setLoginRequired(false);
    setNotice(null);
    try {
      const confirmEveryTime = merchantRequiresCategoryConfirmation(draft.description);
      const preview = await writeApi(
        "/api/v1/transaction-previews",
        "POST",
        draft,
        manualTransactionPreviewResponseSchema,
      );
      if (preview.data.kind === "NEW_MERCHANT" || confirmEveryTime) {
        setNewMerchantPreview({
          confirmEveryTime,
          draft,
          matchedMerchant: reportMerchantFamily(draft.description)?.displayName ?? null,
          suggestedCategory: preview.data.category,
        });
        setNotice(null);
      } else {
        await writeApi(
          "/api/v1/transactions",
          "POST",
          draft,
          manualTransactionCreateResponseSchema,
        );
        finish(
          draft.installmentCount
            ? t("entry.savedInstallments", { count: draft.installmentCount })
            : t("entry.saved"),
        );
      }
    } catch (error) {
      if (error instanceof BrowserApiError && error.requiresLogin) {
        setLoginRequired(true);
        setNotice({ kind: "error", text: t("entry.sessionExpired") });
      } else {
        setNotice({
          kind: "error",
          text:
            error instanceof BrowserApiError && error.status === 422
              ? t("entry.invalidAmount")
              : t("entry.failed"),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="route-content quick-entry-page">
      <header className="quick-entry-header">
        <p className="page-kicker">{t("entry.kicker")}</p>
        <h1>{t(route.labelKey)}</h1>
        <p>{t("entry.lead")}</p>
      </header>

      {!online ? (
        <DataState variant="offline" />
      ) : (
        <>
          <form className="quick-entry-form" key={formKey} onSubmit={(event) => void submit(event)}>
            <label className="quick-entry-amount">
              {t("entry.amount")}
              <span className="quick-entry-money-input">
                <span aria-hidden="true">$</span>
                <input
                  autoComplete="off"
                  inputMode="decimal"
                  name="amount"
                  value={amount}
                  onChange={(event) => setAmount(sanitizeAmountInput(event.currentTarget.value))}
                  pattern="(0|[1-9][0-9]*)(\.[0-9]{1,2})?"
                  ref={amountRef}
                  required
                />
              </span>
            </label>
            <label>
              {t("entry.merchant")}
              <input
                autoComplete="off"
                enterKeyHint="done"
                maxLength={512}
                name="description"
                required
              />
            </label>
            <label>
              {t("entry.account")}
              <input
                defaultValue={DEFAULT_QUICK_ENTRY_ACCOUNT}
                maxLength={160}
                name="accountLabel"
                required
              />
            </label>
            <details className="quick-entry-options">
              <summary>{t("entry.moreFields")}</summary>
              <div>
                <label>
                  {t("entry.date")}
                  <input
                    defaultValue={ledgerCalendarDate(new Date(), LEDGER_TIME_ZONE)}
                    name="postedDate"
                    required
                    type="date"
                  />
                </label>
                <label>
                  {t("entry.currency")}
                  <select
                    value={currency}
                    onChange={(event) => setCurrency(event.currentTarget.value)}
                    name="currency"
                  >
                    {LEDGER_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("entry.direction")}
                  <select
                    value={direction}
                    onChange={(event) => {
                      setDirection(event.currentTarget.value);
                      setReimbursementAmount(null);
                    }}
                    name="direction"
                  >
                    <option value="OUTFLOW">{t("entry.direction.outflow")}</option>
                    <option value="INFLOW">{t("entry.direction.inflow")}</option>
                  </select>
                </label>
              </div>
            </details>
            <InstallmentFields />
            <ReimbursementFields
              amount={amount}
              currency={currency}
              direction={direction}
              value={reimbursementAmount}
              onChange={setReimbursementAmount}
            />
            <button
              className="primary-action quick-entry-submit"
              disabled={busy || newMerchantPreview !== null}
              type="submit"
            >
              {busy ? t("entry.submitting") : t("entry.submit")}
            </button>
          </form>
          {newMerchantPreview ? (
            <NewMerchantConfirmation
              confirmEveryTime={newMerchantPreview.confirmEveryTime}
              matchedMerchant={newMerchantPreview.matchedMerchant}
              merchant={newMerchantPreview.draft.description}
              onCancel={() => setNewMerchantPreview(null)}
              onConfirm={async (category) => {
                await writeApi(
                  "/api/v1/transactions",
                  "POST",
                  {
                    ...newMerchantPreview.draft,
                    categoryId: category.id,
                    ...(newMerchantPreview.confirmEveryTime ? {} : { rememberMerchant: true }),
                  },
                  manualTransactionCreateResponseSchema,
                );
                finish(
                  newMerchantPreview.draft.installmentCount
                    ? t("entry.savedCategorisedInstallments", {
                        category: category.name,
                        count: newMerchantPreview.draft.installmentCount,
                        suffix: categorySuffix(newMerchantPreview.confirmEveryTime),
                      })
                    : t("entry.savedCategorised", {
                        category: category.name,
                        suffix: categorySuffix(newMerchantPreview.confirmEveryTime),
                      }),
                );
              }}
              suggestedCategory={newMerchantPreview.suggestedCategory}
            />
          ) : null}
        </>
      )}
      {notice ? (
        <div className="quick-entry-notice">
          <p
            className={`detail-notice${notice.kind === "error" ? " detail-notice--error" : ""}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
          {loginRequired ? (
            <button
              className="primary-action"
              onClick={() => window.location.reload()}
              type="button"
            >
              {t("entry.signInAgain")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
