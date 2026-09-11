import type { MouseEvent } from "react";

import type { AppRoute } from "../../app-routes";
import { DataState } from "../../components/DataState/DataState";
import { OverviewSpendingPie } from "./OverviewSpendingPie";
import { formatMoney, type OverviewData } from "./overview-data";
import { useOverviewData } from "./useOverviewData";

type Navigate = (event: MouseEvent<HTMLAnchorElement>, path: string) => void;

function PageHeader({ route }: { route: AppRoute }) {
  return (
    <header className="page-header">
      <p className="page-kicker">安全预览 · 本地账本</p>
      <h1>{route.label}</h1>
      <p className="page-description">{route.description}</p>
    </header>
  );
}

function amountLabel(label: string, amountMinor: number, currency: string) {
  return `${label} ${(amountMinor / 100).toFixed(2)} ${currency}`;
}

function OverviewSections({ data, onNavigate }: { data: OverviewData; onNavigate: Navigate }) {
  return (
    <div className="overview-sections">
      <p>
        <a
          href="/transactions?categorizationSource=UNCLASSIFIED"
          onClick={(event) => onNavigate(event, "/transactions?categorizationSource=UNCLASSIFIED")}
        >
          查看未分类流水
        </a>
      </p>
      <section className="overview-block" data-overview-section="metrics">
        <div className="overview-block-heading">
          <div>
            <p>本月 · {data.currentPeriod}</p>
            <h2>本月现金流</h2>
          </div>
        </div>
        {data.currentSections.length === 0 ? (
          <DataState title="本月还没有可计入报表的交易" variant="empty" />
        ) : (
          data.currentSections.map((section) => (
            <div className="currency-metrics" key={section.currency}>
              <h3>{section.currency}</h3>
              <dl>
                {[
                  ["收入", section.current.incomeMinor],
                  ["净支出", section.current.netSpendingMinor],
                  ["净现金流", section.current.netCashFlowMinor],
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
            <p>本月 · {data.currentPeriod}</p>
            <h2>钱花在哪里</h2>
          </div>
        </div>
        {data.spendingSections.length === 0 ? (
          <DataState title="本月还没有分类支出" variant="empty" />
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
              重试
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
