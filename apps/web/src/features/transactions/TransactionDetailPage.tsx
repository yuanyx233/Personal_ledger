import {
  merchantRuleCorrectionResponseSchema,
  manualTransactionMutationResponseSchema,
  transactionCategoryOverrideResponseSchema,
  type CategoryReadModel,
  type TransactionDetailResponse,
} from "@ledger/domain/api-contracts";
import { useState, type MouseEvent } from "react";

import { DataState } from "../../components/DataState/DataState";
import { BrowserApiError, writeApi } from "../../lib/browser-api";
import { useTransactionDetail } from "./useTransactionDetail";
import { ReimbursementEditor } from "./ReimbursementEditor";
import type { LanguageContextValue } from "../../i18n/context";
import { useTranslation } from "../../i18n/useTranslation";
import { useMoney } from "../../i18n/useMoney";
import { categoryDisplayName } from "../../i18n/categoryName";

type MoneyFormatter = (amountMinor: number, currency: string) => string;

type Transaction = TransactionDetailResponse["data"]["transaction"];

const CATEGORY_SOURCE_KEYS = {
  MANUAL: "tx.auditSource.MANUAL",
  PLAID: "tx.auditSource.PLAID",
  RULE: "tx.auditSource.RULE",
  UNCLASSIFIED: "tx.auditSource.UNCLASSIFIED",
} as const;
const STATUS_KEYS = {
  PENDING: "tx.status.PENDING",
  POSTED: "tx.status.POSTED",
  REMOVED: "tx.status.REMOVED",
} as const;
function displayValue(value: string | null) {
  return value || "—";
}

function signedAmount(transaction: Transaction, formatMoney: MoneyFormatter) {
  const amountMinor = Number(transaction.amountMinor);
  const amount = transaction.direction === "OUTFLOW" ? -amountMinor : amountMinor;
  return formatMoney(amount, transaction.currency);
}

function DetailHeader({ transaction }: { transaction?: Transaction }) {
  const formatMoney = useMoney();
  const { t } = useTranslation();
  return (
    <header className="page-header transaction-detail-header">
      <p className="page-kicker">{t("txDetail.kicker")}</p>
      <h1>{t("txDetail.title")}</h1>
      <p className="page-description">
        {transaction
          ? `${signedAmount(transaction, formatMoney)} · ${t(STATUS_KEYS[transaction.status])} · ${transaction.postedDate}`
          : t("txDetail.lead")}
      </p>
    </header>
  );
}

function DetailPageState({ variant }: { variant: "error" | "loading" | "offline" }) {
  return (
    <div className="route-content transaction-detail-page">
      <DetailHeader />
      <DataState variant={variant} />
    </div>
  );
}

function mutationErrorMessage(error: unknown, t: LanguageContextValue["t"]) {
  if (error instanceof BrowserApiError && error.status === 409) {
    return t("txDetail.stale");
  }
  if (error instanceof BrowserApiError && error.status === 422) {
    return t("txDetail.notApplicable");
  }
  return t("txDetail.failed");
}

function AuditTrail({
  categories,
  transaction,
}: {
  categories: Map<string, string>;
  transaction: Transaction;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="category-audit-heading" className="detail-section">
      <div className="detail-section-heading">
        <p>Append-only</p>
        <h2 id="category-audit-heading">{t("txDetail.auditHeading")}</h2>
      </div>
      {transaction.categoryAudits.length === 0 ? (
        <p className="detail-muted">{t("txDetail.auditEmpty")}</p>
      ) : (
        <ol className="audit-list">
          {transaction.categoryAudits.map((audit) => (
            <li key={audit.id}>
              <p>
                <strong>{audit.reason}</strong>
                <time dateTime={audit.createdAt}>
                  {new Date(audit.createdAt).toLocaleString("zh-CN")}
                </time>
              </p>
              <span>
                {audit.oldCategoryId
                  ? (categories.get(audit.oldCategoryId) ?? t("txDetail.unknownCategory"))
                  : t("txDetail.noCategory")}
                {" → "}
                {audit.newCategoryId
                  ? (categories.get(audit.newCategoryId) ?? t("txDetail.unknownCategory"))
                  : t("txDetail.noCategory")}
              </span>
              <span>
                {t(CATEGORY_SOURCE_KEYS[audit.oldSource])} →{" "}
                {t(CATEGORY_SOURCE_KEYS[audit.newSource])}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RawDetail({ transaction }: { transaction: Transaction }) {
  const { t } = useTranslation();
  const fields = [
    [t("txDetail.field.description"), transaction.description],
    [t("txDetail.field.merchant"), displayValue(transaction.merchantName)],
    [t("txDetail.field.normalizedMerchant"), displayValue(transaction.normalizedMerchant)],
    [t("txDetail.field.account"), transaction.accountLabel ?? "—"],
    [t("txDetail.field.authorizedDate"), displayValue(transaction.authorizedDate)],
    [t("txDetail.field.postedDate"), transaction.postedDate],
    [
      t("txDetail.field.installment"),
      transaction.installment
        ? t("tx.installment", {
            count: transaction.installment.count,
            number: transaction.installment.number,
          })
        : "—",
    ],
    [t("txDetail.field.payee"), displayValue(transaction.paymentMetadata.payee)],
    [t("txDetail.field.payer"), displayValue(transaction.paymentMetadata.payer)],
    [t("txDetail.field.paymentMethod"), displayValue(transaction.paymentMetadata.paymentMethod)],
    [t("txDetail.field.reference"), displayValue(transaction.paymentMetadata.referenceNumber)],
    [
      t("txDetail.field.pendingPredecessor"),
      displayValue(transaction.lifecycle.pendingTransactionId),
    ],
    [
      t("txDetail.field.postedSuccessor"),
      displayValue(transaction.lifecycle.replacedByTransactionId),
    ],
  ] as const;

  return (
    <section aria-labelledby="raw-detail-heading" className="detail-section">
      <div className="detail-section-heading">
        <p>Bank record</p>
        <h2 id="raw-detail-heading">{t("txDetail.rawHeading")}</h2>
      </div>
      <dl className="detail-grid">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function TransactionDetailPage({
  online,
  onNavigate,
  transactionId,
}: {
  online: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, nextPath: string) => void;
  transactionId: string;
}) {
  const { t } = useTranslation();
  const { refresh, state } = useTransactionDetail(transactionId);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!online) return <DetailPageState variant="offline" />;
  if (state.status === "loading") return <DetailPageState variant="loading" />;
  if (state.status === "error") return <DetailPageState variant="error" />;

  const { categories, transaction } = state;
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const editableCategories = categories.filter(
    (category) => category.active && (category.editable || category.systemKey === "TRANSFER"),
  );

  async function correctCategory(scope: "RULE" | "TRANSACTION") {
    const categoryId = selectedCategoryId;
    if (!categoryId) {
      setNotice({ kind: "error", text: t("txDetail.chooseCategory") });
      return;
    }
    const action = scope === "RULE" ? "merchant-rule" : "transaction";
    setPendingAction(action);
    setNotice(null);
    try {
      if (scope === "RULE") {
        await writeApi(
          `/api/v1/transactions/${encodeURIComponent(transaction.id)}/merchant-rule`,
          "PUT",
          { categoryId, version: transaction.version },
          merchantRuleCorrectionResponseSchema,
        );
      } else {
        await writeApi(
          `/api/v1/transactions/${encodeURIComponent(transaction.id)}`,
          "PATCH",
          { categoryId, version: transaction.version },
          transactionCategoryOverrideResponseSchema,
        );
      }
      await refresh();
      setNotice({
        kind: "success",
        text: scope === "RULE" ? t("txDetail.savedRule") : t("txDetail.savedOne"),
      });
    } catch (error: unknown) {
      setNotice({ kind: "error", text: mutationErrorMessage(error, t) });
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteManualTransaction() {
    setPendingAction("delete-manual");
    setNotice(null);
    try {
      await writeApi(
        `/api/v1/transactions/${encodeURIComponent(transaction.id)}`,
        "DELETE",
        { version: transaction.version },
        manualTransactionMutationResponseSchema,
      );
      setConfirmDelete(false);
      await refresh();
      setNotice({ kind: "success", text: t("txDetail.removed") });
    } catch (error: unknown) {
      setNotice({ kind: "error", text: mutationErrorMessage(error, t) });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <article className="route-content transaction-detail-page">
      <a
        className="detail-back-link"
        href="/transactions"
        onClick={(event) => onNavigate(event, "/transactions")}
      >
        {t("txDetail.back")}
      </a>
      <DetailHeader transaction={transaction} />

      {notice ? (
        <p
          className={`detail-notice detail-notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      <section
        aria-labelledby="classification-heading"
        className="detail-section classification-panel"
      >
        <div className="detail-section-heading">
          <p>Current classification</p>
          <h2 id="classification-heading">{t("txDetail.classificationHeading")}</h2>
        </div>
        <dl className="classification-summary">
          <div>
            <dt>{t("txDetail.category")}</dt>
            <dd>
              {transaction.categoryId
                ? (categoryNames.get(transaction.categoryId) ?? t("txDetail.unknownCategory"))
                : t("tx.catSource.UNCLASSIFIED")}
            </dd>
          </div>
          <div>
            <dt>{t("txDetail.sourceLabel")}</dt>
            <dd>
              {transaction.categorizationSource === "RULE" && transaction.categoryRuleId === null
                ? t("txDetail.recognisedMerchant")
                : t(CATEGORY_SOURCE_KEYS[transaction.categorizationSource])}
            </dd>
          </div>
          <div>
            <dt>{t("txDetail.ruleId")}</dt>
            <dd>{displayValue(transaction.categoryRuleId)}</dd>
          </div>
          <div>
            <dt>{t("txDetail.reviewReason")}</dt>
            <dd>{displayValue(transaction.reviewReason)}</dd>
          </div>
        </dl>
        <div className="correction-form">
          <label>
            {t("txDetail.newCategory")}
            <select
              onChange={(event) => setSelectedCategoryId(event.currentTarget.value)}
              value={selectedCategoryId}
            >
              <option disabled value="">
                {t("txDetail.chooseEditable")}
              </option>
              {editableCategories.map((category: CategoryReadModel) => (
                <option key={category.id} value={category.id}>
                  {categoryDisplayName(category, t)}
                </option>
              ))}
            </select>
          </label>
          <div className="correction-actions">
            <button
              className="primary-action"
              disabled={pendingAction !== null}
              onClick={() => void correctCategory("TRANSACTION")}
              type="button"
            >
              {t("txDetail.onlyThisOne")}
            </button>
            <button
              disabled={pendingAction !== null || transaction.normalizedMerchant === null}
              onClick={() => void correctCategory("RULE")}
              type="button"
            >
              {t("txDetail.alwaysThisMerchant")}
            </button>
          </div>
          <p>{t("txDetail.ruleNote")}</p>
        </div>
      </section>

      <RawDetail transaction={transaction} />
      <ReimbursementEditor
        key={`${transaction.id}:${transaction.version}`}
        transaction={transaction}
        onSaved={async () => {
          await refresh();
          setNotice({ kind: "success", text: t("txDetail.offsetSaved") });
        }}
      />
      <AuditTrail categories={categoryNames} transaction={transaction} />

      {transaction.source === "MANUAL" && transaction.status === "POSTED" ? (
        <section aria-labelledby="manual-danger-heading" className="detail-section">
          <div className="detail-section-heading">
            <p>Destructive action</p>
            <h2 id="manual-danger-heading">{t("txDetail.dangerHeading")}</h2>
          </div>
          <p className="detail-muted">{t("txDetail.dangerBody")}</p>
          {confirmDelete ? (
            <div className="destructive-confirmation" role="alert">
              <strong>{t("txDetail.confirmTitle")}</strong>
              <p>{t("txDetail.confirmBody")}</p>
              <div>
                <button
                  disabled={pendingAction !== null}
                  onClick={() => setConfirmDelete(false)}
                  type="button"
                >
                  {t("txDetail.cancel")}
                </button>
                <button
                  disabled={pendingAction !== null}
                  onClick={() => void deleteManualTransaction()}
                  type="button"
                >
                  {t("txDetail.confirmDelete")}
                </button>
              </div>
            </div>
          ) : (
            <button className="danger-action" onClick={() => setConfirmDelete(true)} type="button">
              {t("txDetail.delete")}
            </button>
          )}
        </section>
      ) : null}
    </article>
  );
}
