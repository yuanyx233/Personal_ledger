## 1. Transaction and report semantics

- [x] 1.1 Add bounded deduction contracts, migration, reads, atomic creation and versioned adjustment; verify invalid inputs and stale writes.
- [x] 1.2 Use personal amounts consistently in reports; verify 300/200 meal, excluded repayment, zero/full deduction, and ordinary EMT.

## 2. Portability and interface

- [x] 2.1 Preserve deductions in JSON export/restore and CSV; verify round-trip and old backups.
- [x] 2.2 Add optional entry controls, live personal amount and detail corrections; verify desktop and mobile browser behavior.

## 3. Completion

- [x] 3.1 Review scope and run relevant tests, typecheck, lint, formatting and build; record evidence here.

## Verification — 2026-09-04

- Reviewed original-versus-personal amounts, absence of EMT automation, bound SQL, optimistic updates, imported records, cross-month receipts, and JSON/CSV consistency. No repayment is subtracted twice.
- `npm run test:coverage`: 253 unit tests and 128 Worker integration tests passed; both configured coverage gates passed.
- `npm run test:browser`: 54 passed, 2 existing mobile-specific skips. New tests cover optional repayment and deduction, invalid amounts, keyboard activation, reset, direction changes, imported detail corrections, and widths 320/768/1024/1440. Inspected desktop and mobile screenshots.
- `npm run test:restore`: passed with a nonzero reimbursement and independent SQL verification of original and deducted amounts; old backups default to zero in unit tests.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, `git diff --check`, and strict OpenSpec validation passed. Build emits the existing missing-local-auth-secrets warning; production credentials were not changed. Wrangler build logs were directed to `/tmp` after the sandbox denied its default log directory.
- `npm run db:migrate` applied all migrations through 0018 to the local development database only. No commit, remote migration, or deployment.
