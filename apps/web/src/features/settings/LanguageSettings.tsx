import { LANGUAGES, type Language } from "../../i18n";
import { useTranslation } from "../../i18n/useTranslation";
import { SectionHeading } from "./SectionHeading";

// Language is a viewer preference, not ledger data, so this sits outside the
// loading and error branches: it must work even when the ledger cannot be read.
export function LanguageSettings() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <section className="settings-section">
      <SectionHeading eyebrow={t("language.eyebrow")} title={t("language.label")} />
      <p>{t("language.description")}</p>
      <label>
        {t("language.label")}
        <select
          name="language"
          onChange={(event) => setLanguage(event.currentTarget.value as Language)}
          value={language}
        >
          {LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {t(`language.${code}`)}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
