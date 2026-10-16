import {
  categoriesResponseSchema,
  categoryMutationResponseSchema,
  type CategoriesResponse,
  type ManualTransactionPreviewResponse,
} from "@ledger/domain/api-contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { readApi, writeApi } from "../../lib/browser-api";
import { CategorySearch } from "./CategorySearch";
import { useTranslation } from "../../i18n/useTranslation";

type Category = CategoriesResponse["data"]["categories"][number];
type SuggestedCategory = ManualTransactionPreviewResponse["data"]["category"];

function selectableExpenseCategories(categories: Category[]) {
  return categories.filter(
    ({ active, editable, kind, systemKey }) =>
      active && editable && kind === "EXPENSE" && systemKey !== "UNCLASSIFIED",
  );
}

export function NewMerchantConfirmation({
  confirmEveryTime,
  matchedMerchant,
  merchant,
  onCancel,
  onConfirm,
  suggestedCategory,
}: {
  confirmEveryTime: boolean;
  matchedMerchant: string | null;
  merchant: string;
  onCancel: () => void;
  onConfirm: (category: Category) => Promise<void>;
  suggestedCategory: SuggestedCategory;
}) {
  const { t } = useTranslation();
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
      setActionError(t("merchant.createFailed"));
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
      setActionError(t("merchant.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-labelledby="merchant-confirmation-title"
      className="quick-merchant-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialogRef}
    >
      <section className="quick-category-confirmation">
        <p className="quick-entry-saved">
          {confirmEveryTime ? t("merchant.eyebrow.multi") : t("merchant.eyebrow.new")}
        </p>
        <h2 id="merchant-confirmation-title" ref={headingRef} tabIndex={-1}>
          {confirmEveryTime ? t("merchant.title.multi") : t("merchant.title.new")}
        </h2>
        <p>
          <strong>{merchant}</strong>{" "}
          {t("merchant.suggestion", { category: suggestedCategory.name })}{" "}
          {confirmEveryTime ? t("merchant.suffix.confirmEveryTime") : t("merchant.suffix.remember")}
        </p>
        {matchedMerchant ? <p>{t("merchant.matchedBy", { merchant: matchedMerchant })}</p> : null}

        {status === "loading" ? <p role="status">{t("merchant.loadingCategories")}</p> : null}
        {status === "error" ? (
          <div className="quick-category-error" role="alert">
            <p>{t("merchant.categoriesFailed")}</p>
            <button
              onClick={() => {
                setStatus("loading");
                void loadCategories();
              }}
              type="button"
            >
              {t("merchant.retry")}
            </button>
          </div>
        ) : null}
        {status === "ready" ? (
          <>
            <label className="quick-category-select">
              {t("merchant.category")}
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
              triggerLabel={t("merchant.searchPlaceholder")}
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
            {t("merchant.cancel")}
          </button>
          <button
            className="primary-action"
            disabled={busy || status !== "ready"}
            onClick={() => void confirm()}
            type="button"
          >
            {busy ? t("merchant.confirming") : t("merchant.confirm")}
          </button>
        </div>
      </section>
    </dialog>
  );
}
