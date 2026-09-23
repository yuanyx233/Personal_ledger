import type { TranslationKey } from "./zh-CN";

// Typed against the source catalogue: omitting a key fails `tsc`.
export const en: Record<TranslationKey, string> = {
  "brand.name": "Personal Ledger",

  "nav.overview": "Overview",
  "nav.add": "Add entry",
  "nav.transactions": "Transactions",
  "nav.analysis": "Analysis",
  "nav.subscriptions": "Subscriptions",
  "nav.settings": "Settings",

  "overview.currentMonth": "This month · {period}",

  "language.label": "Interface language",
  "language.zh-CN": "中文",
  "language.en": "English",
};
