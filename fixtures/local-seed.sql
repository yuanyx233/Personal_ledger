INSERT OR IGNORE INTO connections (
  id, institution_id, institution_name, plaid_item_id,
  access_token_ciphertext, access_token_iv, token_key_version,
  status, last_success_at, created_at, updated_at, version
) VALUES (
  'fixture-connection-rbc', 'ins_fixture_rbc', 'Fixture RBC', 'fixture-item-rbc',
  X'00', X'000000000000000000000000', 1,
  'HEALTHY', '2026-01-15T12:00:00.000Z',
  '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
);

INSERT OR IGNORE INTO accounts (
  id, connection_id, plaid_account_id, display_name, mask,
  type, subtype, currency, enabled, created_at, updated_at, version
) VALUES (
  'fixture-account-chequing', 'fixture-connection-rbc', 'fixture-plaid-account-chequing',
  'Fixture Chequing', '1234', 'DEPOSITORY', 'CHECKING', 'CAD', 1,
  '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
);

INSERT OR IGNORE INTO categories (
  id, name, kind, editable, active, created_at, updated_at, version
) VALUES
  (
    'fixture-category-shopping', 'Fixture Shopping', 'EXPENSE', 1, 1,
    '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
  ),
  (
    'fixture-category-income', 'Fixture Income', 'INCOME', 1, 1,
    '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
  );

INSERT OR IGNORE INTO merchant_rules (
  id, normalized_merchant, display_merchant, category_id,
  active, created_at, updated_at, version
) VALUES (
  'fixture-rule-market', 'fixture market', 'Fixture Market',
  'fixture-category-shopping', 1,
  '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
);

INSERT OR IGNORE INTO transactions (
  id, source, account_id, plaid_transaction_id, status,
  authorized_date, posted_date, amount_minor, direction, currency,
  provider_amount_decimal, raw_description, merchant_name,
  category_id, categorization_source, category_rule_id,
  needs_review, created_at, updated_at, version
) VALUES (
  'fixture-transaction-grocery', 'PLAID', 'fixture-account-chequing',
  'fixture-plaid-transaction-grocery', 'POSTED', '2026-01-14', '2026-01-15',
  1234, 'OUTFLOW', 'CAD', '12.34', 'Fixture grocery purchase', 'Fixture Market',
  'fixture-category-shopping', 'RULE', 'fixture-rule-market', 0,
  '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z', 1
);

INSERT OR IGNORE INTO transactions (
  id, source, account_id, status, authorized_date, posted_date,
  amount_minor, direction, currency, raw_description, merchant_name,
  category_id, categorization_source, needs_review,
  created_at, updated_at, version
) VALUES (
  'fixture-transaction-income', 'MANUAL', 'fixture-account-chequing', 'POSTED',
  '2026-01-31', '2026-01-31', 500000, 'INFLOW', 'CAD',
  'Fixture salary', 'Fixture Employer', 'fixture-category-income', 'MANUAL', 0,
  '2026-01-31T17:00:00.000Z', '2026-01-31T17:00:00.000Z', 1
);
