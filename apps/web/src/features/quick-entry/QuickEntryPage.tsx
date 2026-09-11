import {
  manualTransactionCreateResponseSchema,
  manualTransactionPreviewResponseSchema,
  type ManualTransactionPreviewResponse,
} from "@ledger/domain/api-contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { BrowserApiError, writeApi } from "../../lib/browser-api";
import { NewMerchantConfirmation } from "./NewMerchantConfirmation";
import { DEFAULT_QUICK_ENTRY_ACCOUNT, torontoCalendarDate } from "./quick-entry-preferences";
import { ReimbursementFields } from "../transactions/ReimbursementFields";

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
  postedDate: string;
  reimbursementAmount?: string;
};

type NewMerchantPreview = {
  draft: QuickEntryDraft;
  suggestedCategory: ManualTransactionPreviewResponse["data"]["category"];
};

export function QuickEntryPage({ online, route }: { online: boolean; route: AppRoute }) {
  const [formKey, setFormKey] = useState(0);
  const [newMerchantPreview, setNewMerchantPreview] = useState<NewMerchantPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CAD");
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
    setCurrency("CAD");
    setDirection("OUTFLOW");
    setReimbursementAmount(null);
    setNewMerchantPreview(null);
    setFormKey((current) => current + 1);
    setNotice({ kind: "success", text });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const draft: QuickEntryDraft = {
      accountLabel: formValue(form, "accountLabel"),
      amount: formValue(form, "amount"),
      ...(reimbursementAmount === null ? {} : { reimbursementAmount }),
      currency: formValue(form, "currency"),
      description: formValue(form, "description"),
      direction: formValue(form, "direction"),
      postedDate: formValue(form, "postedDate"),
    };
    setBusy(true);
    setLoginRequired(false);
    setNotice(null);
    try {
      const preview = await writeApi(
        "/api/v1/transaction-previews",
        "POST",
        draft,
        manualTransactionPreviewResponseSchema,
      );
      if (preview.data.kind === "NEW_MERCHANT") {
        setNewMerchantPreview({ draft, suggestedCategory: preview.data.category });
        setNotice(null);
      } else {
        await writeApi(
          "/api/v1/transactions",
          "POST",
          draft,
          manualTransactionCreateResponseSchema,
        );
        finish("已记下，并已按商户规则分类。");
      }
    } catch (error) {
      if (error instanceof BrowserApiError && error.requiresLogin) {
        setLoginRequired(true);
        setNotice({ kind: "error", text: "登录已过期；请重新登录后再试，这笔尚未写入。" });
      } else {
        setNotice({
          kind: "error",
          text:
            error instanceof BrowserApiError && error.status === 422
              ? "没有写入，请检查金额；抵扣不能超过原金额，最多保留两位小数。"
              : "没有写入，请检查后重试。",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="route-content quick-entry-page">
      <header className="quick-entry-header">
        <p className="page-kicker">消费后 · 立即记录</p>
        <h1>{route.label}</h1>
        <p>金额和商户就够了；其他字段已经替你填好。</p>
      </header>

      {!online ? (
        <DataState variant="offline" />
      ) : (
        <>
          <form className="quick-entry-form" key={formKey} onSubmit={(event) => void submit(event)}>
            <label className="quick-entry-amount">
              金额
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
              商户或描述
              <input
                autoComplete="off"
                enterKeyHint="done"
                maxLength={512}
                name="description"
                required
              />
            </label>
            <label>
              账户
              <input
                defaultValue={DEFAULT_QUICK_ENTRY_ACCOUNT}
                maxLength={160}
                name="accountLabel"
                required
              />
            </label>
            <details className="quick-entry-options">
              <summary>日期、币种和方向</summary>
              <div>
                <label>
                  日期
                  <input
                    defaultValue={torontoCalendarDate(new Date())}
                    name="postedDate"
                    required
                    type="date"
                  />
                </label>
                <label>
                  币种
                  <select
                    value={currency}
                    onChange={(event) => setCurrency(event.currentTarget.value)}
                    name="currency"
                  >
                    <option value="CAD">CAD</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
                <label>
                  方向
                  <select
                    value={direction}
                    onChange={(event) => {
                      setDirection(event.currentTarget.value);
                      setReimbursementAmount(null);
                    }}
                    name="direction"
                  >
                    <option value="OUTFLOW">支出</option>
                    <option value="INFLOW">收入</option>
                  </select>
                </label>
              </div>
            </details>
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
              {busy ? "正在保存…" : "记入账本"}
            </button>
          </form>
          {newMerchantPreview ? (
            <NewMerchantConfirmation
              merchant={newMerchantPreview.draft.description}
              onCancel={() => setNewMerchantPreview(null)}
              onConfirm={async (category) => {
                await writeApi(
                  "/api/v1/transactions",
                  "POST",
                  {
                    ...newMerchantPreview.draft,
                    categoryId: category.id,
                    rememberMerchant: true,
                  },
                  manualTransactionCreateResponseSchema,
                );
                finish(`已记下并分类为“${category.name}”；以后相同商户会自动使用这个类别。`);
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
              重新登录
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
