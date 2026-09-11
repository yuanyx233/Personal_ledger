import {
  categoriesResponseSchema,
  categoryMutationResponseSchema,
  categorySuggestionsResponseSchema,
  merchantRuleCorrectionResponseSchema,
  type CategoriesResponse,
  type ManualTransactionReadModel,
} from "@ledger/domain/api-contracts";
import { useEffect, useRef, useState } from "react";

import { readApi, writeApi } from "../../lib/browser-api";
import { CategorySearch } from "./CategorySearch";

type Category = CategoriesResponse["data"]["categories"][number];
type Transaction = ManualTransactionReadModel;

type CategoryState =
  | { status: "error" }
  | { status: "loading" }
  | {
      categories: Category[];
      status: "ready";
      suggestions: Category[];
    };

async function readConfirmationData(transactionId: string, signal?: AbortSignal) {
  const [suggestions, taxonomy] = await Promise.all([
    readApi(
      `/api/v1/transactions/${encodeURIComponent(transactionId)}/category-suggestions`,
      categorySuggestionsResponseSchema,
      signal,
    ),
    readApi("/api/v1/categories", categoriesResponseSchema, signal),
  ]);
  return {
    categories: taxonomy.data.categories,
    status: "ready" as const,
    suggestions: suggestions.data.suggestions.slice(0, 2).map(({ category }) => category),
  };
}

export function CategoryConfirmation({
  onComplete,
  onDefer,
  transaction,
}: {
  onComplete: (categoryName: string) => void;
  onDefer: () => void;
  transaction: Transaction;
}) {
  const [state, setState] = useState<CategoryState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function load(signal?: AbortSignal) {
    try {
      setState(await readConfirmationData(transaction.id, signal));
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setState({ status: "error" });
      }
    }
  }

  useEffect(() => {
    headingRef.current?.focus();
    const controller = new AbortController();
    void readConfirmationData(transaction.id, controller.signal)
      .then(setState)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [transaction.id]);

  async function learnCategory(category: Category) {
    setBusy(true);
    setActionError(null);
    try {
      await writeApi(
        `/api/v1/transactions/${encodeURIComponent(transaction.id)}/merchant-rule`,
        "PUT",
        { categoryId: category.id, version: transaction.version },
        merchantRuleCorrectionResponseSchema,
      );
      onComplete(category.name);
    } catch {
      setActionError("分类没有保存，请重试；这笔流水已保留，可稍后在交易列表中分类。");
    } finally {
      setBusy(false);
    }
  }

  async function createAndLearnCategory(name: string): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    let created = false;
    try {
      const result = await writeApi(
        "/api/v1/categories",
        "POST",
        { kind: "EXPENSE", name },
        categoryMutationResponseSchema,
      );
      created = true;
      await writeApi(
        `/api/v1/transactions/${encodeURIComponent(transaction.id)}/merchant-rule`,
        "PUT",
        { categoryId: result.data.category.id, version: transaction.version },
        merchantRuleCorrectionResponseSchema,
      );
      onComplete(result.data.category.name);
      return true;
    } catch {
      setActionError(
        created
          ? "类别已创建，但这笔分类尚未完成；请从搜索结果中选择它重试。"
          : "没有创建类别。若名称已存在，请从搜索结果中选择已有类别。",
      );
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="quick-category-title" className="quick-category-confirmation">
      <p className="quick-entry-saved">交易已保存 · 当前为未分类</p>
      <h2 id="quick-category-title" ref={headingRef} tabIndex={-1}>
        确认这笔的类别
      </h2>
      <p>选好后会同时记住这个商户，下次无需再确认。</p>

      {state.status === "loading" ? <p role="status">正在准备类别…</p> : null}
      {state.status === "error" ? (
        <div className="quick-category-error" role="alert">
          <p>类别暂时没有加载成功；交易已经保存，不会丢失。</p>
          <button
            onClick={() => {
              setState({ status: "loading" });
              void load();
            }}
            type="button"
          >
            重试
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <>
          {state.suggestions.length > 0 ? (
            <div aria-label="建议类别" className="quick-category-suggestions" role="group">
              {state.suggestions.map((category) => (
                <button
                  disabled={busy}
                  key={category.id}
                  onClick={() => void learnCategory(category)}
                  type="button"
                >
                  {category.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="quick-category-empty">暂时没有合适建议，请从其他类别中选择。</p>
          )}

          <CategorySearch
            busy={busy}
            categories={state.categories}
            onChoose={(category) => void learnCategory(category)}
            onCreate={createAndLearnCategory}
          />
        </>
      ) : null}

      {actionError ? (
        <p className="detail-notice detail-notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      <button className="quick-category-defer" disabled={busy} onClick={onDefer} type="button">
        稍后确认
      </button>
    </section>
  );
}
