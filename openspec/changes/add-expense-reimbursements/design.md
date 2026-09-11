## Context

Transactions store positive minor units plus direction. Reporting reads posted transactions through one shared query. Categories and transfer matches retain their current semantics.

## Goals / Non-Goals

Goals: preserve actual amounts, record manual deductions at entry or later, and use personal amounts consistently in reports and backups.
Non-goals: automatic EMT classification, tracking debtors, matching repayments, creating synthetic income, or deployment.

## Decisions

- Store `reimbursement_minor` on each transaction, default 0, constrained to an integer between 0 and `amount_minor`. For outflows it is the reimbursed portion; for inflows it is the repayment portion excluded from reports. One amount suffices; separate statuses and matching tables are unnecessary for this request.
- Reports use `amount_minor - reimbursement_minor`, including refund calculations. Thus 300 payment minus 200 reimbursement contributes 100; a separately recorded 200 repayment excluded in full contributes zero. Original amounts remain the ledger and sorting source.
- Add optional decimal `reimbursementAmount` to manual creation/update, and a strict versioned reimbursement-only PATCH accepted for any posted transaction. No merchant rules modify this field. Validation happens before writes and is reinforced by D1 constraints.
- Quick entry offers an unchecked checkbox and a deduction field with a live personal amount. Inflow checkbox excludes the whole receipt. Detail editing allows later corrections and clearing the deduction. No financial data is persisted in browser storage.
- Extend JSON transaction records with a defaulted field so old backups remain restorable; export it explicitly. CSV adds original-independent reimbursement and personal minor-unit columns. Restore verification uses adjusted report totals while preserving raw totals.

## Risks / Trade-offs

- Separate records require two explicit choices → show that original-payment deduction and receipt exclusion are independent; do not invent links or double-subtract receipts.
- Existing local changes → modify only relevant files, preserve unrelated work.
- Older deployment lacks the column → apply the additive migration before deploying code; no remote migration in this task.

## Migration Plan

Add migration 0018 with zero default and bounds check. Test fresh and old-record databases plus JSON restore. A code rollback may leave the unused additive column intact.
