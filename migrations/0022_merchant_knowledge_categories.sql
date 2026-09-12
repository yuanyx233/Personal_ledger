INSERT INTO categories (
  id, name, normalized_name, kind, system_key, editable, active,
  created_at, updated_at, version
) VALUES
  (
    'category-expense-entertainment', 'Entertainment', 'entertainment',
    'EXPENSE', NULL, 1, 1,
    '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z', 1
  ),
  (
    'category-expense-healthcare', 'Healthcare', 'healthcare',
    'EXPENSE', NULL, 1, 1,
    '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z', 1
  ),
  (
    'category-expense-travel', 'Travel', 'travel',
    'EXPENSE', NULL, 1, 1,
    '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z', 1
  )
ON CONFLICT(id) DO NOTHING;

UPDATE merchant_rules
SET category_id = 'category-expense-housing',
    updated_at = '2026-09-12T00:00:00.000Z',
    version = version + 1
WHERE normalized_merchant = 'ikea'
  AND active = 1
  AND category_id <> 'category-expense-housing';
