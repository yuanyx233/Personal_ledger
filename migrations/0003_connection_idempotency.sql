CREATE TABLE connection_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL CHECK (
    length(idempotency_key) BETWEEN 16 AND 128
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND
    request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE connections
  ADD COLUMN creation_idempotency_key TEXT
  REFERENCES connection_requests(idempotency_key) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_connections_creation_request
  ON connections (creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;
