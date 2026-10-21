import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { CsvImportSettings } from "./CsvImportSettings";
import { RuleSettings } from "./RuleSettings";
import type { SettingsData } from "./useSettingsData";
import { useSettingsData } from "./useSettingsData";
import { useTranslation } from "../../i18n/useTranslation";
import { LanguageSettings } from "./LanguageSettings";
import { SectionHeading } from "./SectionHeading";

function CategorySummary({
  categories,
  refresh,
  rules,
}: Pick<SettingsData, "categories" | "rules"> & { refresh: () => Promise<void> }) {
  const { t } = useTranslation();
  return (
    <section className="settings-section">
      <SectionHeading eyebrow={t("settings.rules.eyebrow")} title={t("settings.rules.title")} />
      <p className="settings-muted">
        {t("settings.rules.summary", {
          categories: categories.filter(({ active }) => active).length,
          rules: rules.length,
        })}
      </p>
      <RuleSettings categories={categories} refresh={refresh} rules={rules} />
    </section>
  );
}

function ExportSummary() {
  const { t } = useTranslation();
  return (
    <section className="settings-section">
      <SectionHeading eyebrow={t("settings.export.eyebrow")} title={t("settings.export.title")} />
      <p className="settings-muted">{t("settings.export.warning")}</p>
      <div className="settings-export-actions">
        <a className="primary-action" href="/api/v1/exports/transactions.csv">
          {t("settings.export.csv")}
        </a>
        <a href="/api/v1/exports/data.json">{t("settings.export.json")}</a>
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
      <div className="settings-sections">
        <LanguageSettings />
      </div>
      {!online ? (
        <DataState variant="offline" />
      ) : state.status === "loading" ? (
        <DataState variant="loading" />
      ) : state.status === "error" ? (
        <DataState
          action={
            <button className="primary-action" onClick={() => void retry()} type="button">
              {t("settings.retry")}
            </button>
          }
          variant="error"
        />
      ) : (
        <div className="settings-sections">
          <section className="settings-section">
            <SectionHeading eyebrow={t("settings.sub.eyebrow")} title={t("settings.sub.title")} />
            <p>{t("settings.sub.body")}</p>
            <a className="primary-action" href="/subscriptions">
              {t("settings.sub.manage")}
            </a>
          </section>
          <CategorySummary categories={state.categories} refresh={refresh} rules={state.rules} />
          <section className="settings-section">
            <SectionHeading eyebrow={t("settings.csv.eyebrow")} title={t("settings.csv.title")} />
            <p>{t("settings.csv.body")}</p>
            <CsvImportSettings />
          </section>
          <ExportSummary />
        </div>
      )}
    </div>
  );
}
