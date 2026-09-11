DROP TRIGGER subscription_occurrences_validate_insert;

CREATE TRIGGER subscription_occurrences_validate_insert
BEFORE INSERT ON subscription_occurrences
WHEN NOT EXISTS (
  SELECT 1
  FROM subscriptions AS subscription
  JOIN transactions AS ledger_transaction ON ledger_transaction.id = NEW.transaction_id
  WHERE subscription.id = NEW.subscription_id
    AND ledger_transaction.source = 'MANUAL'
    AND ledger_transaction.direction = 'OUTFLOW'
    AND ledger_transaction.posted_date = NEW.scheduled_date
    AND (
      (NEW.status = 'GENERATED' AND ledger_transaction.status = 'POSTED') OR
      (NEW.status = 'NOT_CHARGED' AND ledger_transaction.status = 'REMOVED')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid subscription occurrence transaction');
END;
