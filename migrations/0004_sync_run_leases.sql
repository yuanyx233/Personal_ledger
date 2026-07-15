ALTER TABLE sync_runs ADD COLUMN lease_token TEXT CHECK (
  lease_token IS NULL OR (length(lease_token) >= 16 AND length(lease_token) <= 160)
);

ALTER TABLE sync_runs ADD COLUMN next_attempt_at TEXT;

DROP INDEX idx_sync_runs_active_lease;

CREATE UNIQUE INDEX idx_sync_runs_one_active_connection
  ON sync_runs (connection_id)
  WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT');

CREATE INDEX idx_sync_runs_retry_due
  ON sync_runs (status, next_attempt_at, connection_id, id)
  WHERE status = 'RETRY_WAIT';

CREATE INDEX idx_sync_events_connection_pending
  ON sync_events (connection_id, received_at, id)
  WHERE status = 'PENDING';

CREATE TABLE sync_run_requests (
  connection_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) >= 16 AND length(idempotency_key) <= 160
  ),
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (connection_id, idempotency_key),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES sync_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_sync_run_requests_run
  ON sync_run_requests (run_id, connection_id);
