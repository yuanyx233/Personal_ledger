import {
  subscriptionsResponseSchema,
  type SubscriptionMutation,
  type SubscriptionFields,
} from "@ledger/domain";
import {
  categoriesResponseSchema,
  sessionResponseSchema,
  type CategoriesResponse,
} from "@ledger/domain/api-contracts";
import { useEffect, useRef, useState } from "react";

type Data = ReturnType<typeof subscriptionsResponseSchema.parse> & {
  categories: CategoriesResponse["data"]["categories"];
};
type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: Data };
async function read<T>(url: string, schema: { parse(value: unknown): T }, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error("Subscription request failed.");
  return schema.parse(await response.json());
}

export function useSubscriptions() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      read("/api/v1/subscriptions", subscriptionsResponseSchema, controller.signal),
      read("/api/v1/categories", categoriesResponseSchema, controller.signal),
    ])
      .then(([subscriptions, categories]) => {
        if (!controller.signal.aborted)
          setState({
            status: "ready",
            data: { ...subscriptions, categories: categories.data.categories },
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [attempt]);

  async function save(
    input: (SubscriptionFields & { requestId: string }) | SubscriptionMutation,
    id?: string,
  ) {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const session = await read("/api/v1/session", sessionResponseSchema);
      const response = await fetch(
        `/api/v1/subscriptions${id ? `/${encodeURIComponent(id)}` : ""}`,
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": session.data.csrfToken },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        if (response.status === 409) {
          setAttempt((value) => value + 1);
          throw new Error("订阅已被更新，已重新加载，请核对后再提交。");
        }
        throw new Error(
          response.status === 422
            ? "请检查金额、支出类别和日期；编辑时不能将扣款日移到已处理日期之前。"
            : "未能确认保存结果，请刷新核对后重试。",
        );
      }
      const result = (await response.json()) as {
        data: { removedCount: number };
        meta: { catchUpPending: boolean };
      };
      setNotice({
        error: false,
        text:
          "action" in input && input.action === "CANCEL"
            ? `取消日期已保存，已删除 ${result.data.removedCount} 笔自动支出。`
            : "action" in input && input.action === "RESUME"
              ? "订阅已恢复，从新的开始日期记账。"
              : "订阅已保存。",
      });
      try {
        const updated = await read("/api/v1/subscriptions", subscriptionsResponseSchema);
        setState((current) =>
          current.status === "ready"
            ? { status: "ready", data: { ...current.data, ...updated } }
            : current,
        );
      } catch {
        setState({ status: "error" });
        setNotice({ error: false, text: "操作已保存，但列表刷新失败，请重新加载。" });
      }
      return true;
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "未能确认保存结果，请刷新核对后重试。",
      });
      return false;
    } finally {
      busy.current = false;
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
