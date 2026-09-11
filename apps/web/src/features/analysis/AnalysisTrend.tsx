import { formatMoney, type AnalysisTrendPoint } from "./analysis-data";

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
  const maximum = Math.max(0, ...points.map(({ netCashFlowMinor }) => Math.abs(netCashFlowMinor)));
  return (
    <section className="analysis-block" data-analysis-trend={currency}>
      <div className="analysis-block-heading">
        <div>
          <p>现金流趋势 · {currency}</p>
          <h2>{currency} 趋势</h2>
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
            <strong>{point.netCashFlowMinor < 0 ? "负" : "正"}</strong>
          </div>
        ))}
      </div>

      <div className="analysis-table-wrap">
        <table aria-label={`${currency} 现金流趋势`}>
          <thead>
            <tr>
              <th scope="col">周期</th>
              <th scope="col">收入</th>
              <th scope="col">净支出</th>
              <th scope="col">净现金流</th>
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
                  {point.netCashFlowMinor < 0 ? "负" : "正"}）
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
