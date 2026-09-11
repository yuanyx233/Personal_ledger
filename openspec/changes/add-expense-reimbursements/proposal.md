## Why

Shared purchases currently count the full payment as personal spending. Reimbursements must not inflate income or reduce spending twice.

## What Changes

- Add an explicit optional reimbursement deduction when recording a transaction; preserve the original payment amount.
- Allow the owner to adjust this amount on existing posted transactions, including imported receipts.
- Apply the adjusted amount consistently to personal reports and retain it in exports and restores.
- Never infer reimbursement from EMT, a description, a merchant rule, or a payment method.

## Capabilities

### New Capabilities

- `expense-reimbursements`: Owner-selected deductions and repayment exclusions with consistent reporting and portability.

### Modified Capabilities

None.

## Impact

Transaction contracts, D1 migration, transaction reads and writes, reporting, quick entry, details, CSV and JSON portability, and regression tests. No deployment or new dependency.
