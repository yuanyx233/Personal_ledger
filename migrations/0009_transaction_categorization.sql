ALTER TABLE transactions ADD COLUMN normalized_merchant TEXT CHECK (
  normalized_merchant IS NULL OR
  (length(normalized_merchant) BETWEEN 1 AND 256)
);

ALTER TABLE transactions ADD COLUMN plaid_pfc_primary TEXT CHECK (
  plaid_pfc_primary IS NULL OR
  (
    length(plaid_pfc_primary) BETWEEN 1 AND 160
    AND substr(plaid_pfc_primary, 1, 1) GLOB '[A-Z]'
    AND plaid_pfc_primary NOT GLOB '*[^A-Z0-9_]*'
  )
);

ALTER TABLE transactions ADD COLUMN plaid_pfc_detailed TEXT CHECK (
  plaid_pfc_detailed IS NULL OR
  (
    length(plaid_pfc_detailed) BETWEEN 1 AND 160
    AND substr(plaid_pfc_detailed, 1, 1) GLOB '[A-Z]'
    AND plaid_pfc_detailed NOT GLOB '*[^A-Z0-9_]*'
  )
);

ALTER TABLE transactions ADD COLUMN plaid_pfc_confidence TEXT CHECK (
  plaid_pfc_confidence IS NULL OR
  plaid_pfc_confidence IN ('VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')
);

CREATE TRIGGER transactions_validate_plaid_pfc_insert
BEFORE INSERT ON transactions
WHEN NOT (
  (
    NEW.plaid_pfc_primary IS NULL
    AND NEW.plaid_pfc_detailed IS NULL
    AND NEW.plaid_pfc_confidence IS NULL
  ) OR
  (NEW.plaid_pfc_primary IS NOT NULL AND NEW.plaid_pfc_detailed IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'Plaid PFC primary and detailed fields must be stored together');
END;

CREATE TRIGGER transactions_validate_plaid_pfc_update
BEFORE UPDATE OF plaid_pfc_primary, plaid_pfc_detailed, plaid_pfc_confidence ON transactions
WHEN NOT (
  (
    NEW.plaid_pfc_primary IS NULL
    AND NEW.plaid_pfc_detailed IS NULL
    AND NEW.plaid_pfc_confidence IS NULL
  ) OR
  (NEW.plaid_pfc_primary IS NOT NULL AND NEW.plaid_pfc_detailed IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'Plaid PFC primary and detailed fields must be stored together');
END;

CREATE INDEX idx_transactions_normalized_merchant_date
  ON transactions (normalized_merchant, posted_date DESC, id DESC)
  WHERE normalized_merchant IS NOT NULL;
