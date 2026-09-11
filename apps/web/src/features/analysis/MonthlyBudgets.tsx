import type { SpendingReportSection } from "@ledger/domain";
import { useState } from "react";

import { BudgetRow } from "./BudgetRow";
import { useBudgets } from "./useBudgets";

export function MonthlyBudgets({
  month,
  sections,
}: {
  month: string;
  sections: SpendingReportSection[];
}) {
  const { state, saving, notice, save, retry } = useBudgets(month);
  const [currency, setCurrency] = useState(sections[0]?.currency ?? "CAD");
  const currencies = [
    ...new Set([
      "CAD",
      "USD",
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
          <p>{month} · 全部账户</p>
          <h2 id="monthly-budgets-title">Goal · 月度预算上限</h2>
        </div>
        <label>
          预算币种
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
      <p className="budget-help">
        设置从 {month}{" "}
        起每月沿用，直到下一次设置；更早月份和已单独设置的后续月份不变。额度每月重新计算。
      </p>
      <p className="budget-help">
        已花金额为扣除退款、分摊和报销抵扣后的个人净支出，不含转账。各币种分别计算。
      </p>
      {notice ? (
        <p
          className={`detail-notice${notice.error ? " detail-notice--error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {state.status === "loading" ? (
        <p role="status">正在读取预算…</p>
      ) : state.status === "error" ? (
        <div role="alert">
          <p>预算暂时无法读取。</p>
          <button className="secondary-action" onClick={retry} type="button">
            重试预算
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
            <p>还没有支出类别，请先在记一笔中创建类别。</p>
          )}
        </>
      )}
    </section>
  );
}
