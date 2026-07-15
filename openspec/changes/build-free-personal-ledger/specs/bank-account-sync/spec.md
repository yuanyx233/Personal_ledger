## ADDED Requirements

### Requirement: Supported institutions and account scope

The system SHALL accept Plaid Items only for configured RBC or BMO institutions and SHALL persist/sync only selected `depository/checking` and `credit/credit card` accounts.

#### Scenario: Owner selects eligible accounts

- **WHEN** the owner connects RBC or BMO and selects chequing and credit card accounts
- **THEN** the system SHALL enable those accounts for synchronization

#### Scenario: Unsupported account is returned

- **WHEN** Plaid returns a savings, investment, loan, mortgage, or other unsupported account
- **THEN** the system SHALL leave it disabled and SHALL NOT ingest its transactions

#### Scenario: Unsupported institution token is submitted

- **WHEN** a public token resolves to an institution other than configured RBC or BMO
- **THEN** the system SHALL reject the Item before saving an access token

### Requirement: Least-privilege Link configuration

Initial Link tokens SHALL request only the Transactions product for Canada, request up to 730 days of history, enable account selection, and apply checking/credit-card account filters.

#### Scenario: Initial link token is created

- **WHEN** the owner starts a new bank connection
- **THEN** the generated Link token configuration SHALL contain only the approved product, country, history window, and account filters

#### Scenario: Institution provides less history

- **WHEN** an institution returns less than the requested 730 days
- **THEN** the system SHALL import all available history and SHALL display the earliest available date without fabricating missing transactions

### Requirement: Minimal Item creation and repair

The system SHALL normally maintain at most one active Item per configured institution login and MUST use Plaid update mode to repair login, consent, or account-selection problems when the existing Item is recoverable.

#### Scenario: Existing Item needs reauthentication

- **WHEN** Plaid reports `ITEM_LOGIN_REQUIRED` or consent expiry for an active Item
- **THEN** the connection SHALL enter `ACTION_REQUIRED` and the UI SHALL launch update mode for that Item

#### Scenario: Update mode succeeds

- **WHEN** the owner completes update mode
- **THEN** the system SHALL continue with the original Item/access token and SHALL resume incremental synchronization

#### Scenario: Owner attempts a second active Item for one institution

- **WHEN** an active Item already exists for that institution login
- **THEN** the UI SHALL explain the Trial Item limit and require explicit confirmation before creating another Item

### Requirement: Cursor-based incremental synchronization

The system MUST use `/transactions/sync` with one persisted cursor per Item and SHALL process every returned page before committing the new cursor.

#### Scenario: Multi-page sync succeeds

- **WHEN** all pages of an incremental sync are fetched and persisted successfully
- **THEN** added, modified, and removed records SHALL be committed together with the final cursor

#### Scenario: A later page fails

- **WHEN** any page in the cursor loop fails before the batch completes
- **THEN** the new cursor SHALL NOT be committed and a retry SHALL restart from the last committed cursor

#### Scenario: Sync is retried

- **WHEN** a previously processed transaction id appears again
- **THEN** the existing canonical transaction SHALL be updated idempotently rather than duplicated

### Requirement: Verified and idempotent webhook intake

The public webhook Worker MUST validate the Plaid verification JWT and body hash, enforce request limits and schema validation, and store a minimal idempotent sync event before returning.

#### Scenario: Valid transaction webhook arrives

- **WHEN** a correctly signed webhook references a known Item
- **THEN** the system SHALL record one sync event and return promptly without doing unbounded work in the receiver

#### Scenario: Forged webhook arrives

- **WHEN** the verification JWT, signature, timestamp, key, or body hash is invalid
- **THEN** the system SHALL reject the webhook before it can schedule a sync or alter ledger data

#### Scenario: Duplicate or out-of-order webhook arrives

- **WHEN** a semantically duplicate or older webhook is received
- **THEN** the event SHALL be accepted idempotently or ignored without duplicating transactions or moving a cursor backward

### Requirement: Catch-up and owner-triggered sync

The system SHALL run a scheduled catch-up sync at least hourly and SHALL let the authenticated owner request an immediate idempotent sync without allowing concurrent runs for the same Item.

#### Scenario: Webhook is missed

- **WHEN** an active Item has not synchronized within the allowed freshness window
- **THEN** the scheduled handler SHALL enqueue or execute a catch-up sync

#### Scenario: Owner requests refresh during an active run

- **WHEN** the same Item already has an active sync lease
- **THEN** the API SHALL return the existing run status and SHALL NOT start a competing cursor loop

#### Scenario: Work cannot finish within one execution

- **WHEN** a sync reaches a platform execution or retry boundary
- **THEN** its safe checkpoint SHALL remain pending for a later scheduled run without committing a partial cursor

### Requirement: Visible connection health

For each connection, the system SHALL expose institution, enabled accounts, connection status, last successful sync time, current run state, sanitized failure reason, and the next owner action.

#### Scenario: Connection is healthy

- **WHEN** the latest sync completed within the freshness window
- **THEN** the UI SHALL show its success time and no repair action

#### Scenario: Owner action is required

- **WHEN** a connection cannot proceed without reauthorization or account selection
- **THEN** the UI SHALL show an actionable repair state rather than silently presenting stale data

### Requirement: Free-plan failure behavior

The system MUST NOT automatically enable a paid Plaid or Cloudflare tier and SHALL preserve existing ledger access and export paths when background synchronization is blocked by a free-plan limit.

#### Scenario: A free quota is exhausted

- **WHEN** a provider rejects further background work due to a free-plan limit
- **THEN** sync SHALL pause with a visible stable error code, and existing data/manual entry/export SHALL remain available where the platform permits
