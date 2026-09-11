## ADDED Requirements

### Requirement: Owner-confirmed subscription plans

The system SHALL represent a subscription as a versioned plan containing name, normalized merchant key, account label, amount in integer minor units, currency, category, cadence (`MONTHLY` or `YEARLY`), next charge date, and status (`ACTIVE`, `PAUSED`, or `CANCELLED`). A detected recurring pattern MUST remain a candidate until the owner explicitly confirms it.

#### Scenario: Recurring history looks like a subscription

- **WHEN** deterministic history analysis finds repeated same-account outflows with compatible merchant, amount, and cadence evidence
- **THEN** the system MAY show a bounded subscription candidate but SHALL NOT create a plan or future transaction automatically

#### Scenario: Owner confirms a candidate

- **WHEN** the owner reviews and confirms the merchant, amount, category, account, cadence, and next charge date
- **THEN** the system SHALL create one active subscription plan and SHALL NOT recreate its already imported historical charges

#### Scenario: Owner creates a plan manually

- **WHEN** no suitable candidate exists and the owner submits valid plan fields
- **THEN** the system SHALL create the same kind of versioned active plan as a confirmed candidate

### Requirement: Idempotent due-date generation

For each active plan, the scheduled application Worker SHALL use the `America/Toronto` calendar date and generate exactly one `POSTED` canonical manual transaction linked to a subscription occurrence for each due date at or before the current date. The occurrence identity SHALL be unique by subscription and scheduled date so retries, concurrent runs, and catch-up execution cannot double count it. The UI SHALL derive and display the subscription origin from that relationship without expanding the existing provider-source enum.

#### Scenario: Active monthly plan reaches its charge date

- **WHEN** the scheduled handler runs on or after `nextChargeDate`
- **THEN** it SHALL atomically create the due occurrence/transaction, advance the plan to its next valid calendar date, and include the generated transaction in actual spending reports

#### Scenario: Scheduled generation is retried

- **WHEN** the same subscription and scheduled date are processed again
- **THEN** the system SHALL return/reuse the existing occurrence and SHALL NOT create a second transaction

#### Scenario: Worker was unavailable across several due dates

- **WHEN** an active plan has multiple missed due dates
- **THEN** a bounded catch-up SHALL generate each unique due occurrence in order, or stop with a visible stable action-required state before platform limits are exceeded

#### Scenario: Month lacks the configured day

- **WHEN** a monthly plan anchored to day 29, 30, or 31 advances into a shorter month
- **THEN** that occurrence SHALL use the target month’s last calendar day without permanently changing the plan’s preferred anchor day

### Requirement: Subscription lifecycle management

The owner SHALL be able to list, create, edit, pause, resume, and cancel subscription plans with optimistic version checks. Changes affect future due dates only unless the owner separately edits a generated occurrence.

#### Scenario: Owner pauses a subscription

- **WHEN** an active plan is changed to `PAUSED` before a due occurrence is claimed
- **THEN** no future occurrence SHALL be generated until the owner resumes it with a reviewed next charge date

#### Scenario: Owner cancels a subscription

- **WHEN** a plan is changed to `CANCELLED`
- **THEN** its historical occurrences SHALL remain visible and no new occurrence SHALL be generated

#### Scenario: Owner changes price or charge date

- **WHEN** amount, category, account, cadence, or next charge date is updated with the current version
- **THEN** the new values SHALL apply only to subsequently generated occurrences and historical transactions SHALL remain unchanged

#### Scenario: Two devices edit the same plan

- **WHEN** a write supplies a stale plan version
- **THEN** the system SHALL return 409 with the current safe read model and SHALL NOT silently overwrite the newer state

### Requirement: Single occurrence correction

The owner SHALL be able to mark an automatically generated occurrence as not charged without pausing or cancelling the plan. This action SHALL retain audit/provenance, exclude the occurrence transaction from normal reports, and leave later due dates unchanged.

#### Scenario: Expected charge did not occur

- **WHEN** the owner marks one generated occurrence “未发生”
- **THEN** its canonical transaction SHALL become removed/excluded with an audited owner reason while the active plan continues to its existing next charge date

### Requirement: Subscription management interface

The protected application SHALL provide a dedicated subscription section showing active plans first, status, amount/currency, account, category, cadence, next charge date, recent generated occurrences, and candidate evidence. All merchant and plan text SHALL render as untrusted text.

#### Scenario: Owner checks whether subscriptions remain active

- **WHEN** the owner opens subscription management
- **THEN** active, paused, and cancelled plans SHALL be distinguishable by text and controls, and each active plan SHALL expose its next expected charge date

#### Scenario: No plans are confirmed

- **WHEN** no subscription plan exists
- **THEN** the page SHALL show a useful empty state with actions to review candidates or add a plan manually

### Requirement: Portable subscription data

The complete JSON export and restore path SHALL include subscription plans, generated occurrences, their canonical transaction relationships, statuses, versions, and audit-safe owner decisions without including Access cookies, secrets, or scheduling internals.

#### Scenario: Subscription-enabled ledger is exported and restored

- **WHEN** a complete export is restored into a separate empty local database
- **THEN** plan/occurrence counts, relationships, future next charge dates, and report totals SHALL reconcile without regenerating already exported occurrences
