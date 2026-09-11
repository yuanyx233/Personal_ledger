## ADDED Requirements

### Requirement: CSV and manual ledger

The application SHALL accept new transactions only from CSV imports or owner-entered records, with category rules and owner overrides.

#### Scenario: Owner maintains the ledger

- **WHEN** the owner imports a CSV or enters a transaction
- **THEN** the application SHALL persist it, allow correction/removal, detect repeat imports, and offer confirmation of suspected manual-entry duplicates

#### Scenario: Owner views or exports existing data

- **WHEN** the owner views reports or exports a backup
- **THEN** historical transactions and classifications SHALL remain available, transfers SHALL remain excluded from income/spending, and currencies SHALL stay separate

#### Scenario: Removed integrations

- **WHEN** the application runs
- **THEN** it SHALL NOT contact Plaid, generate subscriptions, automatically pair transfers, expose a separate review workflow, or require a sync Worker
