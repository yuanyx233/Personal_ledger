CREATE TABLE category_budgets (
  category_id TEXT NOT NULL REFERENCES categories(id),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  effective_month TEXT NOT NULL CHECK (
    effective_month GLOB '[1-9][0-9][0-9][0-9]-[0-1][0-9]'
    AND substr(effective_month, 6, 2) BETWEEN '01' AND '12'
  ),
  amount_minor INTEGER CHECK (
    amount_minor IS NULL OR
    (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 0 AND 9007199254740991)
  ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (category_id, currency, effective_month)
);
