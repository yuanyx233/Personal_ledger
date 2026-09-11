ALTER TABLE categories ADD COLUMN normalized_name TEXT CHECK (
  normalized_name IS NULL OR length(normalized_name) BETWEEN 1 AND 160
);

DROP TRIGGER categories_protect_system_update;

UPDATE categories
SET normalized_name = lower(trim(name))
WHERE normalized_name IS NULL;

CREATE TRIGGER categories_protect_system_update
BEFORE UPDATE ON categories
WHEN OLD.system_key IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'system categories are immutable');
END;

CREATE UNIQUE INDEX idx_categories_normalized_name
  ON categories (normalized_name)
  WHERE normalized_name IS NOT NULL;
