## ADDED Requirements

### Requirement: Configurable ledger timezone
The ledger timezone SHALL be a deployment configuration value accepting any IANA timezone identifier, replacing the fixed `America/Toronto` literal. All date-boundary decisions — the current month, analysis periods, quick-entry defaults, subscription due dates, and scheduled generation — MUST derive from that single configured value.

#### Scenario: Deployment outside Toronto
- **WHEN** an instance is configured with `Europe/Berlin` and the owner records an entry near local midnight
- **THEN** the entry's date, the current-month totals, and subscription due dates all use Berlin's calendar day, and no part of the application falls back to Toronto.

#### Scenario: Unchanged default
- **WHEN** an instance is configured with `America/Toronto`
- **THEN** every date boundary behaves exactly as before this change, and existing ledger data needs no migration.

#### Scenario: Invalid identifier
- **WHEN** an instance is configured with a value that is not a valid IANA timezone identifier
- **THEN** environment validation fails at startup with an error naming the offending variable, and the application does not serve requests with a silently substituted timezone.

### Requirement: Report periods carry no timezone label
Report period resolution is pure calendar arithmetic and MUST NOT accept or return a timezone. Interfaces that tell the viewer which calendar a report follows SHALL read the configured timezone directly rather than receive it through the report payload.

#### Scenario: Resolved period shape
- **WHEN** a report period is resolved for any grain
- **THEN** the result contains only the date range, grain, and label, and the same input yields the same range regardless of the instance's configured timezone.

#### Scenario: Interface still names the calendar
- **WHEN** the analysis view states which calendar the period follows
- **THEN** it names the instance's configured timezone, not a value carried in the report response.

### Requirement: Frontend and Worker timezone agreement
The browser-side timezone value and the Worker-side timezone value SHALL be validated as equal. A mismatch MUST fail loudly rather than produce dates that disagree between the two halves of the application.

#### Scenario: Operator configures only one half
- **WHEN** the Worker timezone is changed but the frontend build-time value is not
- **THEN** the mismatch is detected and reported with both values, instead of the UI and the stored records disagreeing about which day a transaction belongs to.

### Requirement: Open currency set restricted to two-decimal currencies
Currency validation SHALL accept any three-letter uppercase ISO 4217 code, replacing the fixed `CAD`/`USD` enumeration, and MUST align with the existing database constraint. Monetary amounts remain stored as integer minor units at a fixed ratio of 1/100, so currencies whose minor unit is not 1/100 MUST NOT be presented as supported.

#### Scenario: Two-decimal currency
- **WHEN** the owner records, imports, budgets, or exports an amount in `EUR`
- **THEN** it is accepted, stored, reported, and exported exactly as `CAD` and `USD` are, with amounts separated by currency in every report.

#### Scenario: Currency whose minor unit is not 1/100
- **WHEN** an amount in `JPY` or `KWD` is submitted
- **THEN** it is rejected with an explicit unsupported-currency error rather than stored at an incorrect scale, and the limitation is stated in user-facing documentation.

#### Scenario: Malformed currency code
- **WHEN** a value that is not three uppercase letters is submitted
- **THEN** validation rejects it before it reaches the database constraint.

### Requirement: CSV currency inference beyond two currencies
CSV import SHALL infer or require a currency without assuming exactly two candidates. When a row's currency cannot be determined unambiguously, the import MUST surface it for explicit resolution rather than guessing.

#### Scenario: File containing a third currency
- **WHEN** a CSV containing `EUR` rows is previewed
- **THEN** the preview reports the detected currency per row and does not misattribute rows to `CAD` or `USD`.

### Requirement: Backup portability across regional configurations
Full JSON export and restore SHALL record the instance's configured timezone and currencies without a fixed-value constraint, while keeping the existing `schemaVersion`. Backups produced before this change MUST continue to restore unchanged.

#### Scenario: Existing backup restored after upgrade
- **WHEN** a backup produced before this change is restored
- **THEN** it validates and restores with no migration step and no loss of fields.

#### Scenario: Backup from a differently configured instance
- **WHEN** a backup whose recorded timezone differs from the restoring instance's configured timezone is restored
- **THEN** the mismatch is reported to the operator before any write, because stored dates were computed under the backup's timezone.
