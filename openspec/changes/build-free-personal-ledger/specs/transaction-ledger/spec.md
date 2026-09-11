## ADDED Requirements

### Requirement: Unified canonical ledger

The system SHALL store Plaid, manual (including transactions linked to subscription occurrences), and committed CSV transactions in one canonical ledger with source, account, status, dates, amount, direction, currency, description/merchant, category provenance, review state, version, and audit timestamps.

#### Scenario: Transactions from different sources are viewed

- **WHEN** the owner opens the transaction list
- **THEN** eligible Plaid, manual, subscription-linked, and CSV records SHALL appear under the same filters and detail contract with visible provider source and subscription-origin metadata where applicable

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

The owner SHALL be able to create, edit, and delete manual transactions with date, direction, amount, currency, description, account label, and an optional category, subject to validation and optimistic concurrency. The first release SHALL accept CAD and USD for manual entry. A missing category SHALL resolve through an active exact owner rule or remain `Unclassified` for immediate/review confirmation.

#### Scenario: Valid manual transaction is saved

- **WHEN** the owner submits the required transaction fields with a current CSRF token
- **THEN** a `MANUAL` transaction SHALL be added to the canonical ledger and included in reports under the same rules as posted imports

#### Scenario: Quick entry omits category

- **WHEN** the owner records a valid purchase without choosing a category and no active exact rule matches
- **THEN** the transaction SHALL be created once as `Unclassified`, included in total spending, and returned with confirmation-required metadata

#### Scenario: Two devices edit the same transaction

- **WHEN** a write carries a stale version
- **THEN** the system SHALL return 409 with the current version and SHALL NOT silently overwrite the newer edit

#### Scenario: Unsupported manual-entry currency is submitted

- **WHEN** the owner submits a manual transaction in a currency other than CAD or USD
- **THEN** the system SHALL return 422 and SHALL NOT create a ledger entry

### Requirement: Exact money representation

The system MUST represent money using non-negative integer minor units plus explicit `INFLOW`/`OUTFLOW` direction and ISO currency; it MUST NOT use binary floating-point for persistence or aggregation.

#### Scenario: Decimal source amount is ingested

- **WHEN** a valid two-decimal CAD amount is received from Plaid, manual entry, or CSV
- **THEN** it SHALL be converted once at the source adapter to exact cents and SHALL round-trip without a cent difference

#### Scenario: Currency cannot be determined

- **WHEN** a transaction lacks a valid currency and no safe account default exists
- **THEN** it SHALL be rejected or marked for review rather than silently treated as CAD

### Requirement: High-confidence internal-transfer exclusion

The system SHALL automatically exclude a transfer only when two enabled owner accounts contain an equal-currency, equal-amount, opposite-direction pair within three days, both sides have a unique counterpart, and either provider payment-method evidence exists or explicit payment text is reinforced by a chequing-to-credit-card account pair. Text-only evidence for other account pairs SHALL require review.

#### Scenario: Chequing pays an enabled credit card

- **WHEN** matching chequing outflow and credit-card inflow records satisfy all high-confidence conditions
- **THEN** the system SHALL link them as an internal transfer and exclude both from income and spending reports

#### Scenario: More than one candidate pair exists

- **WHEN** an eligible transfer has multiple plausible counterparts or lacks supporting evidence
- **THEN** the system SHALL keep it in normal totals provisionally, mark it for review, and SHALL NOT auto-exclude it

#### Scenario: Owner reverses a transfer decision

- **WHEN** the owner confirms or removes a transfer match
- **THEN** the manual decision SHALL be audited and SHALL override subsequent automatic matching

#### Scenario: Owner ignores an ambiguous candidate

- **WHEN** the owner ignores one pending transfer candidate with the current match version
- **THEN** the system SHALL retain the pair as an audited owner rejection and SHALL NOT recreate that pair during later automatic matching

### Requirement: External Interac e-Transfer preservation

An Interac e-Transfer SHALL remain an income/expense candidate unless it is matched to another enabled owner account under the internal-transfer rule; optional payer/payee/reference data SHALL be displayed only when supplied by Plaid.

#### Scenario: Outgoing e-Transfer has no owner-account counterpart

- **WHEN** an outgoing e-Transfer cannot be paired with an enabled owner account
- **THEN** it SHALL remain an outflow and SHALL enter review if its purpose/category is uncertain

#### Scenario: Counterparty metadata is absent

- **WHEN** Plaid supplies no payer, payee, reference, or method detail
- **THEN** the UI SHALL indicate the field was not provided and SHALL NOT invent a counterparty

#### Scenario: Partial counterparty metadata is supplied

- **WHEN** Plaid supplies only some payer, payee, reference, or method fields for an e-Transfer
- **THEN** the transaction read model SHALL return those exact supplied values, represent the other four-field contract values as not provided, and SHALL NOT expose other payment metadata

#### Scenario: An e-Transfer is confirmed as internal

- **WHEN** an e-Transfer receives an active automatic or owner-confirmed match to another enabled owner account
- **THEN** its uncertain e-Transfer review flag SHALL clear atomically while the original transaction direction and metadata remain unchanged

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
