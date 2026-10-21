import {
  merchantRuleMutationResponseSchema,
  merchantRulePreviewResponseSchema,
  type CategoriesResponse,
  type MerchantRuleListResponse,
  type MerchantRulePreviewResponse,
} from "@ledger/domain/api-contracts";
import { useState, type FormEvent } from "react";

import { readApi, writeApi } from "../../lib/browser-api";
import { useTranslation } from "../../i18n/useTranslation";
import { categoryDisplayName } from "../../i18n/categoryName";

type Category = CategoriesResponse["data"]["categories"][number];
type Rule = MerchantRuleListResponse["data"]["rules"][number];

export function RuleSettings({
  categories,
  refresh,
  rules,
}: {
  categories: Category[];
  refresh: () => Promise<void>;
  rules: Rule[];
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<MerchantRulePreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRuleId, setConfirmRuleId] = useState<string | null>(null);
  const targets = categories.filter(
    ({ active, editable, systemKey }) => active && (editable || systemKey === "TRANSFER"),
  );

  async function previewRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayMerchant = form.get("displayMerchant");
    const categoryId = form.get("categoryId");
    if (typeof displayMerchant !== "string" || typeof categoryId !== "string") return;
    setBusy(true);
    setNotice(null);
    try {
      const query = new URLSearchParams({ categoryId, displayMerchant });
      setPreview(
        await readApi(`/api/v1/merchant-rule-previews?${query}`, merchantRulePreviewResponseSchema),
      );
    } catch {
      setNotice(t("rules.previewFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function savePreview() {
    if (!preview) return;
    setBusy(true);
    try {
      await writeApi(
        "/api/v1/merchant-rules",
        "POST",
        preview.data.proposedRule,
        merchantRuleMutationResponseSchema,
      );
      setPreview(null);
      setNotice(t("rules.saved"));
      await refresh();
      setConfirmRuleId(null);
    } catch {
      setNotice(t("rules.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function updateRule(rule: Rule, input: { active?: boolean; categoryId?: string }) {
    setBusy(true);
    try {
      await writeApi(
        `/api/v1/merchant-rules/${encodeURIComponent(rule.id)}`,
        "PATCH",
        { ...input, version: rule.version },
        merchantRuleMutationResponseSchema,
      );
      setNotice(t("rules.updated"));
      await refresh();
      setConfirmRuleId(null);
    } catch {
      setNotice(t("rules.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="settings-form" onSubmit={(event) => void previewRule(event)}>
        <label>
          {t("rules.displayName")}
          <input name="displayMerchant" required />
        </label>
        <label>
          {t("rules.futureCategory")}
          <select name="categoryId" required>
            {targets.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryDisplayName(category, t)}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-action" disabled={busy || targets.length === 0} type="submit">
          {t("rules.preview")}
        </button>
      </form>
      {preview ? (
        <div className="settings-preview" role="status">
          <strong>
            {t("rules.normalizedKey", { key: preview.data.proposedRule.normalizedMerchant })}
          </strong>
          <p>
            {t("rules.matchSummary", {
              conflicting: preview.meta.conflictingTransactions,
              matching: preview.meta.matchingTransactions,
            })}
          </p>
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void savePreview()}
            type="button"
          >
            {t("rules.confirmSave")}
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="detail-notice" role="status">
          {notice}
        </p>
      ) : null}
      <ul className="settings-rule-list">
        {rules.map((rule) => (
          <li key={rule.id}>
            <div>
              <strong>{rule.displayMerchant}</strong>
              <span>exact key · {rule.normalizedMerchant}</span>
            </div>
            <select
              aria-label={t("rules.categoryFor", { merchant: rule.displayMerchant })}
              defaultValue={rule.categoryId}
              disabled={busy || !rule.active}
              onChange={(event) => void updateRule(rule, { categoryId: event.target.value })}
            >
              {targets.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryDisplayName(category, t)}
                </option>
              ))}
            </select>
            {confirmRuleId === rule.id ? (
              <div className="destructive-confirmation" role="alert">
                <strong>{t("rules.confirmDisableTitle")}</strong>
                <p>{t("rules.confirmDisableBody")}</p>
                <div>
                  <button onClick={() => setConfirmRuleId(null)} type="button">
                    {t("rules.cancel")}
                  </button>
                  <button onClick={() => void updateRule(rule, { active: false })} type="button">
                    {t("rules.confirmDisable")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                disabled={busy || !rule.active}
                onClick={() => setConfirmRuleId(rule.id)}
                type="button"
              >
                {rule.active ? t("rules.disable") : t("rules.disabled")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
