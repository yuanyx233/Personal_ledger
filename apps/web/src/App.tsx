import { useEffect, useRef, useState, type MouseEvent } from "react";

import { APP_ROUTES } from "./app-routes";
import { useTranslation } from "./i18n/useTranslation";
import { AppBrand, AppNavigation } from "./components/AppNavigation/AppNavigation";
import { AnalysisPage } from "./features/analysis/AnalysisPage";
import { OverviewPage } from "./features/overview/OverviewPage";
import { QuickEntryPage } from "./features/quick-entry/QuickEntryPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SubscriptionsPage } from "./features/subscriptions/SubscriptionsPage";
import { TransactionsPage } from "./features/transactions/TransactionsPage";
import { TransactionDetailPage } from "./features/transactions/TransactionDetailPage";

export function App() {
  const { t } = useTranslation();
  const [path, setPath] = useState(() => window.location.pathname);
  const [online, setOnline] = useState(() => navigator.onLine);
  const mainRef = useRef<HTMLElement>(null);
  const transactionDetailMatch =
    /^\/transactions\/((?:transaction-[A-Za-z0-9_-]{1,148}|csv-[A-Za-z0-9_-]{1,156}))$/.exec(path);
  const route =
    APP_ROUTES.find((candidate) => candidate.path === path) ??
    (path === "/subscriptions"
      ? APP_ROUTES.find((candidate) => candidate.id === "settings")
      : undefined) ??
    (transactionDetailMatch
      ? APP_ROUTES.find((candidate) => candidate.id === "transactions")
      : undefined) ??
    APP_ROUTES[0]!;

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  function handleNavigate(event: MouseEvent<HTMLAnchorElement>, nextPath: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    const destination = new URL(nextPath, window.location.origin);
    if (
      `${window.location.pathname}${window.location.search}` !==
      `${destination.pathname}${destination.search}`
    ) {
      window.history.pushState(null, "", `${destination.pathname}${destination.search}`);
    }
    setPath(destination.pathname);
    requestAnimationFrame(() => mainRef.current?.focus());
  }

  function focusMainContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
    window.history.replaceState(null, "", `${window.location.pathname}#main-content`);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={focusMainContent}>
        {t("shell.skipToContent")}
      </a>

      <aside className="desktop-sidebar">
        <a className="brand-link" href="/" onClick={(event) => handleNavigate(event, "/")}>
          <AppBrand />
        </a>
        <AppNavigation currentPath={path} layout="sidebar" onNavigate={handleNavigate} />
        <p className="sidebar-footnote">{t("shell.privateNote")}</p>
      </aside>

      <div className="mobile-frame">
        <header className="mobile-header">
          <AppBrand />
          <span className="local-status">{t("shell.localBadge")}</span>
        </header>

        <main id="main-content" ref={mainRef} tabIndex={-1}>
          {path === "/subscriptions" ? (
            <SubscriptionsPage online={online} />
          ) : transactionDetailMatch ? (
            <TransactionDetailPage
              online={online}
              onNavigate={handleNavigate}
              transactionId={transactionDetailMatch[1]!}
            />
          ) : route.id === "overview" ? (
            <OverviewPage online={online} onNavigate={handleNavigate} route={route} />
          ) : route.id === "add" ? (
            <QuickEntryPage online={online} route={route} />
          ) : route.id === "transactions" ? (
            <TransactionsPage online={online} route={route} />
          ) : route.id === "analysis" ? (
            <AnalysisPage online={online} onNavigate={handleNavigate} route={route} />
          ) : (
            <SettingsPage online={online} route={route} />
          )}
        </main>

        <AppNavigation currentPath={route.path} layout="bottom" onNavigate={handleNavigate} />
      </div>
    </div>
  );
}
