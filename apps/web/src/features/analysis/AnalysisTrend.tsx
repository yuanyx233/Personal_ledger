import { type AnalysisTrendPoint } from "./analysis-data";
import { useTranslation } from "../../i18n/useTranslation";
import { useMoney } from "../../i18n/useMoney";

function barWidth(value: number, maximum: number) {
  return maximum === 0 ? 0 : Math.max(2, Math.round((Math.abs(value) / maximum) * 100));
}

export function AnalysisTrend({
  currency,
  points,
}: {
  currency: string;
  points: AnalysisTrendPoint[];
}) {
  const formatMoney = useMoney();
  const { t } = useTranslation();
  const maximum = Math.max(0, ...points.map(({ netCashFlowMinor }) => Math.abs(netCashFlowMinor)));
  return (
    <section className="analysis-block" data-analysis-trend={currency}>
      <div className="analysis-block-heading">
        <div>
          <p>{t("an.trendKicker", { currency })}</p>
          <h2>{t("an.trendTitle", { currency })}</h2>
        </div>
      </div>

      <div aria-hidden="true" className="analysis-bars">
        {points.map((point) => (
          <div className="analysis-bar-row" key={point.label}>
            <span>{point.label}</span>
            <span className="analysis-bar-track">
              <span
                className={point.netCashFlowMinor < 0 ? "is-negative" : "is-positive"}
                style={{ width: `${barWidth(point.netCashFlowMinor, maximum)}%` }}
              />
            </span>
            <strong>{point.netCashFlowMinor < 0 ? t("an.negative") : t("an.positive")}</strong>
          </div>
        ))}
      </div>

      <div className="analysis-table-wrap">
        <table aria-label={t("an.trendTable", { currency })}>
          <thead>
            <tr>
              <th scope="col">{t("an.column.period")}</th>
              <th scope="col">{t("an.metric.income")}</th>
              <th scope="col">{t("an.metric.netSpending")}</th>
              <th scope="col">{t("an.metric.netCashFlow")}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{formatMoney(point.incomeMinor, currency)}</td>
                <td>{formatMoney(point.netSpendingMinor, currency)}</td>
                <td>
                  {formatMoney(point.netCashFlowMinor, currency)}（
                  {point.netCashFlowMinor < 0 ? t("an.negative") : t("an.positive")}）
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
