import type { TransactionListResponse } from "@ledger/domain/api-contracts";

import { formatMoney } from "../overview/overview-data";

type Transaction = TransactionListResponse["data"]["transactions"][number];

const SOURCE_LABELS = { CSV: "CSV", MANUAL: "手工", PLAID: "历史银行导入" } as const;
const STATUS_LABELS = { PENDING: "待入账", POSTED: "已入账", REMOVED: "已移除" } as const;
const CATEGORY_LABELS = {
  MANUAL: "人工分类",
  PLAID: "历史银行分类",
  RULE: "规则分类",
  UNCLASSIFIED: "未分类",
} as const;

function transactionName(transaction: Transaction) {
  return transaction.merchantName ?? transaction.description;
}

function signedAmount(transaction: Transaction) {
  const amount = Number(transaction.amountMinor);
  return formatMoney(transaction.direction === "OUTFLOW" ? -amount : amount, transaction.currency);
}

function Badges({ transaction }: { transaction: Transaction }) {
  return (
    <span className="transaction-badges">
      <span>{SOURCE_LABELS[transaction.source]}</span>
      <span>{STATUS_LABELS[transaction.status]}</span>
      <span>{CATEGORY_LABELS[transaction.categorizationSource]}</span>
      {transaction.installment ? (
        <span>{`第 ${transaction.installment.number}/${transaction.installment.count} 期`}</span>
      ) : null}
      {transaction.reimbursementMinor > 0 ? (
        <span>
          {transaction.direction === "OUTFLOW" ? "个人消费" : "扣除回款后"}{" "}
          {formatMoney(
            transaction.amountMinor - transaction.reimbursementMinor,
            transaction.currency,
          )}
        </span>
      ) : null}
      {transaction.categorizationSource === "UNCLASSIFIED" ? <span>待分类</span> : null}
    </span>
  );
}

export function TransactionViews({ transactions }: { transactions: Transaction[] }) {
  return (
    <>
      <ul className="transaction-list" data-transactions-layout="list">
        {transactions.map((transaction) => (
          <li key={transaction.id}>
            <a href={`/transactions/${encodeURIComponent(transaction.id)}`}>
              <span className="transaction-row-main">
                <strong>{transactionName(transaction)}</strong>
                <span>
                  {transaction.accountLabel ?? "未标注账户"} · {transaction.postedDate}
                </span>
              </span>
              <span className="transaction-amount">{signedAmount(transaction)}</span>
              <Badges transaction={transaction} />
            </a>
          </li>
        ))}
      </ul>

      <div className="transaction-table-wrap" data-transactions-layout="table">
        <table>
          <thead>
            <tr>
              <th>商户 / 描述</th>
              <th>账户</th>
              <th>日期</th>
              <th>标记</th>
              <th>金额</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <th scope="row">
                  <a href={`/transactions/${encodeURIComponent(transaction.id)}`}>
                    {transactionName(transaction)}
                  </a>
                </th>
                <td>{transaction.accountLabel ?? "未标注账户"}</td>
                <td>{transaction.postedDate}</td>
                <td>
                  <Badges transaction={transaction} />
                </td>
                <td className="transaction-amount">{signedAmount(transaction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
