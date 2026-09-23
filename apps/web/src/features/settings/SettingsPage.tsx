import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { CsvImportSettings } from "./CsvImportSettings";
import { RuleSettings } from "./RuleSettings";
import type { SettingsData } from "./useSettingsData";
import { useSettingsData } from "./useSettingsData";
import { useTranslation } from "../../i18n/useTranslation";

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="settings-section-heading">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  );
}

function CategorySummary({
  categories,
  refresh,
  rules,
}: Pick<SettingsData, "categories" | "rules"> & { refresh: () => Promise<void> }) {
  return (
    <section className="settings-section">
      <SectionHeading eyebrow="Exact match · 不回改历史" title="类别与商户规则" />
      <p className="settings-muted">
        {categories.filter(({ active }) => active).length} 个可用类别 · {rules.length} 条商户规则
      </p>
      <RuleSettings categories={categories} refresh={refresh} rules={rules} />
    </section>
  );
}

function ExportSummary() {
  return (
    <section className="settings-section">
      <SectionHeading eyebrow="开放格式 · 不锁定" title="完整导出" />
      <p className="settings-muted">下载文件可能包含完整财务记录，请只保存到你控制的设备。</p>
      <div className="settings-export-actions">
        <a className="primary-action" href="/api/v1/exports/transactions.csv">
          下载交易 CSV
        </a>
        <a href="/api/v1/exports/data.json">下载完整 JSON</a>
      </div>
    </section>
  );
}

export function SettingsPage({ online, route }: { online: boolean; route: AppRoute }) {
  const { t } = useTranslation();
  const { refresh, retry, state } = useSettingsData();
  return (
    <div className="route-content settings-page">
      <header className="page-header">
        <p className="page-kicker">{t("page.kicker")}</p>
        <h1>{t(route.labelKey)}</h1>
        <p className="page-description">{t(route.descriptionKey)}</p>
      </header>
      {!online ? (
        <DataState variant="offline" />
      ) : state.status === "loading" ? (
        <DataState variant="loading" />
      ) : state.status === "error" ? (
        <DataState
          action={
            <button className="primary-action" onClick={() => void retry()} type="button">
              重试
            </button>
          }
          variant="error"
        />
      ) : (
        <div className="settings-sections">
          <section className="settings-section">
            <SectionHeading eyebrow="每月固定支出" title="订阅管理" />
            <p>按月自动记账，取消时可选择生效日期并删除对应支出。</p>
            <a className="primary-action" href="/subscriptions">
              管理订阅
            </a>
          </section>
          <CategorySummary categories={state.categories} refresh={refresh} rules={state.rules} />
          <section className="settings-section">
            <SectionHeading eyebrow="账单录入" title="CSV 导入" />
            <p>导入前预览，确认疑似重复。日常记账请使用“记一笔”。</p>
            <CsvImportSettings />
          </section>
          <ExportSummary />
        </div>
      )}
    </div>
  );
}
