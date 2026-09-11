import {
  merchantRuleMutationResponseSchema,
  merchantRulePreviewResponseSchema,
  type CategoriesResponse,
  type MerchantRuleListResponse,
  type MerchantRulePreviewResponse,
} from "@ledger/domain/api-contracts";
import { useState, type FormEvent } from "react";

import { readApi, writeApi } from "../../lib/browser-api";

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
      setNotice("规则预览失败，请重试。");
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
      setNotice("未来商户规则已保存；历史交易没有改变。");
      await refresh();
      setConfirmRuleId(null);
    } catch {
      setNotice("规则保存失败，可能已有相同 exact key。");
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
      setNotice("规则已更新；历史交易没有改变。");
      await refresh();
      setConfirmRuleId(null);
    } catch {
      setNotice("规则更新失败，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="settings-form" onSubmit={(event) => void previewRule(event)}>
        <label>
          商户显示名称
          <input name="displayMerchant" required />
        </label>
        <label>
          未来分类
          <select name="categoryId" required>
            {targets.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-action" disabled={busy || targets.length === 0} type="submit">
          预览 exact 规则
        </button>
      </form>
      {preview ? (
        <div className="settings-preview" role="status">
          <strong>规范化键：{preview.data.proposedRule.normalizedMerchant}</strong>
          <p>
            匹配 {preview.meta.matchingTransactions} 笔，分类冲突{" "}
            {preview.meta.conflictingTransactions}
            笔；历史交易改变 0 笔。
          </p>
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void savePreview()}
            type="button"
          >
            确认保存未来规则
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
              aria-label={`${rule.displayMerchant} 分类`}
              defaultValue={rule.categoryId}
              disabled={busy || !rule.active}
              onChange={(event) => void updateRule(rule, { categoryId: event.target.value })}
            >
              {targets.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {confirmRuleId === rule.id ? (
              <div className="destructive-confirmation" role="alert">
                <strong>确认停用？</strong>
                <p>未来交易不再命中；历史交易不会重分类。</p>
                <div>
                  <button onClick={() => setConfirmRuleId(null)} type="button">
                    取消
                  </button>
                  <button onClick={() => void updateRule(rule, { active: false })} type="button">
                    确认停用
                  </button>
                </div>
              </div>
            ) : (
              <button
                disabled={busy || !rule.active}
                onClick={() => setConfirmRuleId(rule.id)}
                type="button"
              >
                {rule.active ? "停用规则" : "已停用"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
