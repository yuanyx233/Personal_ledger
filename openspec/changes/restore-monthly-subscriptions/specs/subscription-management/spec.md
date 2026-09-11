## ADDED Requirements

### Requirement: Manage monthly subscriptions
The owner SHALL create and edit subscriptions with name, positive amount, currency, account, expense category and first charge date on a dedicated page reachable from settings. Every mutation MUST validate input, authorization and optimistic version; creation retries MUST be idempotent.

#### Scenario: Create and inspect
- **WHEN** the owner creates a monthly plan
- **THEN** the page shows its amount, next charge, status and recent recorded charges, and edits affect future charges only.

### Requirement: Automatic expense generation
The app SHALL generate one canonical POSTED/MANUAL outflow per due date in America/Toronto without requiring the website to stay open. Catch-up SHALL be bounded and resumable. Monthly dates SHALL clamp to month end while retaining the anchor day.

#### Scenario: Retry after a missed month
- **WHEN** scheduling runs repeatedly or concurrently after missing monthly due dates
- **THEN** each due date is recorded exactly once and appears in expense reports.

#### Scenario: Month end
- **WHEN** a subscription is anchored on January 31
- **THEN** February uses its last day and March uses March 31.

### Requirement: Cancel with an effective date
Cancellation SHALL accept past, present or future dates and include the effective day. In one atomic operation it MUST remove only this subscription's recorded charges scheduled on or after that date, preserve earlier charges and provenance, and prevent future generation at or after the cutoff. Financial reports SHALL exclude removed charges.

#### Scenario: Late cancellation
- **WHEN** cancellation is entered in September effective July 1
- **THEN** generated July, August and September charges are removed, June remains, and later charges stop.

#### Scenario: Concurrent cancellation and scheduling
- **WHEN** a cancellation races with scheduling or another edit
- **THEN** version guards and atomic writes prevent partial deletion, orphan transactions and generation beyond the winning cutoff.

### Requirement: Resume from a new start
The owner SHALL resume a cancelled subscription with a newly chosen first charge date. The system MUST retain previous history and MUST NOT regenerate dates between cancellation and the new start.

#### Scenario: Subscribe again
- **WHEN** a July cancellation is resumed from September 10
- **THEN** July and August stay removed, the monthly schedule starts September 10, and retries do not duplicate the September charge.

### Requirement: Portable subscription state
Full JSON export and restore SHALL preserve the effective cancellation date, statuses, versions, occurrences and canonical relationships while continuing to accept older backups.

#### Scenario: Restore cancelled plan
- **WHEN** a cancelled subscription is exported and restored
- **THEN** its cutoff and removed historical charges survive and automatic generation does not restart.
