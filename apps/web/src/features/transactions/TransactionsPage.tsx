import type { FormEvent } from "react";

import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { TransactionViews } from "./TransactionViews";
import { useTransactions } from "./useTransactions";

const FILTER_KEYS = [
  "accountId",
  "categorizationSource",
  "categoryId",
  "currency",
  "dateFrom",
  "dateTo",
  "needsReview",
  "source",
  "status",
  "sort",
] as const;

export function TransactionsPage({ online, route }: { online: boolean; route: AppRoute }) {
  const { navigate, search, state } = useTransactions();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parameters = new URLSearchParams(search);
    parameters.delete("cursor");
    parameters.delete("pageSize");
    for (const key of FILTER_KEYS) {
      parameters.delete(key);
      const value = form.get(key);
      if (typeof value === "string" && value) parameters.set(key, value);
    }
    navigate(parameters);
  }

  function nextPage() {
    if (state.status !== "ready" || !state.data.meta.nextCursor) return;
    const parameters = new URLSearchParams(search);
    parameters.set("cursor", state.data.meta.nextCursor);
    navigate(parameters);
  }

  return (
    <div className="route-content transactions-page">
      <header className="page-header">
        <p className="page-kicker">统一账本 · URL 可复现</p>
        <h1>{route.label}</h1>
        <p className="page-description">{route.description}</p>
      </header>

      <form className="transaction-filters" key={search.toString()} onSubmit={applyFilters}>
        <label>
          状态
          <select defaultValue={search.get("status") ?? ""} name="status">
            <option value="">全部</option>
            <option value="POSTED">已入账</option>
            <option value="PENDING">待入账</option>
            <option value="REMOVED">已移除</option>
          </select>
        </label>
        <label>
          来源
          <select defaultValue={search.get("source") ?? ""} name="source">
            <option value="">全部</option>
            <option value="MANUAL">手工</option>
            <option value="CSV">CSV</option>
          </select>
        </label>
        <label>
          分类来源
          <select
            defaultValue={search.get("categorizationSource") ?? ""}
            name="categorizationSource"
          >
            <option value="">全部</option>
            <option value="MANUAL">人工</option>
            <option value="RULE">规则</option>
            <option value="UNCLASSIFIED">未分类</option>
          </select>
        </label>
        <label>
          未分类
          <select defaultValue={search.get("needsReview") ?? ""} name="needsReview">
            <option value="">全部</option>
            <option value="true">需要分类</option>
            <option value="false">否</option>
          </select>
        </label>
        <label>
          币种
          <select defaultValue={search.get("currency") ?? ""} name="currency">
            <option value="">全部</option>
            <option value="CAD">CAD</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label>
          排序
          <select defaultValue={search.get("sort") ?? "POSTED_DATE_DESC"} name="sort">
            <option value="POSTED_DATE_DESC">日期：新到旧</option>
            <option value="POSTED_DATE_ASC">日期：旧到新</option>
            <option value="AMOUNT_DESC">金额：高到低</option>
            <option value="AMOUNT_ASC">金额：低到高</option>
          </select>
        </label>
        <details>
          <summary>更多筛选</summary>
          <div className="advanced-filters">
            <label>
              起始日期
              <input defaultValue={search.get("dateFrom") ?? ""} name="dateFrom" type="date" />
            </label>
            <label>
              结束日期
              <input defaultValue={search.get("dateTo") ?? ""} name="dateTo" type="date" />
            </label>
            <label>
              账户 ID
              <input defaultValue={search.get("accountId") ?? ""} name="accountId" />
            </label>
            <label>
              分类 ID
              <input defaultValue={search.get("categoryId") ?? ""} name="categoryId" />
            </label>
          </div>
        </details>
        <div className="filter-actions">
          <button className="primary-action" type="submit">
            应用筛选
          </button>
          <a href="/transactions">清除</a>
        </div>
      </form>

      {!online ? (
        <DataState variant="offline" />
      ) : state.status === "loading" ? (
        <DataState variant="loading" />
      ) : state.status === "error" ? (
        <DataState variant="error" />
      ) : state.data.data.transactions.length === 0 ? (
        <DataState title="没有符合筛选条件的交易" variant="empty" />
      ) : (
        <section aria-label="交易结果" className="transaction-results">
          <TransactionViews transactions={state.data.data.transactions} />
          <nav aria-label="交易分页" className="transaction-pagination">
            <button
              disabled={!search.has("cursor")}
              onClick={() => window.history.back()}
              type="button"
            >
              上一页
            </button>
            <button disabled={!state.data.meta.hasMore} onClick={nextPage} type="button">
              下一页
            </button>
          </nav>
        </section>
      )}
    </div>
  );
}
