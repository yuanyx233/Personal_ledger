CREATE INDEX idx_transactions_report_posted_date
ON transactions(status, posted_date, id);

CREATE INDEX idx_transfer_matches_active_left
ON transfer_matches(left_transaction_id, status)
WHERE status IN ('AUTO_CONFIRMED', 'CONFIRMED');

CREATE INDEX idx_transfer_matches_active_right
ON transfer_matches(right_transaction_id, status)
WHERE status IN ('AUTO_CONFIRMED', 'CONFIRMED');
