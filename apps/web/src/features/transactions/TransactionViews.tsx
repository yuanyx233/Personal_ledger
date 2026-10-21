import type { TransactionListResponse } from "@ledger/domain/api-contracts";

import { useTranslation } from "../../i18n/useTranslation";
import { useMoney } from "../../i18n/useMoney";

type MoneyFormatter = (amountMinor: number, currency: string) => string;

type Transaction = TransactionListResponse["data"]["transactions"][number];

const SOURCE_KEYS = {
  CSV: "code.csv",
  MANUAL: "tx.source.MANUAL",
  PLAID: "tx.source.PLAID",
} as const;
const STATUS_KEYS = {
  PENDING: "tx.status.PENDING",
  POSTED: "tx.status.POSTED",
  REMOVED: "tx.status.REMOVED",
} as const;
const CATEGORY_LABELS = {
  MANUAL: "tx.catSource.MANUAL",
  PLAID: "tx.catSource.PLAID",
  RULE: "tx.catSource.RULE",
  UNCLASSIFIED: "tx.catSource.UNCLASSIFIED",
} as const;

function transactionName(transaction: Transaction) {
  return transaction.merchantName ?? transaction.description;
}

function signedAmount(transaction: Transaction, formatMoney: MoneyFormatter) {
  const amount = Number(transaction.amountMinor);
  return formatMoney(transaction.direction === "OUTFLOW" ? -amount : amount, transaction.currency);
}

function Badges({ transaction }: { transaction: Transaction }) {
  const formatMoney = useMoney();
  const { t } = useTranslation();
  return (
    <span className="transaction-badges">
      <span>{t(SOURCE_KEYS[transaction.source])}</span>
      <span>{t(STATUS_KEYS[transaction.status])}</span>
      <span>{t(CATEGORY_LABELS[transaction.categorizationSource])}</span>
      {transaction.installment ? (
        <span>
          {t("tx.installment", {
            count: transaction.installment.count,
            number: transaction.installment.number,
          })}
        </span>
      ) : null}
      {transaction.reimbursementMinor > 0 ? (
        <span>
          {transaction.direction === "OUTFLOW" ? t("tx.personalSpending") : t("tx.afterReceipts")}{" "}
          {formatMoney(
            transaction.amountMinor - transaction.reimbursementMinor,
            transaction.currency,
          )}
        </span>
      ) : null}
      {transaction.categorizationSource === "UNCLASSIFIED" ? (
        <span>{t("tx.pendingClassification")}</span>
      ) : null}
    </span>
  );
}

export function TransactionViews({ transactions }: { transactions: Transaction[] }) {
  const formatMoney = useMoney();
  const { t } = useTranslation();
  return (
    <>
      <ul className="transaction-list" data-transactions-layout="list">
        {transactions.map((transaction) => (
          <li key={transaction.id}>
            <a href={`/transactions/${encodeURIComponent(transaction.id)}`}>
              <span className="transaction-row-main">
                <strong>{transactionName(transaction)}</strong>
                <span>
                  {transaction.accountLabel ?? t("tx.unlabelledAccount")} · {transaction.postedDate}
                </span>
              </span>
              <span className="transaction-amount">{signedAmount(transaction, formatMoney)}</span>
              <Badges transaction={transaction} />
            </a>
          </li>
        ))}
      </ul>

      <div className="transaction-table-wrap" data-transactions-layout="table">
        <table>
          <thead>
            <tr>
              <th>{t("tx.column.merchant")}</th>
              <th>{t("tx.column.account")}</th>
              <th>{t("tx.column.date")}</th>
              <th>{t("tx.column.flags")}</th>
              <th>{t("tx.column.amount")}</th>
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
                <td>{transaction.accountLabel ?? t("tx.unlabelledAccount")}</td>
                <td>{transaction.postedDate}</td>
                <td>
                  <Badges transaction={transaction} />
                </td>
                <td className="transaction-amount">{signedAmount(transaction, formatMoney)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
