## Simplify the ledger

- [x] Remove bank/sync/subscription/review/matching runtime modules, routes, dependencies, and configuration.
- [x] Simplify pages around entry, import, transactions, rules, and summaries; preserve duplicate review and explicit transfer categorization.
- [x] Verify historical data/backup compatibility, transaction correction, security, and core workflows; record final reduction.

## Authorized website update (2026-09-04)

- [x] Deploy the verified App Worker/assets and clear its obsolete schedules, preserving D1 and Access.
- [x] Verify the live simplified pages and anonymous access protection; record deployment and rollback versions.

Verification (2026-09-04): `npm run verify` passed: formatting, lint, types, coverage thresholds, 251 unit tests, 125 Worker integration tests, 44 browser tests (2 existing mobile skips), and production builds. `npm run test:restore` and strict OpenSpec validation passed. Isolated browser screenshots of settings and entry showed no browser errors or settings overflow at 320/768/1024/1440 px.

Against the source snapshot at the start of this pass: 66 source/config/test files removed, 9,068 net runtime-source lines removed, 19,652 net lines removed including associated tests/config/docs in that snapshot. Deleted source files were copied outside the repository to a temporary recovery directory. Historical migrations and existing financial data were not deleted. No commit, deployment, remote migration, or remote Worker deletion was performed.

### Subsequent authorized production release

On 2026-09-04, the owner requested removing the synchronization content from the live website. Deployed App version `8ebf0156-0d19-4a7c-a376-be6983f842dc` to `https://personal-ledger-app.yuanyuxiang113.workers.dev`; prior compatible rollback version: `11d72711-4721-450f-8aed-145c246fe562`.

The production build from the successful 16:18 local `npm run verify` was isolated in `/tmp/ledger-simplified-release.y7rWYI` before release. A subsequent verification encountered concurrently added, unfinished reimbursement tests (format check failed); those changes were not rebuilt or deployed. The only release-configuration adjustment was explicit `triggers.crons: []`, because omitting the field leaves remote schedules untouched. Wrangler dry-run passed and deployment reported successful trigger publication. Worker bundle SHA-256: `f05f9593f261673fb5216bd9bef4687533002fd18ac80e0ea76f4699da402258`.

Live checks: settings loads `index-BgqTl4jD.js`, shows categories/rules, CSV import and exports, and no bank/sync/subscription controls. Transactions render 25 rows; manual entry retains its submit form; overview cash flow/trends load without alerts or browser warnings/errors. Anonymous settings requests receive HTTP 302 to the authentication boundary. No live transaction mutation was performed. Browser navigation to the removed API was blocked by the browser tool, so its 404 behavior is covered by the verified Worker tests rather than a live API check.

Version inspection confirms only the `fetch` handler, no SYNC service binding or Plaid public variables, and the unchanged production D1 UUID and four authentication/CSRF secrets. Read-only D1 checks confirm 419 transactions, 15 categories, no foreign-key violations, and zero rows written. No migration, Access modification, commit, deletion of the separate remote Sync Worker, or deletion of legacy secrets was performed; obsolete remote resources/credentials remain outside this website-release scope.
