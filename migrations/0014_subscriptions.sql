CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  merchant_name TEXT CHECK (
    merchant_name IS NULL OR length(merchant_name) BETWEEN 1 AND 256
  ),
  normalized_merchant TEXT NOT NULL CHECK (
    length(normalized_merchant) BETWEEN 1 AND 256
  ),
  account_label TEXT NOT NULL CHECK (length(account_label) BETWEEN 1 AND 160),
  amount_minor INTEGER NOT NULL CHECK (
    typeof(amount_minor) = 'integer' AND amount_minor > 0
  ),
  currency TEXT NOT NULL CHECK (currency IN ('CAD', 'USD')),
  category_id TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('MONTHLY', 'YEARLY')),
  anchor_day INTEGER NOT NULL CHECK (
    typeof(anchor_day) = 'integer' AND anchor_day BETWEEN 1 AND 31
  ),
  next_charge_date TEXT NOT NULL CHECK (
    length(next_charge_date) = 10
    AND next_charge_date = date(next_charge_date, '+0 days')
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED')),
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 80
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TRIGGER subscriptions_validate_category_insert
BEFORE INSERT ON subscriptions
WHEN NOT EXISTS (
  SELECT 1 FROM categories
  WHERE id = NEW.category_id AND kind = 'EXPENSE' AND active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'subscription category must be an active expense');
END;

CREATE TRIGGER subscriptions_validate_category_update
BEFORE UPDATE OF category_id ON subscriptions
WHEN NOT EXISTS (
  SELECT 1 FROM categories
  WHERE id = NEW.category_id AND kind = 'EXPENSE' AND active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'subscription category must be an active expense');
END;

CREATE TABLE subscription_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  subscription_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL CHECK (
    length(scheduled_date) = 10
    AND scheduled_date = date(scheduled_date, '+0 days')
  ),
  transaction_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('GENERATED', 'NOT_CHARGED')),
  owner_decision_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE RESTRICT,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE RESTRICT,
  UNIQUE (subscription_id, scheduled_date),
  CHECK (
    (status = 'GENERATED' AND owner_decision_at IS NULL) OR
    (status = 'NOT_CHARGED' AND owner_decision_at IS NOT NULL)
  )
);

CREATE TRIGGER subscription_occurrences_validate_insert
BEFORE INSERT ON subscription_occurrences
WHEN NOT EXISTS (
  SELECT 1
  FROM subscriptions AS subscription
  JOIN transactions AS ledger_transaction ON ledger_transaction.id = NEW.transaction_id
  WHERE subscription.id = NEW.subscription_id
    AND ledger_transaction.source = 'MANUAL'
    AND ledger_transaction.status = 'POSTED'
    AND ledger_transaction.direction = 'OUTFLOW'
    AND ledger_transaction.posted_date = NEW.scheduled_date
    AND ledger_transaction.account_label = subscription.account_label
    AND ledger_transaction.amount_minor = subscription.amount_minor
    AND ledger_transaction.currency = subscription.currency
    AND ledger_transaction.category_id = subscription.category_id
)
BEGIN
  SELECT RAISE(ABORT, 'invalid subscription occurrence transaction');
END;

CREATE TRIGGER subscription_occurrences_mark_not_charged
AFTER UPDATE OF status ON transactions
WHEN OLD.status = 'POSTED' AND NEW.status = 'REMOVED'
BEGIN
  UPDATE subscription_occurrences
  SET status = 'NOT_CHARGED', owner_decision_at = NEW.updated_at,
      updated_at = NEW.updated_at, version = version + 1
  WHERE transaction_id = NEW.id AND status = 'GENERATED';
END;

CREATE INDEX idx_subscriptions_due
  ON subscriptions (status, next_charge_date, id)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_subscription_occurrences_subscription_date
  ON subscription_occurrences (subscription_id, scheduled_date DESC, id DESC);
