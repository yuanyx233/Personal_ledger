## ADDED Requirements

### Requirement: Optional installment quick entry

The system SHALL let the owner mark a quick-entry transaction as installment-based and select an integer count from 2 through 60. The entered amount SHALL represent the total across all installments; omitting installments SHALL preserve the existing single-transaction flow.

#### Scenario: Owner enables installments

- **WHEN** the owner enters a valid total amount, enables installments, chooses a count from 2 through 60, and saves
- **THEN** the system SHALL create exactly that many posted manual transactions in one installment group

#### Scenario: Installment count is invalid

- **WHEN** a create request supplies a non-integer count or a count outside 2 through 60
- **THEN** the system SHALL return validation failure without creating any transaction

### Requirement: Exact installment allocation

The system MUST allocate the total in integer minor units, SHALL give every installment except the final one the same floored share, and SHALL assign the final installment all remaining minor units. Any reimbursement total SHALL be allocated by the same rule without exceeding the corresponding installment amount.

#### Scenario: Total does not divide evenly

- **WHEN** the owner records $100.00 over 3 installments
- **THEN** the system SHALL create amounts of $33.33, $33.33, and $33.34 in that order

#### Scenario: Installment writes cannot all complete

- **WHEN** any write in the installment group fails
- **THEN** the system SHALL create no installment from that submission

### Requirement: Monthly calendar schedule

The first installment SHALL use the selected quick-entry date. Each later installment SHALL use the same calendar day in its subsequent month, clamped to that month’s final day when the original day does not exist.

#### Scenario: Month-end schedule crosses February

- **WHEN** the first installment date is January 31 and later periods include February and March
- **THEN** the later dates SHALL be February’s final day and March 31

### Requirement: Consistent classification

Every installment in one group SHALL preserve the submitted account, currency, direction, merchant/description, and resolved category. When the owner confirms a new merchant, the system SHALL save at most one merchant rule and apply its category to every installment.

#### Scenario: Known merchant schedule is created

- **WHEN** an active merchant rule classifies the submitted description
- **THEN** every created installment SHALL reference the same rule and category without another confirmation

#### Scenario: New merchant is confirmed

- **WHEN** the owner confirms a category for a new merchant before creating an installment schedule
- **THEN** every installment SHALL use that category and the system SHALL save one future merchant rule

### Requirement: Visible and portable installment identity

Each installment SHALL expose a stable group id, one-based installment number, and total count in transaction list/detail reads and full JSON portability. The UI SHALL display `第 x/n 期` separately from the unchanged merchant/description.

#### Scenario: Installments appear in the ledger

- **WHEN** the owner views a transaction belonging to an installment group
- **THEN** the list and detail SHALL display its position and count without altering its merchant/description

#### Scenario: Normal transaction appears in the ledger

- **WHEN** a transaction has no installment metadata
- **THEN** the existing list, detail, reports, export, and restore behavior SHALL remain unchanged
