CREATE INDEX idx_transactions_amount
ON transactions(amount_minor DESC, id DESC);
