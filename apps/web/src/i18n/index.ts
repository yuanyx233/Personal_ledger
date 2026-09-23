import { en } from "./en";
import { zhCN, type TranslationKey } from "./zh-CN";

export type { TranslationKey };

export const LANGUAGES = ["zh-CN", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const CATALOGUES: Record<Language, Record<TranslationKey, string>> = {
  "zh-CN": zhCN,
  en,
};

export const LANGUAGE_STORAGE_KEY = "ledger.language";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

export function translate(
  language: Language,
  key: TranslationKey,
  values: Record<string, string | number> = {},
): string {
  return CATALOGUES[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );
}

// An explicit choice always wins. Otherwise any Chinese browser preference picks
// the Chinese catalogue; everything else reads better in English than in a
// language the viewer did not ask for.
export function initialLanguage(
  stored: string | null,
  browserLanguages: readonly string[],
): Language {
  if (isLanguage(stored)) return stored;
  for (const candidate of browserLanguages) {
    if (/^zh\b/i.test(candidate)) return "zh-CN";
    if (/^en\b/i.test(candidate)) return "en";
  }
  return "en";
}
