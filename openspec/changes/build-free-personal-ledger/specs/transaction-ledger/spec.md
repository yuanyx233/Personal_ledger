## ADDED Requirements

### Requirement: Unified canonical ledger

The system SHALL store Plaid, manual, and committed CSV transactions in one canonical ledger with source, account, status, dates, amount, direction, currency, description/merchant, category provenance, review state, version, and audit timestamps.

#### Scenario: Transactions from different sources are viewed

- **WHEN** the owner opens the transaction list
- **THEN** eligible Plaid, manual, and CSV records SHALL appear under the same filters and detail contract with a visible source

#### Scenario: Same Plaid transaction is seen twice

- **WHEN** sync processing receives an existing Plaid transaction id again
- **THEN** the system SHALL update the canonical record and SHALL NOT create a second ledger entry

### Requirement: Pending, posted, and removed lifecycle

The ledger SHALL preserve `PENDING`, `POSTED`, and `REMOVED` states and SHALL link a posted transaction to the pending transaction it replaces when Plaid supplies that relationship.

#### Scenario: Pending purchase becomes posted

- **WHEN** Plaid removes/replaces a pending transaction with its posted form
- **THEN** the UI SHALL present the posted transaction as canonical, preserve the lifecycle relationship, and SHALL NOT count both

#### Scenario: Posted transaction is removed upstream

- **WHEN** Plaid reports a canonical transaction as removed
- **THEN** the system SHALL mark it removed, retain audit evidence, and exclude it from normal ledger/report totals

### Requirement: Manual entry

The owner SHALL be able to create, edit, and delete manual transactions with date, direction, amount, currency, description, account label, and category, subject to validation and optimistic concurrency.

#### Scenario: Valid manual transaction is saved

- **WHEN** the owner submits all required fields with a current version/CSRF token
- **THEN** a `MANUAL` transaction SHALL be added to the canonical ledger and included in reports under the same rules as posted imports

#### Scenario: Two devices edit the same transaction

- **WHEN** a write carries a stale version
- **THEN** the system SHALL return 409 with the current version and SHALL NOT silently overwrite the newer edit

### Requirement: Exact money representation

The system MUST represent money using non-negative integer minor units plus explicit `INFLOW`/`OUTFLOW` direction and ISO currency; it MUST NOT use binary floating-point for persistence or aggregation.

#### Scenario: Decimal source amount is ingested

- **WHEN** a valid two-decimal CAD amount is received from Plaid, manual entry, or CSV
- **THEN** it SHALL be converted once at the source adapter to exact cents and SHALL round-trip without a cent difference

#### Scenario: Currency cannot be determined

- **WHEN** a transaction lacks a valid currency and no safe account default exists
- **THEN** it SHALL be rejected or marked for review rather than silently treated as CAD

### Requirement: High-confidence internal-transfer exclusion

The system SHALL automatically exclude a transfer only when two enabled owner accounts contain an equal-currency, equal-amount, opposite-direction pair within three days and provider/text evidence supports payment or transfer semantics.

#### Scenario: Chequing pays an enabled credit card

- **WHEN** matching chequing outflow and credit-card inflow records satisfy all high-confidence conditions
- **THEN** the system SHALL link them as an internal transfer and exclude both from income and spending reports

#### Scenario: More than one candidate pair exists

- **WHEN** an eligible transfer has multiple plausible counterparts or lacks supporting evidence
- **THEN** the system SHALL keep it in normal totals provisionally, mark it for review, and SHALL NOT auto-exclude it

#### Scenario: Owner reverses a transfer decision

- **WHEN** the owner confirms or removes a transfer match
- **THEN** the manual decision SHALL be audited and SHALL override subsequent automatic matching

### Requirement: External Interac e-Transfer preservation

An Interac e-Transfer SHALL remain an income/expense candidate unless it is matched to another enabled owner account under the internal-transfer rule; optional payer/payee/reference data SHALL be displayed only when supplied by Plaid.

#### Scenario: Outgoing e-Transfer has no owner-account counterpart

- **WHEN** an outgoing e-Transfer cannot be paired with an enabled owner account
- **THEN** it SHALL remain an outflow and SHALL enter review if its purpose/category is uncertain

#### Scenario: Counterparty metadata is absent

- **WHEN** Plaid supplies no payer, payee, reference, or method detail
- **THEN** the UI SHALL indicate the field was not provided and SHALL NOT invent a counterparty

### Requirement: Refund treatment

An inflow categorized under an expense category SHALL reduce that category's net spending rather than automatically count as income.

#### Scenario: Merchant refund posts

- **WHEN** a posted inflow is categorized to the original expense category
- **THEN** the report engine SHALL subtract it from that category's outflow for the period

### Requirement: Whole-transaction marketplace treatment

The first release SHALL assign exactly one ledger category to each transaction and SHALL NOT fetch or split Amazon or other marketplace order line items.

#### Scenario: Amazon transaction is ingested

- **WHEN** an Amazon charge posts
- **THEN** the ledger SHALL retain one transaction with one current category and its full bank amount

### Requirement: Filterable and traceable transaction view

The owner SHALL be able to filter transactions by date, account, status, category, source, categorization source, and review state, and open a detail view containing the raw description, normalized merchant, lifecycle, transfer decision, and category audit.

#### Scenario: Owner asks which transactions were automatically categorized

- **WHEN** the owner selects a Plaid-automatic or rule-automatic categorization-source filter
- **THEN** the list SHALL show only matching transactions and SHALL retain the filter in the URL
