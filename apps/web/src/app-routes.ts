import type { TranslationKey } from "./i18n";

export type RouteId =
  "add" | "analysis" | "overview" | "settings" | "subscriptions" | "transactions";

export interface AppRoute {
  descriptionKey: TranslationKey;
  id: RouteId;
  labelKey: TranslationKey;
  path: string;
}

export const APP_ROUTES: readonly AppRoute[] = [
  {
    descriptionKey: "route.overview.description",
    id: "overview",
    labelKey: "route.overview.label",
    path: "/",
  },
  {
    descriptionKey: "route.transactions.description",
    id: "transactions",
    labelKey: "route.transactions.label",
    path: "/transactions",
  },
  {
    descriptionKey: "route.add.description",
    id: "add",
    labelKey: "route.add.label",
    path: "/add",
  },
  {
    descriptionKey: "route.analysis.description",
    id: "analysis",
    labelKey: "route.analysis.label",
    path: "/analysis",
  },
  {
    descriptionKey: "route.settings.description",
    id: "settings",
    labelKey: "route.settings.label",
    path: "/settings",
  },
];

export const SUBSCRIPTIONS_ROUTE: AppRoute = {
  descriptionKey: "route.subscriptions.description",
  id: "subscriptions",
  labelKey: "route.subscriptions.label",
  path: "/subscriptions",
};
