ALTER TABLE category_audits
ADD COLUMN old_category_rule_id TEXT REFERENCES merchant_rules(id) ON DELETE RESTRICT;

ALTER TABLE category_audits
ADD COLUMN new_category_rule_id TEXT REFERENCES merchant_rules(id) ON DELETE RESTRICT;

CREATE TRIGGER category_audits_no_update
BEFORE UPDATE ON category_audits
BEGIN
  SELECT RAISE(ABORT, 'category audits are append-only');
END;

CREATE TRIGGER category_audits_no_delete
BEFORE DELETE ON category_audits
BEGIN
  SELECT RAISE(ABORT, 'category audits are append-only');
END;

CREATE TRIGGER transactions_append_category_audit
AFTER UPDATE OF category_id, categorization_source, category_rule_id ON transactions
WHEN OLD.category_id IS NOT NEW.category_id
  OR OLD.categorization_source IS NOT NEW.categorization_source
  OR OLD.category_rule_id IS NOT NEW.category_rule_id
BEGIN
  INSERT INTO category_audits (
    id, transaction_id, old_category_id, new_category_id,
    old_source, new_source, reason, created_at,
    old_category_rule_id, new_category_rule_id
  ) VALUES (
    'category-audit-' || lower(hex(randomblob(16))),
    NEW.id,
    OLD.category_id,
    NEW.category_id,
    OLD.categorization_source,
    NEW.categorization_source,
    CASE NEW.categorization_source
      WHEN 'MANUAL' THEN 'OWNER_TRANSACTION_OVERRIDE'
      WHEN 'RULE' THEN 'RULE_CATEGORIZATION'
      WHEN 'PLAID' THEN 'PLAID_CATEGORIZATION'
      ELSE 'UNCLASSIFIED_CATEGORIZATION'
    END,
    NEW.updated_at,
    OLD.category_rule_id,
    NEW.category_rule_id
  );
END;
