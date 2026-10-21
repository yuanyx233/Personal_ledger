import type { SpendingReportSection } from "@ledger/domain";
import { useState } from "react";

import { LEDGER_CURRENCIES } from "../../lib/app-config";

import { BudgetRow } from "./BudgetRow";
import { useBudgets } from "./useBudgets";
import { useTranslation } from "../../i18n/useTranslation";

export function MonthlyBudgets({
  month,
  sections,
}: {
  month: string;
  sections: SpendingReportSection[];
}) {
  const { t } = useTranslation();
  const { state, saving, notice, save, retry } = useBudgets(month);
  const [currency, setCurrency] = useState(sections[0]?.currency ?? LEDGER_CURRENCIES[0]!);
  const currencies = [
    ...new Set([
      ...LEDGER_CURRENCIES,
      ...sections.map((section) => section.currency),
      ...(state.status === "ready" ? state.data.budgets.map((budget) => budget.currency) : []),
    ]),
  ].sort();
  const spending =
    sections.find((section) => section.currency === currency)?.categoryDistribution ?? [];

  return (
    <section className="analysis-block monthly-budgets" aria-labelledby="monthly-budgets-title">
      <div className="analysis-block-heading">
        <div>
          <p>{t("bud.allAccounts", { month })}</p>
          <h2 id="monthly-budgets-title">{t("bud.title")}</h2>
        </div>
        <label>
          {t("bud.currency")}
          <select
            disabled={saving}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {currencies.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="budget-help">{t("bud.carryNote", { month })}</p>
      <p className="budget-help">{t("bud.spentNote")}</p>
      {notice ? (
        <p
          className={`detail-notice${notice.error ? " detail-notice--error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {state.status === "loading" ? (
        <p role="status">{t("bud.loading")}</p>
      ) : state.status === "error" ? (
        <div role="alert">
          <p>{t("bud.failed")}</p>
          <button className="secondary-action" onClick={retry} type="button">
            {t("bud.retry")}
          </button>
        </div>
      ) : (
        <>
          {state.data.categories.some((category) => category.kind === "EXPENSE") ? (
            <ul className="budget-list">
              {state.data.categories
                .filter(
                  (category) =>
                    category.kind === "EXPENSE" &&
                    (category.active ||
                      state.data.budgets.some(
                        (budget) =>
                          budget.categoryId === category.id &&
                          budget.currency === currency &&
                          budget.amountMinor !== null,
                      ) ||
                      spending.some((row) => row.categoryId === category.id)),
                )
                .map((category) => (
                  <BudgetRow
                    key={`${category.id}-${currency}`}
                    categoryId={category.id}
                    name={category.name}
                    currency={currency}
                    month={month}
                    spent={
                      spending.find((row) => row.categoryId === category.id)?.netSpendingMinor ?? 0
                    }
                    limit={
                      state.data.budgets.find(
                        (budget) =>
                          budget.categoryId === category.id && budget.currency === currency,
                      )?.amountMinor ?? null
                    }
                    editable={category.active}
                    saving={saving}
                    onSave={save}
                  />
                ))}
            </ul>
          ) : (
            <p>{t("bud.noCategories")}</p>
          )}
        </>
      )}
    </section>
  );
}
