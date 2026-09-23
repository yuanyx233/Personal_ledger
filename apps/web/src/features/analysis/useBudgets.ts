import { budgetsResponseSchema, type BudgetRecord, type BudgetSetting } from "@ledger/domain";
import { categoriesResponseSchema, type CategoriesResponse } from "@ledger/domain/api-contracts";
import { useEffect, useState } from "react";

import { readSession } from "../../lib/browser-api";

type BudgetData = { budgets: BudgetRecord[]; categories: CategoriesResponse["data"]["categories"] };
type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: BudgetData };

async function read<T>(url: string, schema: { parse(value: unknown): T }, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error("Budget request failed.");
  return schema.parse(await response.json());
}

export function useBudgets(month: string) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      read(`/api/v1/budgets?month=${month}`, budgetsResponseSchema, controller.signal),
      read("/api/v1/categories", categoriesResponseSchema, controller.signal),
    ])
      .then(([budgets, categories]) => {
        if (!controller.signal.aborted)
          setState({
            status: "ready",
            data: { budgets: budgets.data.budgets, categories: categories.data.categories },
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [month, attempt]);

  async function save(setting: BudgetSetting) {
    if (saving) return false;
    setSaving(true);
    setNotice(null);
    try {
      const session = await readSession();
      const response = await fetch("/api/v1/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.data.csrfToken },
        body: JSON.stringify(setting),
      });
      if (!response.ok) throw new Error("Budget save failed.");
      const updated = await read(`/api/v1/budgets?month=${month}`, budgetsResponseSchema);
      setState((current) =>
        current.status === "ready"
          ? { ...current, data: { ...current.data, budgets: updated.data.budgets } }
          : current,
      );
      setNotice({
        error: false,
        text: setting.amountMinor === null ? "预算已取消。" : "预算已保存。",
      });
      return true;
    } catch {
      setNotice({ error: true, text: "未能确认预算保存结果，请重试。" });
      return false;
    } finally {
      setSaving(false);
    }
  }
  return {
    state,
    saving,
    notice,
    save,
    retry: () => {
      setState({ status: "loading" });
      setAttempt((value) => value + 1);
    },
  };
}
