CREATE INDEX idx_accounts_connection_enabled
  ON accounts (connection_id, enabled, id);

CREATE INDEX idx_connections_sync_candidates
  ON connections (status, last_success_at, id);

CREATE INDEX idx_transactions_pending_link
  ON transactions (pending_transaction_id)
  WHERE pending_transaction_id IS NOT NULL;

CREATE INDEX idx_transactions_report_posted_currency_date
  ON transactions (currency, posted_date DESC, id DESC)
  WHERE status = 'POSTED';

CREATE INDEX idx_transactions_account_date
  ON transactions (account_id, posted_date DESC, id DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX idx_transactions_category_date
  ON transactions (category_id, posted_date DESC, id DESC)
  WHERE category_id IS NOT NULL;

CREATE INDEX idx_transactions_filter_state_date
  ON transactions (status, source, categorization_source, posted_date DESC, id DESC);

CREATE INDEX idx_transactions_review_queue
  ON transactions (posted_date DESC, id DESC)
  WHERE needs_review = 1;

CREATE INDEX idx_sync_runs_active_lease
  ON sync_runs (connection_id, lease_expires_at, id)
  WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT');

CREATE INDEX idx_sync_events_status_received
  ON sync_events (status, received_at, id);

CREATE INDEX idx_import_rows_fingerprint
  ON import_rows (canonical_fingerprint)
  WHERE canonical_fingerprint IS NOT NULL;

CREATE INDEX idx_import_batches_status_expiry
  ON import_batches (status, preview_expires_at, id);
