## MODIFIED Requirements

### Requirement: Complete versioned JSON export

The owner SHALL be able to download a versioned JSON export containing transactions, categories, merchant rules, category budgets, subscriptions and their occurrences, category audits, and import provenance. The export SHALL cover exactly the records the current ledger reads, and SHALL NOT carry bank connections, bank accounts, automatic transfer matches, transfer-match audits, or Plaid classification fields.

#### Scenario: Full export is requested

- **WHEN** the authenticated owner requests a complete export
- **THEN** the file SHALL include a schema version, export timestamp, timezone, integer minor units, currencies, and all portable ledger records needed by the documented restore path

#### Scenario: Export content is inspected for removed integrations

- **WHEN** a complete JSON export is generated
- **THEN** it SHALL contain no connection, account, transfer-match, transfer-match-audit, or Plaid classification record

#### Scenario: A pre-reduction backup is restored

- **WHEN** a backup written before this reduction is supplied to the restore path
- **THEN** the restore SHALL fail with an explicit schema error rather than silently discarding its removed records

### Requirement: Restore reconciliation evidence

The restore path SHALL reconcile the restored database against the export by counting exactly the record sets the export carries, checking foreign-key and relationship integrity, and comparing per-currency income, net spending, and net cash flow. Reconciliation SHALL derive transfer exclusion from `TRANSFER` category kind, matching how reports exclude transfers.

#### Scenario: A valid export is restored

- **WHEN** the owner restores a current export into a separate database
- **THEN** counts, integrity checks, and per-currency report totals SHALL reconcile without referring to any removed table

#### Scenario: Restored totals disagree

- **WHEN** any reconciled count or currency total differs from the export
- **THEN** the restore command SHALL fail and SHALL preserve the isolated target for inspection
