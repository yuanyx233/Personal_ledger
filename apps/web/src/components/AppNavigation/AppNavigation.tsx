import { PRODUCT_NAME } from "@ledger/domain";
import type { MouseEvent, ReactNode } from "react";

import { APP_ROUTES, SUBSCRIPTIONS_ROUTE, type RouteId } from "../../app-routes";
import { useTranslation } from "../../i18n/useTranslation";

function NavIcon({ route }: { route: RouteId }) {
  const paths: Record<RouteId, ReactNode> = {
    add: (
      <>
        <path d="M11 4v14" />
        <path d="M4 11h14" />
      </>
    ),
    analysis: (
      <>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M3 19h15" />
      </>
    ),
    overview: (
      <>
        <path d="M4 4h5v5H4z" />
        <path d="M13 4h5v5h-5z" />
        <path d="M4 13h5v5H4z" />
        <path d="M13 13h5v5h-5z" />
      </>
    ),
    settings: (
      <>
        <circle cx="11" cy="11" r="3" />
        <path d="M11 3v2M11 17v2M3 11h2M17 11h2M5.3 5.3l1.4 1.4M15.3 15.3l1.4 1.4M16.7 5.3l-1.4 1.4M6.7 15.3l-1.4 1.4" />
      </>
    ),
    subscriptions: (
      <>
        <path d="M6 4h10v14H6z" />
        <path d="M9 8h4M9 12h4" />
      </>
    ),
    transactions: (
      <>
        <path d="M4 5h14" />
        <path d="M4 11h14" />
        <path d="M4 17h14" />
        <path d="M7 3v4M15 9v4M9 15v4" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" className="nav-icon" fill="none" viewBox="0 0 22 22">
      {paths[route]}
    </svg>
  );
}

export function AppBrand() {
  return (
    <div className="brand-lockup">
      <span aria-hidden="true" className="brand-mark">
        P
      </span>
      <span className="brand-name">{PRODUCT_NAME}</span>
    </div>
  );
}

interface AppNavigationProps {
  currentPath: string;
  layout: "bottom" | "sidebar";
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
}

export function AppNavigation({ currentPath, layout, onNavigate }: AppNavigationProps) {
  const { t } = useTranslation();
  const routes =
    layout === "sidebar"
      ? [...APP_ROUTES.slice(0, 4), SUBSCRIPTIONS_ROUTE, ...APP_ROUTES.slice(4)]
      : APP_ROUTES;

  return (
    <nav
      aria-label={t("shell.mainNavigation")}
      className={`${layout}-navigation`}
      data-navigation={layout}
    >
      <ul className="navigation-list">
        {routes.map((route) => (
          <li key={route.id}>
            <a
              aria-current={route.path === currentPath ? "page" : undefined}
              className="navigation-link"
              href={route.path}
              onClick={(event) => onNavigate(event, route.path)}
            >
              <NavIcon route={route.id} />
              <span>{t(route.labelKey)}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
