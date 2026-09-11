CREATE INDEX idx_transactions_transfer_matching
ON transactions(status, currency, amount_minor, posted_date, id, account_id, direction);
