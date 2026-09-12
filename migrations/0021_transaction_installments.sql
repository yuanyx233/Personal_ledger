ALTER TABLE transactions ADD COLUMN installment_group_id TEXT;
ALTER TABLE transactions ADD COLUMN installment_number INTEGER;
ALTER TABLE transactions ADD COLUMN installment_count INTEGER CHECK (
  (
    installment_group_id IS NULL
    AND installment_number IS NULL
    AND installment_count IS NULL
  ) OR (
    source = 'MANUAL'
    AND length(installment_group_id) BETWEEN 1 AND 160
    AND typeof(installment_number) = 'integer'
    AND installment_number >= 1
    AND typeof(installment_count) = 'integer'
    AND installment_count BETWEEN 2 AND 60
    AND installment_number <= installment_count
  )
);

CREATE UNIQUE INDEX idx_transactions_installment_group
  ON transactions (installment_group_id, installment_number)
  WHERE installment_group_id IS NOT NULL;
