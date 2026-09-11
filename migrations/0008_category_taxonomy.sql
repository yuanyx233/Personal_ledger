CREATE TRIGGER categories_validate_insert
BEFORE INSERT ON categories
WHEN NOT (
  (
    NEW.system_key IS NULL
    AND NEW.kind IN ('INCOME', 'EXPENSE')
    AND NEW.editable = 1
  ) OR (
    NEW.system_key = 'TRANSFER'
    AND NEW.kind = 'TRANSFER'
    AND NEW.editable = 0
    AND NEW.active = 1
  ) OR (
    NEW.system_key = 'UNCLASSIFIED'
    AND NEW.kind = 'UNCLASSIFIED'
    AND NEW.editable = 0
    AND NEW.active = 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid category kind or system state');
END;

CREATE TRIGGER categories_validate_update
BEFORE UPDATE ON categories
WHEN NOT (
  (
    NEW.system_key IS NULL
    AND NEW.kind IN ('INCOME', 'EXPENSE')
    AND NEW.editable = 1
  ) OR (
    NEW.system_key = 'TRANSFER'
    AND NEW.kind = 'TRANSFER'
    AND NEW.editable = 0
    AND NEW.active = 1
  ) OR (
    NEW.system_key = 'UNCLASSIFIED'
    AND NEW.kind = 'UNCLASSIFIED'
    AND NEW.editable = 0
    AND NEW.active = 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid category kind or system state');
END;

-- Validate any pre-existing local data before the stricter protection triggers are installed.
UPDATE categories SET id = id;

CREATE TRIGGER categories_protect_system_update
BEFORE UPDATE ON categories
WHEN OLD.system_key IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'system categories are immutable');
END;

CREATE TRIGGER categories_protect_system_delete
BEFORE DELETE ON categories
WHEN OLD.system_key IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'system categories cannot be deleted');
END;

INSERT INTO categories (
  id, name, kind, system_key, editable, active,
  created_at, updated_at, version
) VALUES
  (
    'category-income-employment', 'Employment Income', 'INCOME', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-income-other', 'Other Income', 'INCOME', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-expense-housing', 'Housing', 'EXPENSE', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-expense-food', 'Food & Dining', 'EXPENSE', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-expense-transportation', 'Transportation', 'EXPENSE', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-expense-shopping', 'Shopping', 'EXPENSE', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-expense-bills', 'Bills & Utilities', 'EXPENSE', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-expense-other', 'Other Expense', 'EXPENSE', NULL, 1, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-system-transfer', 'Transfer', 'TRANSFER', 'TRANSFER', 0, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  ),
  (
    'category-system-unclassified', 'Unclassified', 'UNCLASSIFIED', 'UNCLASSIFIED', 0, 1,
    '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 1
  );
