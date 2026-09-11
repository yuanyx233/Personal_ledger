export type RouteId = "add" | "analysis" | "overview" | "settings" | "transactions";

export interface AppRoute {
  description: string;
  id: RouteId;
  label: string;
  path: string;
}

export const APP_ROUTES: readonly AppRoute[] = [
  {
    description: "查看本月收支和每个类别的支出占比。",
    id: "overview",
    label: "概览",
    path: "/",
  },
  {
    description: "浏览每一笔来源清晰、状态明确的账目，并保留可复现的筛选条件。",
    id: "transactions",
    label: "交易",
    path: "/transactions",
  },
  {
    description: "消费后立即记入同一本账，通常只需金额和商户。",
    id: "add",
    label: "记一笔",
    path: "/add",
  },
  {
    description: "查看每月各板块支出，设置预算上限；不同币种分别统计。",
    id: "analysis",
    label: "分析",
    path: "/analysis",
  },
  {
    description: "管理订阅、分类规则、导入 CSV 与导出账本。",
    id: "settings",
    label: "设置",
    path: "/settings",
  },
];
