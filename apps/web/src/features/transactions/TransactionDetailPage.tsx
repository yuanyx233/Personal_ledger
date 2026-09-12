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
import { formatMoney } from "../overview/overview-data";
import { useTransactionDetail } from "./useTransactionDetail";
import { ReimbursementEditor } from "./ReimbursementEditor";

type Transaction = TransactionDetailResponse["data"]["transaction"];

const CATEGORY_SOURCE_LABELS = {
  MANUAL: "人工",
  PLAID: "历史银行分类",
  RULE: "我的规则",
  UNCLASSIFIED: "未分类",
} as const;
const STATUS_LABELS = { PENDING: "待入账", POSTED: "已入账", REMOVED: "已移除" } as const;
function displayValue(value: string | null) {
  return value || "—";
}

function signedAmount(transaction: Transaction) {
  const amountMinor = Number(transaction.amountMinor);
  const amount = transaction.direction === "OUTFLOW" ? -amountMinor : amountMinor;
  return formatMoney(amount, transaction.currency);
}

function DetailHeader({ transaction }: { transaction?: Transaction }) {
  return (
    <header className="page-header transaction-detail-header">
      <p className="page-kicker">原始记录 · 可追溯修改</p>
      <h1>交易详情</h1>
      <p className="page-description">
        {transaction
          ? `${signedAmount(transaction)} · ${STATUS_LABELS[transaction.status]} · ${transaction.postedDate}`
          : "查看原始字段、分类来路与经过审计的人工决定。"}
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

function mutationErrorMessage(error: unknown) {
  if (error instanceof BrowserApiError && error.status === 409) {
    return "这笔数据刚刚发生变化，请刷新后重试。";
  }
  if (error instanceof BrowserApiError && error.status === 422) {
    return "所选操作不适用于当前交易，请检查类别或当前状态。";
  }
  return "操作没有保存。请检查网络后重试。";
}

function AuditTrail({
  categories,
  transaction,
}: {
  categories: Map<string, string>;
  transaction: Transaction;
}) {
  return (
    <section aria-labelledby="category-audit-heading" className="detail-section">
      <div className="detail-section-heading">
        <p>Append-only</p>
        <h2 id="category-audit-heading">分类审计</h2>
      </div>
      {transaction.categoryAudits.length === 0 ? (
        <p className="detail-muted">尚无分类变更记录。</p>
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
                  ? (categories.get(audit.oldCategoryId) ?? "未知类别")
                  : "无类别"}
                {" → "}
                {audit.newCategoryId
                  ? (categories.get(audit.newCategoryId) ?? "未知类别")
                  : "无类别"}
              </span>
              <span>
                {CATEGORY_SOURCE_LABELS[audit.oldSource]} →{" "}
                {CATEGORY_SOURCE_LABELS[audit.newSource]}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RawDetail({ transaction }: { transaction: Transaction }) {
  const fields = [
    ["原始描述", transaction.description],
    ["商户", displayValue(transaction.merchantName)],
    ["规范化商户", displayValue(transaction.normalizedMerchant)],
    ["账户", transaction.accountLabel ?? "—"],
    ["授权日期", displayValue(transaction.authorizedDate)],
    ["入账日期", transaction.postedDate],
    [
      "分期",
      transaction.installment
        ? `第 ${transaction.installment.number}/${transaction.installment.count} 期`
        : "—",
    ],
    ["收款方", displayValue(transaction.paymentMetadata.payee)],
    ["付款方", displayValue(transaction.paymentMetadata.payer)],
    ["支付方式", displayValue(transaction.paymentMetadata.paymentMethod)],
    ["参考号", displayValue(transaction.paymentMetadata.referenceNumber)],
    ["Pending 前身", displayValue(transaction.lifecycle.pendingTransactionId)],
    ["Posted 后继", displayValue(transaction.lifecycle.replacedByTransactionId)],
  ] as const;

  return (
    <section aria-labelledby="raw-detail-heading" className="detail-section">
      <div className="detail-section-heading">
        <p>Bank record</p>
        <h2 id="raw-detail-heading">原始字段</h2>
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
      setNotice({ kind: "error", text: "请先选择一个新类别。" });
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
        text:
          scope === "RULE"
            ? "已保存未来的精确商户规则；历史交易没有被批量修改。"
            : "已只修改当前交易。",
      });
    } catch (error: unknown) {
      setNotice({ kind: "error", text: mutationErrorMessage(error) });
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
      setNotice({ kind: "success", text: "手工交易已标记为移除，并从正常报表中排除。" });
    } catch (error: unknown) {
      setNotice({ kind: "error", text: mutationErrorMessage(error) });
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
        ← 返回交易列表
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
          <h2 id="classification-heading">当前分类</h2>
        </div>
        <dl className="classification-summary">
          <div>
            <dt>类别</dt>
            <dd>
              {transaction.categoryId
                ? (categoryNames.get(transaction.categoryId) ?? "未知类别")
                : "未分类"}
            </dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>
              {transaction.categorizationSource === "RULE" && transaction.categoryRuleId === null
                ? "自动识别商户"
                : CATEGORY_SOURCE_LABELS[transaction.categorizationSource]}
            </dd>
          </div>
          <div>
            <dt>规则 ID</dt>
            <dd>{displayValue(transaction.categoryRuleId)}</dd>
          </div>
          <div>
            <dt>复核原因</dt>
            <dd>{displayValue(transaction.reviewReason)}</dd>
          </div>
        </dl>
        <div className="correction-form">
          <label>
            新类别
            <select
              onChange={(event) => setSelectedCategoryId(event.currentTarget.value)}
              value={selectedCategoryId}
            >
              <option disabled value="">
                选择可编辑类别
              </option>
              {editableCategories.map((category: CategoryReadModel) => (
                <option key={category.id} value={category.id}>
                  {category.name}
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
              只改这一笔
            </button>
            <button
              disabled={pendingAction !== null || transaction.normalizedMerchant === null}
              onClick={() => void correctCategory("RULE")}
              type="button"
            >
              以后这个商户都这样
            </button>
          </div>
          <p>
            导入时优先匹配精确规则；已识别的同品牌商户在规则一致时沿用分类。既有历史交易保持不变。
          </p>
        </div>
      </section>

      <RawDetail transaction={transaction} />
      <ReimbursementEditor
        key={`${transaction.id}:${transaction.version}`}
        transaction={transaction}
        onSaved={async () => {
          await refresh();
          setNotice({ kind: "success", text: "抵扣已保存，统计已更新。" });
        }}
      />
      <AuditTrail categories={categoryNames} transaction={transaction} />

      {transaction.source === "MANUAL" && transaction.status === "POSTED" ? (
        <section aria-labelledby="manual-danger-heading" className="detail-section">
          <div className="detail-section-heading">
            <p>Destructive action</p>
            <h2 id="manual-danger-heading">删除手工交易</h2>
          </div>
          <p className="detail-muted">
            删除会把这笔手工交易标记为已移除，并从正常报表中排除；该操作不会修改任何银行数据。
          </p>
          {confirmDelete ? (
            <div className="destructive-confirmation" role="alert">
              <strong>确认删除这笔手工交易？</strong>
              <p>金额、日期与描述将不再计入账本正常视图。发生版本冲突时不会删除。</p>
              <div>
                <button
                  disabled={pendingAction !== null}
                  onClick={() => setConfirmDelete(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  disabled={pendingAction !== null}
                  onClick={() => void deleteManualTransaction()}
                  type="button"
                >
                  确认删除
                </button>
              </div>
            </div>
          ) : (
            <button className="danger-action" onClick={() => setConfirmDelete(true)} type="button">
              删除这笔手工交易
            </button>
          )}
        </section>
      ) : null}
    </article>
  );
}
