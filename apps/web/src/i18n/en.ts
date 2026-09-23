import type { TranslationKey } from "./zh-CN";

// Typed against the source catalogue: omitting a key fails `tsc`.
export const en: Record<TranslationKey, string> = {
  "brand.name": "Personal Ledger",

  "route.overview.label": "Overview",
  "route.overview.description": "See this month's income and spending, and each category's share.",
  "route.transactions.label": "Transactions",
  "route.transactions.description":
    "Browse every entry with a clear source and status, keeping filters reproducible.",
  "route.add.label": "Add entry",
  "route.add.description":
    "Record a purchase in the same ledger right away — usually just amount and merchant.",
  "route.analysis.label": "Analysis",
  "route.analysis.description":
    "Review monthly spending by category and set budget limits; currencies stay separate.",
  "route.settings.label": "Settings",
  "route.settings.description":
    "Manage subscriptions, category rules, CSV import and ledger export.",
  "route.subscriptions.label": "Subscriptions",
  "route.subscriptions.description": "Manage the subscriptions that post an entry each month.",

  "page.kicker": "Secure preview · local ledger",

  "shell.mainNavigation": "Main navigation",
  "shell.skipToContent": "Skip to main content",
  "shell.privateNote": "Private · owner only",
  "shell.localBadge": "Local",

  "dataState.empty.title": "Nothing here yet",
  "dataState.empty.description":
    "Content appears here once you add an entry by hand or import a CSV.",
  "dataState.error.title": "Cannot read right now",
  "dataState.error.description": "This read did not finish. Your existing ledger is unchanged.",
  "dataState.loading.title": "Reading the ledger",
  "dataState.loading.description": "Securely reading the latest data.",
  "dataState.offline.title": "You are offline",
  "dataState.offline.description":
    "Try again once you reconnect. Cached entries stay hidden to protect privacy and accuracy.",

  "nav.overview": "Overview",
  "nav.add": "Add entry",
  "nav.transactions": "Transactions",
  "nav.analysis": "Analysis",
  "nav.subscriptions": "Subscriptions",
  "nav.settings": "Settings",

  "overview.currentMonth": "This month · {period}",

  "language.eyebrow": "Interface",
  "language.description": "Affects display on this device only. No ledger data is changed.",
  "language.label": "Interface language",
  "language.zh-CN": "中文",
  "language.en": "English",
};
