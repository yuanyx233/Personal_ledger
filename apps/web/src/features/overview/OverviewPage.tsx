import type { MouseEvent } from "react";

import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { OverviewSpendingPie } from "./OverviewSpendingPie";
import { formatMoney, type OverviewData } from "./overview-data";
import { useOverviewData } from "./useOverviewData";
import { useTranslation } from "../../i18n/useTranslation";

type Navigate = (event: MouseEvent<HTMLAnchorElement>, path: string) => void;

function PageHeader({ route }: { route: AppRoute }) {
  const { t } = useTranslation();
  return (
    <header className="page-header">
      <p className="page-kicker">{t("page.kicker")}</p>
      <h1>{t(route.labelKey)}</h1>
      <p className="page-description">{t(route.descriptionKey)}</p>
    </header>
  );
}

function amountLabel(label: string, amountMinor: number, currency: string) {
  return `${label} ${(amountMinor / 100).toFixed(2)} ${currency}`;
}

function OverviewSections({ data, onNavigate }: { data: OverviewData; onNavigate: Navigate }) {
  const { t } = useTranslation();
  return (
    <div className="overview-sections">
      <p>
        <a
          href="/transactions?categorizationSource=UNCLASSIFIED"
          onClick={(event) => onNavigate(event, "/transactions?categorizationSource=UNCLASSIFIED")}
        >
          {t("overview.viewUnclassified")}
        </a>
      </p>
      <section className="overview-block" data-overview-section="metrics">
        <div className="overview-block-heading">
          <div>
            <p>{t("overview.thisMonth", { period: data.currentPeriod })}</p>
            <h2>{t("overview.cashFlow.title")}</h2>
          </div>
        </div>
        {data.currentSections.length === 0 ? (
          <DataState title={t("overview.cashFlow.empty")} variant="empty" />
        ) : (
          data.currentSections.map((section) => (
            <div className="currency-metrics" key={section.currency}>
              <h3>{section.currency}</h3>
              <dl>
                {[
                  [t("overview.cashFlow.income"), section.current.incomeMinor],
                  [t("overview.cashFlow.netSpending"), section.current.netSpendingMinor],
                  [t("overview.cashFlow.netCashFlow"), section.current.netCashFlowMinor],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt>{label}</dt>
                    <dd aria-label={amountLabel(String(label), Number(value), section.currency)}>
                      {formatMoney(Number(value), section.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))
        )}
      </section>

      <section className="overview-block" data-overview-section="spending">
        <div className="overview-block-heading">
          <div>
            <p>{t("overview.thisMonth", { period: data.currentPeriod })}</p>
            <h2>{t("overview.spending.title")}</h2>
          </div>
        </div>
        {data.spendingSections.length === 0 ? (
          <DataState title={t("overview.spending.empty")} variant="empty" />
        ) : (
          data.spendingSections.map((section) => (
            <OverviewSpendingPie section={section} key={section.currency} onNavigate={onNavigate} />
          ))
        )}
      </section>
    </div>
  );
}

export function OverviewPage({
  online,
  onNavigate,
  route,
}: {
  online: boolean;
  onNavigate: Navigate;
  route: AppRoute;
}) {
  const { t } = useTranslation();
  const { retry, state } = useOverviewData();
  return (
    <div className="route-content overview-page">
      <PageHeader route={route} />
      {!online ? (
        <DataState variant="offline" />
      ) : state.status === "loading" ? (
        <DataState variant="loading" />
      ) : state.status === "error" ? (
        <DataState
          action={
            <button className="primary-action" onClick={retry} type="button">
              {t("overview.retry")}
            </button>
          }
          variant="error"
        />
      ) : (
        <OverviewSections data={state.data} onNavigate={onNavigate} />
      )}
    </div>
  );
}
