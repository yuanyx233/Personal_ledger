# Production verification

## Release

- Deployed at: 2026-09-11T07:10:53Z
- Production URL: `https://personal-ledger-app.yuanyuxiang113.workers.dev`
- Version: `ddca45f3-810b-4017-b1d2-c7d4ac2ae925`
- Compatible rollback version: `4145792b-c581-466c-97d8-d9209808a08f`
- Database migration: `0021_transaction_installments.sql`
- Release base: `a4e8d2b`
- Release source was isolated from the dirty working tree so `prune-legacy-sync-remnants` was not deployed.

## Backup and migration

- Pre-migration app export: `backups/2026-09-10-new-merchant-release/before.ledger-export.json`
- Pre-migration D1 snapshot: `backups/2026-09-11-installment-release/production-before-0021.sql`
- D1 snapshot SHA-256: `11eec537622da0c7c773a5c3defdd2820b23166dbfcc6968a387cff7b5a62d8f`
- Restore preflight preserved 461 exported transactions with zero foreign-key or relationship violations.
- Post-migration production checks found all three installment columns, the unique installment index, 462 existing transactions, zero installment rows, and zero foreign-key violations.
- Migration 0021 is additive. Rollback keeps the new nullable columns and index while redeploying the previous Worker version.

## Verification

- `npm audit`: zero vulnerabilities.
- Formatting, lint, type checking, production build, and Wrangler dry-run passed on the isolated release source.
- Unit suite: 309 passed.
- Worker integration suite: 144 passed.
- Browser suite: 82 passed, 2 pre-existing mobile skips.
- Installment-focused browser suite: 32 passed across desktop and mobile.
- Live authenticated smoke test confirmed the installment toggle, default three-installment field, explanatory text, and successful transaction-list reads. No test transaction was created and browser warnings/errors were empty.
- Anonymous `/add` access continued to return the expected Cloudflare Access redirect.

## Existing coverage gate exception

The repository's configured global coverage thresholds already fail on the deployed base:

- Base: 88.10% statements, 82.70% branches, 89.79% lines.
- Release: 88.09% statements, 82.23% branches, 89.89% lines.

The new installment persistence branches have dedicated unit and D1 integration tests. This pre-existing threshold mismatch was recorded rather than misreported as a passing full `npm run verify`.
