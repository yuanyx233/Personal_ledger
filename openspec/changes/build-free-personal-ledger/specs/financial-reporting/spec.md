## ADDED Requirements

### Requirement: One eligible-transaction population

All reports SHALL use only `POSTED` transactions that are not `REMOVED` and not confirmed internal transfers; `PENDING` transactions SHALL be visible in the ledger but excluded from report totals.

#### Scenario: Pending and posted version both exist

- **WHEN** a posted transaction replaces a pending transaction in a reporting period
- **THEN** the reports SHALL count the posted version exactly once

#### Scenario: Confirmed credit-card payment exists

- **WHEN** both sides of a card payment are linked as an internal transfer
- **THEN** neither side SHALL change income, spending, or net cash flow

### Requirement: Defined cash-flow metrics

For each currency and period, the system SHALL calculate `income` as income-category inflows minus income-category outflows, `net_spending` as expense-category outflows minus expense-category inflows, and `net_cash_flow` as `income - net_spending`.

#### Scenario: Expense refund occurs in the period

- **WHEN** an expense-category inflow is posted in the selected period
- **THEN** it SHALL reduce net spending for that category and SHALL NOT be added to income

#### Scenario: Period has income and spending

- **WHEN** eligible transactions contain both kinds of flow
- **THEN** total net cash flow SHALL exactly equal reported income minus reported net spending

### Requirement: Calendar month, quarter, and year analysis

The system SHALL provide natural month, quarter, and year views using `posted_date` and `America/Toronto` calendar boundaries, plus an explicit custom date range.

#### Scenario: Owner chooses a calendar year

- **WHEN** a year is selected
- **THEN** the system SHALL show year totals and a monthly series for January through December, including zero-value months

#### Scenario: Transaction posts at a period boundary

- **WHEN** a posted date is the first day of a Toronto calendar month
- **THEN** the transaction SHALL belong to the new month regardless of Worker/database UTC execution time

### Requirement: Comparable period changes

Month, quarter, and year views SHALL show like-for-like previous-period and previous-year comparisons for income, net spending, and net cash flow.

#### Scenario: Prior comparison value is non-zero

- **WHEN** current and prior values exist under the same filters
- **THEN** the report SHALL show both absolute change and percentage change

#### Scenario: Prior comparison value is zero

- **WHEN** percentage change would divide by zero
- **THEN** the report SHALL show `N/A` for the percentage while retaining the absolute values

### Requirement: Breakdown, ranking, and drill-down

Reports SHALL provide category distribution, merchant ranking, account filters, and drill-down links whose transaction population reconciles to the displayed aggregate.

#### Scenario: Merchant orders or branches have different descriptions

- **WHEN** expense transactions belong to the same explicitly recognized merchant service, such as Amazon shopping orders or T&T branches
- **THEN** the ranking SHALL combine their transaction counts and net spending under a readable merchant name, including refunds and reimbursements
- **AND** distinct services SHALL remain separate, including Amazon shopping versus Prime and Uber rides versus Uber Eats
- **AND** drill-down, pagination, and filtered CSV exports SHALL include the same merchant family within the selected period, account, category, and currency
- **AND** unknown merchants SHALL retain exact grouping, and original transaction descriptions, exact merchant keys, category rules, and duplicate matching SHALL remain unchanged

#### Scenario: Owner opens a category total

- **WHEN** the owner selects a category in a report
- **THEN** the app SHALL open the transaction view with matching date/currency/category filters represented in the URL

#### Scenario: Category rows are summed

- **WHEN** all displayed category amounts for a period/currency are combined
- **THEN** they SHALL reconcile to the corresponding report total subject only to explicitly shown unclassified/rounding rows

### Requirement: Currency separation without implicit FX

The system MUST group and total each currency independently and MUST NOT combine non-CAD numeric amounts into CAD without an explicit future exchange-rate design.

#### Scenario: CAD and USD transactions exist

- **WHEN** a period contains both currencies
- **THEN** the report SHALL show separate CAD and USD sections/totals and SHALL NOT present their arithmetic sum as a monetary total

### Requirement: Accessible and evidence-backed presentation

Every chart SHALL include an accessible tabular equivalent, explicit units and period labels, keyboard-operable drill-down, and non-color-only state encoding; stale data SHALL be labeled with the latest successful sync time.

#### Scenario: Chart cannot be perceived visually

- **WHEN** the report is navigated by keyboard or assistive technology
- **THEN** the same values and drill-down destinations SHALL be available through the accompanying table

#### Scenario: A connection is stale

- **WHEN** one or more enabled accounts have not synchronized within the freshness window
- **THEN** the report SHALL show a stale-data warning and last-success time rather than implying the period is complete

### Requirement: Report query safety and reproducibility

Report endpoints SHALL validate date ranges, filters, grouping grain, sort keys, and result limits against allowlists and SHALL return enough metadata to reproduce the transaction population.

#### Scenario: Unsupported group or excessive range is requested

- **WHEN** a client sends an unapproved grouping value or a range beyond the configured maximum
- **THEN** the API SHALL return a validation error without executing an unbounded query
