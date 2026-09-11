import {
  categoriesResponseSchema,
  categoryMutationResponseSchema,
  type CategoriesResponse,
  type ManualTransactionPreviewResponse,
} from "@ledger/domain/api-contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { readApi, writeApi } from "../../lib/browser-api";
import { CategorySearch } from "./CategorySearch";

type Category = CategoriesResponse["data"]["categories"][number];
type SuggestedCategory = ManualTransactionPreviewResponse["data"]["category"];

function selectableExpenseCategories(categories: Category[]) {
  return categories.filter(
    ({ active, editable, kind, systemKey }) =>
      active && editable && kind === "EXPENSE" && systemKey !== "UNCLASSIFIED",
  );
}

export function NewMerchantConfirmation({
  merchant,
  onCancel,
  onConfirm,
  suggestedCategory,
}: {
  merchant: string;
  onCancel: () => void;
  onConfirm: (category: Category) => Promise<void>;
  suggestedCategory: SuggestedCategory;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(suggestedCategory.id);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function loadCategories(signal?: AbortSignal) {
    try {
      const response = await readApi("/api/v1/categories", categoriesResponseSchema, signal);
      setCategories(selectableExpenseCategories(response.data.categories));
      setStatus("ready");
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("error");
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    headingRef.current?.focus();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readApi("/api/v1/categories", categoriesResponseSchema, controller.signal)
      .then((response) => {
        setCategories(selectableExpenseCategories(response.data.categories));
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const listedCategories = useMemo(() => {
    if (categories.some(({ id }) => id === suggestedCategory.id)) return categories;
    return [suggestedCategory, ...categories];
  }, [categories, suggestedCategory]);

  async function createCategory(name: string): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      const result = await writeApi(
        "/api/v1/categories",
        "POST",
        { kind: "EXPENSE", name },
        categoryMutationResponseSchema,
      );
      setCategories((current) => [...current, result.data.category]);
      setSelectedCategoryId(result.data.category.id);
      return true;
    } catch {
      setActionError("没有创建类别。若名称已存在，请刷新类别列表后重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const selectedCategory = listedCategories.find(({ id }) => id === selectedCategoryId);
    if (!selectedCategory) return;
    setBusy(true);
    setActionError(null);
    try {
      await onConfirm(selectedCategory);
    } catch {
      setActionError("尚未录入。请重试；你的金额、商户和分类选择都已保留。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-labelledby="new-merchant-title"
      className="quick-merchant-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialogRef}
    >
      <section className="quick-category-confirmation">
        <p className="quick-entry-saved">新商户 · 尚未写入</p>
        <h2 id="new-merchant-title" ref={headingRef} tabIndex={-1}>
          确认新商户
        </h2>
        <p>
          <strong>{merchant}</strong> 建议归为“{suggestedCategory.name}
          ”。确认后才会录入，并记住以后相同商户的分类。
        </p>

        {status === "loading" ? <p role="status">正在加载分类列表…</p> : null}
        {status === "error" ? (
          <div className="quick-category-error" role="alert">
            <p>分类列表暂时没有加载成功；这笔交易尚未写入。</p>
            <button
              onClick={() => {
                setStatus("loading");
                void loadCategories();
              }}
              type="button"
            >
              重试
            </button>
          </div>
        ) : null}
        {status === "ready" ? (
          <>
            <label className="quick-category-select">
              分类
              <select
                disabled={busy}
                onChange={(event) => setSelectedCategoryId(event.currentTarget.value)}
                value={selectedCategoryId}
              >
                {listedCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <CategorySearch
              busy={busy}
              categories={listedCategories}
              onChoose={(category) => setSelectedCategoryId(category.id)}
              onCreate={createCategory}
              triggerLabel="搜索或创建类别…"
            />
          </>
        ) : null}

        {actionError ? (
          <p className="detail-notice detail-notice--error" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="quick-merchant-actions">
          <button disabled={busy} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="primary-action"
            disabled={busy || status !== "ready"}
            onClick={() => void confirm()}
            type="button"
          >
            {busy ? "正在录入…" : "确认并录入"}
          </button>
        </div>
      </section>
    </dialog>
  );
}
