// The source catalogue. Every key the interface uses is declared here first, and
// TranslationKey is derived from it, so a key missing from another language fails
// the type check rather than shipping a half-translated page.
export const zhCN = {
  "brand.name": "Personal Ledger",

  "route.overview.label": "概览",
  "route.overview.description": "查看本月收支和每个类别的支出占比。",
  "route.transactions.label": "交易",
  "route.transactions.description": "浏览每一笔来源清晰、状态明确的账目，并保留可复现的筛选条件。",
  "route.add.label": "记一笔",
  "route.add.description": "消费后立即记入同一本账，通常只需金额和商户。",
  "route.analysis.label": "分析",
  "route.analysis.description": "查看每月各板块支出，设置预算上限；不同币种分别统计。",
  "route.settings.label": "设置",
  "route.settings.description": "管理订阅、分类规则、导入 CSV 与导出账本。",
  "route.subscriptions.label": "订阅",
  "route.subscriptions.description": "管理每月自动记账的订阅。",

  "page.kicker": "安全预览 · 本地账本",

  "shell.mainNavigation": "主导航",
  "shell.skipToContent": "跳到主要内容",
  "shell.privateNote": "私有 · 仅限本人",
  "shell.localBadge": "本地",

  "dataState.empty.title": "这里还没有数据",
  "dataState.empty.description": "添加手工交易或导入 CSV 后，内容会出现在这里。",
  "dataState.error.title": "暂时无法读取",
  "dataState.error.description": "本次读取没有完成。你的现有账本不会因此被更改。",
  "dataState.loading.title": "正在读取账本",
  "dataState.loading.description": "正在安全地读取最新数据。",
  "dataState.offline.title": "当前处于离线状态",
  "dataState.offline.description": "重新联网后再试；为保护隐私和准确性，不会显示缓存的交易记录。",

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
