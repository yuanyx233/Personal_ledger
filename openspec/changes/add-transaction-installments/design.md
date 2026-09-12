## Context

Quick entry currently previews merchant classification, then creates exactly one manual transaction through `POST /api/v1/transactions`. Manual transactions, transaction list/detail reads, reports, and portable JSON all share the canonical `transactions` table. The installment feature must preserve those paths: every installment is a normal posted manual transaction, while nullable group metadata lets the UI explain their relationship.

## Goals / Non-Goals

**Goals:**

- Create 2–60 monthly installments atomically from one quick-entry submission.
- Preserve exact total minor units, selected start date semantics, category resolution, merchant rules, and report behavior.
- Expose installment position in existing transaction list/detail reads without altering the merchant description.
- Preserve installment metadata through full JSON export and restore.

**Non-Goals:**

- Interest, fees, amortization, loans, payment reminders, or automatic bank actions.
- Editing or deleting an entire installment group at once; existing per-transaction mutations remain unchanged.
- Deferring database creation until each future date. Future-dated posted entries are created immediately and naturally enter reports when their date falls in a selected period.

## Decisions

1. **Store nullable installment columns on canonical transactions.** Add `installment_group_id`, `installment_number`, and `installment_count`, constrained so they are either all null or a valid manual-transaction tuple. This avoids a second schedule table because every period is materialized immediately. A separate schedule table was rejected as unnecessary lifecycle state.

2. **Extend the existing create request with optional `installmentCount`.** Absence keeps the current single-transaction behavior. The preview request accepts the same optional field so the existing strict preview flow can pass one draft through both calls. The create response retains `transaction` as the first created record and adds a bounded `transactions` array, preserving the established first-record location while exposing the complete result.

3. **Allocate in integer minor units.** For total `T` and count `N`, periods 1 through `N-1` receive `floor(T/N)` and period `N` receives the remainder. Reimbursement totals, when present, use the same rule. This guarantees exact sums without floating-point arithmetic.

4. **Derive dates from the original calendar day.** Each period computes its year/month directly from the selected first date and clamps the original day to that month’s final day. Dates are not derived from the previous clamped date, so January 31 becomes February 28/29 and then March 31.

5. **Use one D1 batch for the group.** The repository generates one group id and all transaction ids, resolves the category consistently, optionally upserts one merchant rule, and submits every write in one transactional batch. Any failed statement prevents a partial schedule.

6. **Render metadata as a badge/field.** List rows show `第 x/n 期`; detail adds the same structured value under original fields. The stored merchant and normalized merchant stay unchanged so categorization, searching, and merchant-family grouping continue to work.

## Risks / Trade-offs

- **Future transactions are visible immediately** → Existing date filters and descending sort make this explicit; the UI reports successful creation of all periods.
- **A 60-period request expands one API call into many writes** → Bound the request to 60 and use one batch rather than sequential round trips.
- **Older rows lack metadata** → Nullable columns and nullable API fields preserve all existing records and clients.
- **Existing per-item edits can make a schedule uneven** → Keep group metadata descriptive only; group-wide mutation is explicitly out of scope.

## Migration Plan

1. Add nullable columns, tuple integrity checks, and a group index in migration `0021`.
2. Deploy code that understands both null legacy rows and populated installment rows.
3. Rollback code can ignore the nullable columns; the migration is additive and existing records require no backfill.

## Open Questions

None for the agreed first release.
