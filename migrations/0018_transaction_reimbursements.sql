ALTER TABLE transactions ADD COLUMN reimbursement_minor INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(reimbursement_minor) = 'integer'
    AND reimbursement_minor >= 0 AND reimbursement_minor <= amount_minor);
