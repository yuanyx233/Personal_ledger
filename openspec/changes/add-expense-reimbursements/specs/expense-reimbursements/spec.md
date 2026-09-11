## ADDED Requirements

### Requirement: Explicit personal amount

The owner SHALL be able to opt into a reimbursement deduction during manual entry and edit or clear it on posted transactions. The original amount SHALL remain unchanged and deductions MUST be nonnegative minor-unit integers no greater than that amount.

#### Scenario: Shared meal

- **WHEN** a payment of 300 has a reimbursement deduction of 200
- **THEN** the original payment SHALL remain 300 and the personal spending SHALL be 100 in totals, trends, and breakdowns

#### Scenario: Invalid or stale adjustment

- **WHEN** a deduction exceeds the payment, has invalid precision, or uses a stale transaction version
- **THEN** the operation SHALL fail without modifying the record

#### Scenario: Clear adjustment

- **WHEN** the owner clears an existing deduction
- **THEN** the full original amount SHALL resume contributing under the existing reporting rules

### Requirement: Repayments excluded once

Explicitly marked repayment portions SHALL contribute neither income nor an additional spending refund. EMT descriptions and payment metadata MUST NOT opt transactions in automatically.

#### Scenario: Separate repayment

- **WHEN** an inflow of 200 is marked entirely as repayment alongside a 300 payment with a 200 deduction
- **THEN** income SHALL be 0 and personal spending SHALL be 100, including when the repayment is recorded in a different period

#### Scenario: Ordinary EMT

- **WHEN** an EMT transaction has no owner-selected deduction
- **THEN** it SHALL retain its existing reporting treatment

### Requirement: Portable adjustments

Reads, JSON backups, restores, and CSV exports SHALL retain the original and deducted amounts. Old JSON backups without deductions SHALL restore with zero deductions.

#### Scenario: Round trip

- **WHEN** an adjusted transaction is exported and restored
- **THEN** its original amount, deduction, and resulting report totals SHALL be preserved
