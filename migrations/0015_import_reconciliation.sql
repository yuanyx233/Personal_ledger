ALTER TABLE import_rows
ADD COLUMN resolution TEXT NOT NULL DEFAULT 'UNRESOLVED' CHECK (
  resolution IN (
    'UNRESOLVED',
    'IMPORTED_NEW',
    'AUTO_MERGED',
    'OWNER_MERGED',
    'SKIPPED_INVALID',
    'SKIPPED_DUPLICATE'
  )
);

ALTER TABLE import_rows
ADD COLUMN match_evidence_json TEXT CHECK (
  match_evidence_json IS NULL OR json_valid(match_evidence_json)
);

ALTER TABLE import_rows
ADD COLUMN resolved_at TEXT;

UPDATE import_rows
SET
  resolution = CASE validation_status
    WHEN 'IMPORTED' THEN 'IMPORTED_NEW'
    WHEN 'INVALID' THEN 'SKIPPED_INVALID'
    WHEN 'DUPLICATE' THEN 'SKIPPED_DUPLICATE'
    ELSE 'UNRESOLVED'
  END,
  resolved_at = CASE
    WHEN validation_status IN ('IMPORTED', 'INVALID', 'DUPLICATE') THEN COALESCE(
      (SELECT committed_at FROM import_batches WHERE import_batches.id = import_rows.batch_id),
      created_at
    )
    ELSE NULL
  END;

CREATE UNIQUE INDEX idx_import_rows_merged_transaction
  ON import_rows (transaction_id)
  WHERE resolution IN ('AUTO_MERGED', 'OWNER_MERGED');

CREATE INDEX idx_import_rows_resolution_batch
  ON import_rows (batch_id, resolution, row_number);

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
    AND ledger_transaction.account_label = subscription.account_label
    AND ledger_transaction.amount_minor = subscription.amount_minor
    AND ledger_transaction.currency = subscription.currency
    AND ledger_transaction.category_id = subscription.category_id
    AND (
      (NEW.status = 'GENERATED' AND ledger_transaction.status = 'POSTED') OR
      (NEW.status = 'NOT_CHARGED' AND ledger_transaction.status = 'REMOVED')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid subscription occurrence transaction');
END;
