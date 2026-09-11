DROP TRIGGER categories_validate_insert;
DROP TRIGGER categories_validate_update;

CREATE TRIGGER categories_validate_insert
BEFORE INSERT ON categories
WHEN NOT (
  (
    NEW.system_key IS NULL
    AND NEW.kind IN ('INCOME', 'EXPENSE', 'TRANSFER')
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
    AND NEW.kind IN ('INCOME', 'EXPENSE', 'TRANSFER')
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
