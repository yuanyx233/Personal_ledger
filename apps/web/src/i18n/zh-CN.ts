// The source catalogue. Every key the interface uses is declared here first, and
// TranslationKey is derived from it, so a key missing from another language fails
// the type check rather than shipping a half-translated page.
export const zhCN = {
  "brand.name": "Personal Ledger",

  "nav.overview": "概览",
  "nav.add": "记一笔",
  "nav.transactions": "流水",
  "nav.analysis": "分析",
  "nav.subscriptions": "订阅",
  "nav.settings": "设置",

  "overview.currentMonth": "本月 · {period}",

  "language.label": "界面语言",
  "language.zh-CN": "中文",
  "language.en": "English",
} as const;

export type TranslationKey = keyof typeof zhCN;
