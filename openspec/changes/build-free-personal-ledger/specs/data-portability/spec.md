## ADDED Requirements

### Requirement: Two-phase CSV import

CSV import SHALL parse and validate into a preview before changing the ledger, and SHALL write rows only after the owner explicitly commits the preview.

#### Scenario: Valid CSV is uploaded

- **WHEN** the owner uploads a supported CSV within file/row/column limits
- **THEN** the system SHALL show detected mapping, valid rows, invalid rows, and suspected duplicates without yet creating transactions

#### Scenario: Owner commits a valid preview

- **WHEN** the owner confirms an unexpired preview
- **THEN** the system SHALL insert valid non-duplicate rows idempotently as `CSV` transactions and report row-level results

#### Scenario: Invalid CSV is uploaded

- **WHEN** the file exceeds limits, has an unsupported encoding/shape, or contains invalid required values
- **THEN** the system SHALL reject or isolate the affected rows with actionable field errors and SHALL NOT partially commit without confirmation

### Requirement: Import deduplication and source retention

The system SHALL use a batch content checksum and canonical row fingerprint to detect repeat submissions while retaining the import batch and row source on committed transactions.

#### Scenario: Same batch is committed twice

- **WHEN** an already committed import is submitted with the same idempotency key/checksum
- **THEN** the API SHALL return the original result and SHALL NOT duplicate transactions

#### Scenario: A row is only a suspected duplicate

- **WHEN** its fingerprint resembles an existing transaction but is not an exact previously committed row
- **THEN** the preview SHALL flag it for owner decision rather than silently dropping it

### Requirement: Filtered transaction CSV export

The owner SHALL be able to export the current transaction-filter population to CSV with stable headers, ISO dates, exact minor-unit-compatible amounts, direction, currency, category, source, and categorization provenance.

#### Scenario: Filtered export is requested

- **WHEN** the owner exports a date/account/category filter
- **THEN** the CSV rows SHALL represent the same canonical transaction population as the UI filter

#### Scenario: Exported text begins with a spreadsheet formula marker

- **WHEN** a text cell begins with `=`, `+`, `-`, `@`, tab, or carriage return in a way that spreadsheet software could execute
- **THEN** the CSV serializer SHALL neutralize it while preserving a documented round-trip representation

### Requirement: Complete versioned JSON export

The owner SHALL be able to download a versioned JSON export containing portable account display data, transactions, categories, merchant rules, transfer decisions, category audits, and import provenance.

#### Scenario: Full export is requested

- **WHEN** the authenticated owner requests a complete export
- **THEN** the file SHALL include a schema version, export timestamp, timezone, integer minor units, currencies, and all portable ledger records needed by the documented restore path

### Requirement: Secret-free exports

No export SHALL include Plaid access/public tokens, Plaid client secrets, Access assertions/cookies, encryption keys/IV material, raw webhook bodies, internal CSRF secrets, or log payloads.

#### Scenario: Export content is inspected

- **WHEN** a complete JSON or transaction CSV export is generated
- **THEN** automated validation SHALL confirm that secret fields and known token patterns are absent

### Requirement: Versioned database evolution and recovery evidence

All D1 schema changes SHALL be represented by ordered migration files, and any destructive migration MUST be preceded by a verified full export/restore test against a separate database.

#### Scenario: Destructive migration is proposed

- **WHEN** a migration drops or irreversibly transforms ledger data
- **THEN** implementation SHALL NOT apply it remotely until the current JSON export restores successfully and report totals reconcile in a separate test database

### Requirement: Provider-exit path

Loss of Plaid availability or a free hosting feature SHALL NOT make existing ledger data inaccessible in a proprietary-only format.

#### Scenario: Bank synchronization is permanently disabled

- **WHEN** the owner stops or cannot continue Plaid synchronization
- **THEN** existing transactions SHALL remain viewable/exportable and the owner SHALL still be able to use manual entry and CSV import where hosting remains available
