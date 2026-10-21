import type { FormEvent } from "react";

import { LEDGER_CURRENCIES } from "../../lib/app-config";

import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { TransactionViews } from "./TransactionViews";
import { useTransactions } from "./useTransactions";
import { useTranslation } from "../../i18n/useTranslation";

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
  const { t } = useTranslation();
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
        <p className="page-kicker">{t("txList.kicker")}</p>
        <h1>{t(route.labelKey)}</h1>
        <p className="page-description">{t(route.descriptionKey)}</p>
      </header>

      <form className="transaction-filters" key={search.toString()} onSubmit={applyFilters}>
        <label>
          {t("txList.filter.status")}
          <select defaultValue={search.get("status") ?? ""} name="status">
            <option value="">{t("txList.filter.all")}</option>
            <option value="POSTED">{t("tx.status.POSTED")}</option>
            <option value="PENDING">{t("tx.status.PENDING")}</option>
            <option value="REMOVED">{t("tx.status.REMOVED")}</option>
          </select>
        </label>
        <label>
          {t("txList.filter.source")}
          <select defaultValue={search.get("source") ?? ""} name="source">
            <option value="">{t("txList.filter.all")}</option>
            <option value="MANUAL">{t("tx.source.MANUAL")}</option>
            <option value="CSV">CSV</option>
          </select>
        </label>
        <label>
          {t("txList.filter.catSource")}
          <select
            defaultValue={search.get("categorizationSource") ?? ""}
            name="categorizationSource"
          >
            <option value="">{t("txList.filter.all")}</option>
            <option value="MANUAL">{t("txList.filter.catSource.manual")}</option>
            <option value="RULE">{t("txList.filter.catSource.rule")}</option>
            <option value="UNCLASSIFIED">{t("txList.filter.unclassified")}</option>
          </select>
        </label>
        <label>
          {t("txList.filter.unclassified")}
          <select defaultValue={search.get("needsReview") ?? ""} name="needsReview">
            <option value="">{t("txList.filter.all")}</option>
            <option value="true">{t("txList.filter.needsCategory")}</option>
            <option value="false">{t("txList.filter.no")}</option>
          </select>
        </label>
        <label>
          {t("txList.filter.currency")}
          <select defaultValue={search.get("currency") ?? ""} name="currency">
            <option value="">{t("txList.filter.all")}</option>
            {LEDGER_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("txList.filter.sort")}
          <select defaultValue={search.get("sort") ?? "POSTED_DATE_DESC"} name="sort">
            <option value="POSTED_DATE_DESC">{t("txList.sort.dateDesc")}</option>
            <option value="POSTED_DATE_ASC">{t("txList.sort.dateAsc")}</option>
            <option value="AMOUNT_DESC">{t("txList.sort.amountDesc")}</option>
            <option value="AMOUNT_ASC">{t("txList.sort.amountAsc")}</option>
          </select>
        </label>
        <details>
          <summary>{t("txList.moreFilters")}</summary>
          <div className="advanced-filters">
            <label>
              {t("txList.dateFrom")}
              <input defaultValue={search.get("dateFrom") ?? ""} name="dateFrom" type="date" />
            </label>
            <label>
              {t("txList.dateTo")}
              <input defaultValue={search.get("dateTo") ?? ""} name="dateTo" type="date" />
            </label>
            <label>
              {t("txList.accountId")}
              <input defaultValue={search.get("accountId") ?? ""} name="accountId" />
            </label>
            <label>
              {t("txList.categoryId")}
              <input defaultValue={search.get("categoryId") ?? ""} name="categoryId" />
            </label>
          </div>
        </details>
        <div className="filter-actions">
          <button className="primary-action" type="submit">
            {t("txList.apply")}
          </button>
          <a href="/transactions">{t("txList.clear")}</a>
        </div>
      </form>

      {!online ? (
        <DataState variant="offline" />
      ) : state.status === "loading" ? (
        <DataState variant="loading" />
      ) : state.status === "error" ? (
        <DataState variant="error" />
      ) : state.data.data.transactions.length === 0 ? (
        <DataState title={t("txList.empty")} variant="empty" />
      ) : (
        <section aria-label={t("txList.results")} className="transaction-results">
          <TransactionViews transactions={state.data.data.transactions} />
          <nav aria-label={t("txList.pagination")} className="transaction-pagination">
            <button
              disabled={!search.has("cursor")}
              onClick={() => window.history.back()}
              type="button"
            >
              {t("txList.previous")}
            </button>
            <button disabled={!state.data.meta.hasMore} onClick={nextPage} type="button">
              {t("txList.next")}
            </button>
          </nav>
        </section>
      )}
    </div>
  );
}
