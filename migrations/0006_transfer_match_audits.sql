CREATE TABLE transfer_match_audits (
  id TEXT PRIMARY KEY NOT NULL,
  transfer_match_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CONFIRM', 'BREAK', 'IGNORE')),
  old_status TEXT NOT NULL CHECK (
    old_status IN ('AUTO_CONFIRMED', 'PENDING_REVIEW', 'CONFIRMED', 'BROKEN', 'IGNORED')
  ),
  new_status TEXT NOT NULL CHECK (new_status IN ('CONFIRMED', 'BROKEN', 'IGNORED')),
  reason TEXT NOT NULL CHECK (
    reason IN ('OWNER_CONFIRMED', 'OWNER_BROKE', 'OWNER_IGNORED')
  ),
  match_version INTEGER NOT NULL CHECK (
    typeof(match_version) = 'integer' AND match_version >= 2
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (transfer_match_id) REFERENCES transfer_matches(id) ON DELETE RESTRICT,
  UNIQUE (transfer_match_id, match_version),
  CHECK (
    (
      action = 'CONFIRM' AND new_status = 'CONFIRMED' AND reason = 'OWNER_CONFIRMED'
      AND old_status IN ('AUTO_CONFIRMED', 'PENDING_REVIEW', 'BROKEN', 'IGNORED')
    ) OR (
      action = 'BREAK' AND new_status = 'BROKEN' AND reason = 'OWNER_BROKE'
      AND old_status IN ('AUTO_CONFIRMED', 'CONFIRMED')
    ) OR (
      action = 'IGNORE' AND new_status = 'IGNORED' AND reason = 'OWNER_IGNORED'
      AND old_status = 'PENDING_REVIEW'
    )
  )
);

CREATE TRIGGER transfer_match_audits_no_update
BEFORE UPDATE ON transfer_match_audits
BEGIN
  SELECT RAISE(ABORT, 'transfer match audits are append-only');
END;

CREATE TRIGGER transfer_match_audits_no_delete
BEFORE DELETE ON transfer_match_audits
BEGIN
  SELECT RAISE(ABORT, 'transfer match audits are append-only');
END;

CREATE TRIGGER transfer_matches_one_active_insert
BEFORE INSERT ON transfer_matches
WHEN NEW.status IN ('AUTO_CONFIRMED', 'CONFIRMED')
  AND EXISTS (
    SELECT 1 FROM transfer_matches AS active_match
    WHERE active_match.id != NEW.id
      AND active_match.status IN ('AUTO_CONFIRMED', 'CONFIRMED')
      AND (
        active_match.left_transaction_id IN (
          NEW.left_transaction_id, NEW.right_transaction_id
        ) OR active_match.right_transaction_id IN (
          NEW.left_transaction_id, NEW.right_transaction_id
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a transaction already has an active transfer match');
END;

CREATE TRIGGER transfer_matches_one_active_update
BEFORE UPDATE OF left_transaction_id, right_transaction_id, status ON transfer_matches
WHEN NEW.status IN ('AUTO_CONFIRMED', 'CONFIRMED')
  AND EXISTS (
    SELECT 1 FROM transfer_matches AS active_match
    WHERE active_match.id != NEW.id
      AND active_match.status IN ('AUTO_CONFIRMED', 'CONFIRMED')
      AND (
        active_match.left_transaction_id IN (
          NEW.left_transaction_id, NEW.right_transaction_id
        ) OR active_match.right_transaction_id IN (
          NEW.left_transaction_id, NEW.right_transaction_id
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a transaction already has an active transfer match');
END;
