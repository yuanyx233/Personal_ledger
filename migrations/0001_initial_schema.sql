PRAGMA foreign_keys = ON;

CREATE TABLE connections (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  plaid_item_id TEXT NOT NULL UNIQUE,
  access_token_ciphertext BLOB NOT NULL CHECK (length(access_token_ciphertext) > 0),
  access_token_iv BLOB NOT NULL CHECK (length(access_token_iv) > 0),
  token_key_version INTEGER NOT NULL CHECK (
    typeof(token_key_version) = 'integer' AND token_key_version >= 1
  ),
  sync_cursor TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('HEALTHY', 'ACTION_REQUIRED', 'SYNCING', 'ERROR', 'DISCONNECTED')
  ),
  last_success_at TEXT,
  last_error_code TEXT,
  consent_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  )
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  plaid_account_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (length(display_name) > 0),
  mask TEXT,
  type TEXT NOT NULL,
  subtype TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency = upper(currency)
  ),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  CHECK (
    (type = 'DEPOSITORY' AND subtype = 'CHECKING') OR
    (type = 'CREDIT' AND subtype = 'CREDIT_CARD')
  )
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE', 'TRANSFER', 'UNCLASSIFIED')),
  system_key TEXT UNIQUE,
  editable INTEGER NOT NULL DEFAULT 1 CHECK (editable IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  CHECK (system_key IS NULL OR editable = 0)
);

CREATE TABLE merchant_rules (
  id TEXT PRIMARY KEY NOT NULL,
  normalized_merchant TEXT NOT NULL UNIQUE CHECK (length(normalized_merchant) > 0),
  display_merchant TEXT NOT NULL CHECK (length(display_merchant) > 0),
  category_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('PLAID', 'MANUAL', 'CSV')),
  account_id TEXT,
  account_label TEXT,
  plaid_transaction_id TEXT UNIQUE,
  pending_transaction_id TEXT,
  import_fingerprint TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'POSTED', 'REMOVED')),
  authorized_date TEXT,
  posted_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (
    typeof(amount_minor) = 'integer' AND amount_minor >= 0
  ),
  direction TEXT NOT NULL CHECK (direction IN ('INFLOW', 'OUTFLOW')),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency = upper(currency)
  ),
  provider_amount_decimal TEXT,
  raw_description TEXT NOT NULL,
  merchant_name TEXT,
  payment_metadata_json TEXT CHECK (
    payment_metadata_json IS NULL OR json_valid(payment_metadata_json)
  ),
  category_id TEXT,
  categorization_source TEXT NOT NULL CHECK (
    categorization_source IN ('MANUAL', 'RULE', 'PLAID', 'UNCLASSIFIED')
  ),
  category_rule_id TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
  review_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (pending_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (category_rule_id) REFERENCES merchant_rules(id) ON DELETE SET NULL,
  CHECK (account_id IS NOT NULL OR account_label IS NOT NULL),
  CHECK (source != 'PLAID' OR plaid_transaction_id IS NOT NULL),
  CHECK (source != 'CSV' OR import_fingerprint IS NOT NULL),
  CHECK (pending_transaction_id IS NULL OR pending_transaction_id != id)
);

CREATE TABLE category_audits (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL,
  old_category_id TEXT,
  new_category_id TEXT,
  old_source TEXT NOT NULL CHECK (
    old_source IN ('MANUAL', 'RULE', 'PLAID', 'UNCLASSIFIED')
  ),
  new_source TEXT NOT NULL CHECK (
    new_source IN ('MANUAL', 'RULE', 'PLAID', 'UNCLASSIFIED')
  ),
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (old_category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (new_category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE transfer_matches (
  id TEXT PRIMARY KEY NOT NULL,
  left_transaction_id TEXT NOT NULL,
  right_transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('AUTO_CONFIRMED', 'PENDING_REVIEW', 'CONFIRMED', 'BROKEN', 'IGNORED')
  ),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'AMBIGUOUS')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  FOREIGN KEY (left_transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (right_transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  UNIQUE (left_transaction_id, right_transaction_id),
  CHECK (left_transaction_id < right_transaction_id)
);

CREATE TABLE sync_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  connection_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (length(event_type) > 0),
  minimal_payload_json TEXT NOT NULL CHECK (json_valid(minimal_payload_json)),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('WEBHOOK', 'SCHEDULED', 'MANUAL', 'INITIAL')),
  status TEXT NOT NULL CHECK (
    status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'PAUSED')
  ),
  idempotency_key TEXT,
  start_cursor TEXT,
  end_cursor TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(attempt_count) = 'integer' AND attempt_count >= 0
  ),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  ),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  UNIQUE (connection_id, idempotency_key)
);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY NOT NULL,
  content_checksum TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('PREVIEWED', 'COMMITTING', 'COMMITTED', 'EXPIRED', 'DISCARDED', 'FAILED')
  ),
  preview_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(version) = 'integer' AND version >= 1
  )
);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK (
    typeof(row_number) = 'integer' AND row_number >= 1
  ),
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
  canonical_fingerprint TEXT,
  validation_status TEXT NOT NULL CHECK (
    validation_status IN ('VALID', 'INVALID', 'DUPLICATE', 'IMPORTED')
  ),
  errors_json TEXT NOT NULL CHECK (json_valid(errors_json)),
  transaction_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  UNIQUE (batch_id, row_number)
);
