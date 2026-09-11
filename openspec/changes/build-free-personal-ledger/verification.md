# Verification report

## Authorized historical EMT classification — 2026-09-04

Completed migration `0017_custom_transfer_categories.sql` through the guarded migration entrypoint and created editable `category-transfer-emt` (`EMT`, kind `TRANSFER`). Classified exactly 42 previously unresolved RBC Debit CSV E-Transfers dated 2026-01-02 through 2026-08-26 (22 inflows, 20 outflows), with 42 automatic category audit entries. Production remains at 419 transactions, review count fell from 71 to 29, and 108 active merchant rules are unchanged with zero EMT rules. Future E-Transfers therefore retain manual review.

Private before/after backups and the guarded apply/rollback scripts are in ignored `.wrangler/emt-*-2026-09-04.*`. Before-export SHA-256: `6314b1150d88a7622c62ac9a1eb08346fa571718a263bb993f92f408b1c7da97`. The migration gate restored all collections in an isolated database with zero relationship or foreign-key violations. The exact apply and rollback scripts passed against the restored production data (42 EMT / 29 reviews after apply, 71 reviews after rollback). Production foreign-key checks also passed.

Full before/after comparison verified all other 377 transactions and all pre-existing categories, rules, imports, transfers, and audits were unchanged. Only the intended category/review/version/update-time fields changed on the 42 target records. CAD report totals remained income 1,705,049 cents, net spending 1,315,156 cents, net cash flow 389,893 cents; EMT is excluded from income/spending totals.

The backup revealed existing `CREDIT_CARD_PAYMENT` transfer evidence unsupported by the JSON schema. Added local export/restore compatibility preserving this value; 12 focused export/restore tests passed, and the production snapshot restored successfully. No app Worker deployment was performed in this operation, so this export compatibility change remains local. A broader persistence typecheck encountered concurrent workspace changes in `financial-reports.ts`, repository exports, and removed transfer-match tests; it is not claimed passing for the current shared workspace.

Date: 2026-08-31

This report records local automated evidence, the authorized Sandbox preview deployment, capacity measurements, and the exact manual evidence still required before personal-use readiness. It does not claim a real Plaid bank connection or completion of the 14-day shadow period.

## Free-plan capacity review

Current platform limits were checked against the official [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [D1 pricing/usage metrics](https://developers.cloudflare.com/d1/platform/pricing/) on the date above.

### Workers

Workers Free currently allows 100,000 requests/day, 10 ms CPU per HTTP request and per Cron invocation, 128 MB memory, 50 subrequests/invocation, 3 MB per Worker, and 5 Cron triggers/account.

Measured build and request shape:

| Item | Measurement | Free-limit assessment |
| --- | ---: | --- |
| App Worker bundle | 708,657 bytes raw | Below 3 MB |
| Sync Worker bundle | 547,563 bytes raw | Below 3 MB |
| Static assets | 11 files; largest 393,575 bytes | Below 20,000 files and 25 MiB/file |
| Overview initial load | 8 API requests | Below app limiter of 60/minute |
| Analysis initial load | 3 custom, 4 quarter, 5 month, or 9 year API requests | Worst case below app limiter |
| Settings initial load | 3 API requests | Below app limiter |
| Transactions / review / detail initial load | 1 / 2 / 2 API requests | Below app limiter |
| One write | 1 session read + 1 mutation; some screens then refresh 2-3 reads | Bounded and idempotent where retryable |
| Scheduled work | Sync Cron every 30 minutes = 48/day, plus one daily subscription Cron; at most 2 Items, 20 Plaid pages/Item, and 100 generated occurrences/app run | 2 of 5 Cron triggers; worst sync binding/subrequest shape remains 47, below 50; subscription generation is independently bounded and does not require Plaid configuration |

Application caps and failure behavior:

- The app API limiter is 60 requests/minute; rejected requests return 429.
- Bank synchronization is owner-triggered only and caps one request at 20 Plaid pages. Cursor advancement is batch-atomic, so a failed request resumes rather than skips data.
- The app's daily subscription scheduler caps one execution at 100 occurrences and 24 catch-up occurrences per plan. A unique `(subscription_id, scheduled_date)` occurrence plus guarded plan advancement makes at-least-once execution idempotent; hitting the per-plan cap atomically pauses that plan with `CATCH_UP_LIMIT` until the owner reviews a future next-charge date.
- The 20-second wall-time cap is not a CPU guarantee. Local Workerd cannot reproduce Cloudflare billing CPU, and the Free plan's 10 ms CPU limit is tighter than the configured wall-time cap. A CPU overrun is terminated by Cloudflare with error 1102 and must be confirmed from deployed invocation logs.
- Therefore bundle, request-count, Cron-count, and subrequest shapes fit the published Free limits, but CPU readiness remains a mandatory preview/shadow gate. Do not call the service Free-plan-ready until task 12.3 records HTTP and Cron CPU below 10 ms or the design is revised.

### D1

D1 Free currently allows 500 MB per database, 5 GB/account, 5 million rows read/day, 100,000 rows written/day, and 50 queries per Worker invocation.

Measured evidence:

- `apps/web/test/query-plans.spec.ts` passes 8 plan checks. The complete report population uses `idx_transactions_report_posted_date`; its two correlated transfer exclusions use covering indexes `idx_transfer_matches_active_left` and `idx_transfer_matches_active_right`. There is no transfer-table scan and no temporary sort B-tree.
- An isolated migrated D1 containing 10,002 transactions, 1 connection, 1 account, and 12 categories occupied 9,924,608 bytes in the SQLite database file (about 9.47 MiB, 1.9% of 500 MB). The local directory was 21,667,840 bytes including transient WAL and emulator metadata, which is not a remote billed-storage measurement.
- The indexed 730-day eligible-transaction count over all 10,002 rows reported 1 ms local D1 duration. This is a local regression signal, not deployed latency or billed CPU evidence.

Safe application caps:

- List page size: 100; report/custom date range: 730 days.
- CSV import: 5 MiB, 4,000 rows, 32 columns, and 4,096 characters/cell; oversize input fails with 413/422 before ledger mutation. The former 10,000-row cap was reduced because each transaction plus its indexes and preview bookkeeping counts as multiple D1 rows written; 4,000 retains headroom below the 100,000 rows-written daily limit.
- Transaction CSV export: 10,000 rows and 16 MiB. Full JSON export: 50,000 records/collection, 100,000 total records, and 32 MiB. Export fails before returning a partial artifact when a cap is exceeded.
- Default JSON writes: 64 KiB; import commit: 512 KiB.
- The 100,000-total-record full-export cap is the portable-artifact ceiling for this first release. Local restore is verified; a large remote Free-plan restore may need a separately designed staged import across daily write-limit resets and must not trigger a paid upgrade.
- Deployed D1 `rows_read`, `rows_written`, query count, storage, and error metrics remain manual task 12.3 evidence. If a Free daily quota is exhausted, writes/sync stop, the last successful ledger stays readable where Cloudflare permits, and no paid upgrade is automatic.

## Scenario evidence map

Legend: **Automated** means deterministic local unit/integration/browser evidence exists. **Hybrid** means the contract and failure paths are automated but a named Sandbox, Trial, deployed Access, quota, or live-data observation is still required. **Manual** means no local substitute can establish the claim.

### `bank-account-sync`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| Supported institutions and account scope | Owner selects eligible accounts; Unsupported account is returned; Unsupported institution token is submitted | **Hybrid** — `apps/web/test/plaid-exchange.spec.ts`, `apps/web/test/connections.spec.ts`, `tests/browser/settings.spec.ts`; task 12.4 must confirm RBC/BMO Trial account metadata and selection. |
| Least-privilege Link configuration | Initial link token is created; Institution provides less history | **Hybrid** — `apps/web/test/plaid-link.spec.ts` and Link browser mock cover requested products/history; task 12.4/12.5 must record actual institution history availability. |
| Minimal Item creation and repair | Existing Item needs reauthentication; Update mode succeeds; Owner attempts a second active Item for one institution | **Hybrid** — `apps/web/test/plaid-link.spec.ts`, `apps/web/test/plaid-exchange.spec.ts`, `tests/browser/settings.spec.ts`; Sandbox update mode remains task 11.2/12.3. |
| Cursor-based incremental synchronization | Multi-page sync succeeds; A later page fails; Sync is retried | **Hybrid** — `packages/plaid/src/transaction-sync.test.ts`, `packages/persistence/src/transaction-sync.test.ts`, `workers/sync/test/sync-worker.spec.ts`; deployed Sandbox pagination remains task 12.3. |
| Owner-triggered bank synchronization | Owner requests sync; Owner repeats during an active run; No owner request occurs | **Hybrid** — `apps/web/test/manual-sync-runs.spec.ts`, `workers/sync/test/sync-worker.spec.ts`, and `tests/config/environment-files.test.ts` cover private bounded dispatch, leases, idempotency, and absence of public/scheduled entry points; deployed manual-sync CPU remains task 12.3. |
| Visible connection health | Connection is healthy; Owner action is required | **Automated** — `packages/domain/src/connection-health.test.ts`, `apps/web/test/connections.spec.ts`, `tests/browser/overview.spec.ts`, `tests/browser/settings.spec.ts`. |
| Free-plan failure behavior | A free quota is exhausted | **Hybrid** — bounded/error behavior is covered by `packages/domain/src/environment.test.ts`, `apps/web/test/request-limits.spec.ts`, and sync-worker failure tests; actual quota/CPU outcome requires task 12.3 metrics. |

### `single-user-access`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| Single authorized identity | Configured owner opens the app; A different authenticated email opens the app | **Hybrid** — JWT/owner enforcement in `apps/web/test/access.spec.ts`; the deployed Access application has one Allow policy with one exact owner-email rule. The positive authenticated browser flow remains task 11.2/12.3. |
| Origin verification of Access assertions | Forged identity header without a JWT; Expired or wrong-audience JWT | **Automated** — `apps/web/test/access.spec.ts`. |
| Protected application surface | Anonymous API request; Direct public access to the sync Worker | **Hybrid** — `apps/web/test/app-worker.spec.ts` and `tests/config/environment-files.test.ts`; deployed anonymous and forged-header app requests redirect to Access, while the next authorized sync deployment must confirm `workers_dev=false` and no public route. |
| Same-origin write protection | Valid owner performs a write; Cross-site write attempt | **Automated** — `apps/web/test/request-guards.spec.ts`, `apps/web/test/app-worker.spec.ts`, browser write flows. |
| Secret and financial-data isolation | Plaid Link completes; An internal operation fails | **Hybrid** — token crypto/redaction in `packages/domain/src/token-crypto.test.ts`, `packages/domain/src/logging.test.ts`, Plaid exchange tests, and browser Link mock; real Link token handoff remains task 11.2/12.3. |
| Browser security and safe rendering | Merchant text contains markup; Another site attempts to frame the ledger | **Automated** — `tests/browser/transactions.spec.ts`, `tests/browser/transaction-detail.spec.ts`, `apps/web/test/security-headers.spec.ts`. |
| No offline financial-data cache | Device goes offline after prior use | **Automated** — `tests/browser/workspace-shell.spec.ts`, `apps/web/src/service-worker-policy.test.ts`. |
| Usable trusted-device Access sessions | Trusted device revisits within the session; Device has no valid cookie | **Deployed/manual follow-up** — on 2026-09-02 the sole ledger application's global, application, and owner-policy durations were saved and re-read as `1 month` while its exact-hostname, one-email Allow boundary and disabled Cloudflare One Client setting remained unchanged. Fresh-token desktop/iPhone expiry checks remain manual because no logout or token revocation was authorized. |
| Expired-session recovery in the SPA | Access expires while quick entry is open | **Automated** — `apps/web/src/lib/browser-api.test.ts` verifies the documented AJAX header and recognizable auth failure; `tests/browser/quick-entry.spec.ts` verifies an explicit re-login action and zero transaction writes. |

### `financial-reporting`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| One eligible-transaction population | Pending and posted version both exist; Confirmed credit-card payment exists | **Automated** — `packages/domain/src/financial-reporting.test.ts`, `apps/web/test/financial-report-query.spec.ts`. |
| Defined cash-flow metrics | Expense refund occurs in the period; Period has income and spending | **Automated** — `packages/domain/src/financial-reporting.test.ts`, reconciled D1 fixture tests. |
| Calendar month, quarter, and year analysis | Owner chooses a calendar year; Transaction posts at a period boundary | **Automated** — financial-report domain/persistence tests and `tests/browser/analysis.spec.ts`. |
| Comparable period changes | Prior comparison value is non-zero; Prior comparison value is zero | **Automated** — financial-report domain/persistence tests and analysis browser tests. |
| Breakdown, ranking, and drill-down | Owner opens a category total; Category rows are summed | **Automated** — `apps/web/test/financial-report-query.spec.ts`, `tests/browser/analysis.spec.ts`, transaction URL-filter browser tests. |
| Currency separation without implicit FX | CAD and USD transactions exist | **Automated** — financial-report domain/persistence tests and analysis browser tests. |
| Accessible and evidence-backed presentation | Chart cannot be perceived visually; A connection is stale | **Automated** — `tests/browser/analysis.spec.ts`, `tests/browser/overview.spec.ts`, accessibility checks in settings/workspace suites. |
| Report query safety and reproducibility | Unsupported group or excessive range is requested | **Automated** — `packages/domain/src/financial-reporting.test.ts`, `packages/domain/src/request-limits.test.ts`, `apps/web/test/request-limits.spec.ts`, `apps/web/test/query-plans.spec.ts`. |

### `transaction-ledger`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| Unified canonical ledger | Transactions from different sources are viewed; Same Plaid transaction is seen twice | **Automated** — `apps/web/test/canonical-ledger.spec.ts`, repository and transaction-sync tests, `tests/browser/transactions.spec.ts`. |
| Pending, posted, and removed lifecycle | Pending purchase becomes posted; Posted transaction is removed upstream | **Automated** — Plaid/domain/persistence transaction-sync tests and transaction-read tests. |
| Manual entry | Valid manual transaction is saved; Two devices edit the same transaction; Unsupported manual-entry currency is submitted | **Automated** — domain API-contract tests, `apps/web/test/manual-transactions.spec.ts`, `packages/persistence/src/manual-transactions.test.ts`, settings/detail browser tests. |
| Exact money representation | Decimal source amount is ingested; Currency cannot be determined | **Automated** — `packages/plaid/src/transactions.test.ts`, transaction-sync tests, API/schema tests. |
| High-confidence internal-transfer exclusion | Chequing pays an enabled credit card; More than one candidate pair exists; Owner reverses a transfer decision; Owner ignores an ambiguous candidate | **Automated** — `packages/domain/src/transfer-matching.test.ts`, transfer match/decision persistence and API tests, review browser tests. |
| External Interac e-Transfer preservation | Outgoing e-Transfer has no owner-account counterpart; Counterparty metadata is absent; Partial counterparty metadata is supplied; An e-Transfer is confirmed as internal | **Hybrid** — `packages/domain/src/e-transfer.test.ts`, `apps/web/test/e-transfers.spec.ts`, review/transfer tests; real RBC/BMO field quality is a named task 12.5 sample. |
| Refund treatment | Merchant refund posts | **Automated** — financial-reporting tests and reconciled D1 fixture. |
| Whole-transaction marketplace treatment | Amazon transaction is ingested | **Automated** — merchant categorization and transaction-sync tests; no split model exists. |
| Filterable and traceable transaction view | Owner asks which transactions were automatically categorized | **Automated** — transaction-read/API-contract tests and `tests/browser/transactions.spec.ts`. |

### `merchant-categorization`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| Deterministic category precedence | Manual override and rule both exist; Rule and Plaid category both exist; No trusted category is available | **Automated** — `packages/domain/src/merchant-categorization.test.ts`, transaction-sync/correction tests. |
| Limited automatic classification of new merchants | New merchant includes a mapped Plaid category; New merchant has no mapped Plaid category | **Automated** — merchant categorization and Plaid transaction-sync tests. |
| Transparent classification provenance | Rule-classified transaction is viewed; Automatically categorized merchants are reviewed | **Automated** — transaction-read, merchant-rule, review-queue, and transactions browser tests. |
| Safe merchant normalization and rule matching | Merchant varies only by case or repeated whitespace; Merchant names are merely similar | **Automated** — `packages/domain/src/merchant-categorization.test.ts`, merchant-rule persistence/API tests. |
| Two explicit correction scopes | Owner corrects one transaction only; Owner saves a future merchant rule; Existing historical matches exist | **Automated** — category override and merchant-rule correction tests, detail/settings browser tests. |
| Append-only categorization audit | Automatic category is manually corrected | **Automated** — category override domain/persistence/API tests and schema trigger checks. |
| Unified review queue | Unclassified item is shown for review; Owner clears the last review item; Bulk destructive correction is attempted | **Automated** — review-queue persistence/API/browser tests cover visible posted dates on unclassified cards, item resolution, and the absence of a destructive bulk endpoint. |

### `quick-entry`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| iPhone-first quick entry | Owner records a normal purchase; Owner uses a different account; Input is invalid | **Automated** — manual transaction API/persistence tests and `tests/browser/quick-entry.spec.ts` cover Toronto/CAD/outflow/`RBC Credit` defaults, per-entry account override, exact cents, and boundary rejection. |
| Immediate category confirmation | Known merchant is saved; Unknown merchant is saved; Owner postpones | **Automated** — category/manual API tests and quick-entry desktop/mobile browser tests prove save-once behavior, exact-rule completion, unclassified confirmation, and defer-to-review. |
| Bounded suggestions and searchable alternatives | Owner accepts a suggestion; Searches existing; Confirms new category | **Automated** — category suggestion/create contracts and quick-entry browser tests cover the two-item bound, search-before-create, second confirmation, current-transaction correction, and future exact rule. |
| Safe category names | Equivalent or unsafe category is submitted | **Automated** — category domain/persistence/API tests cover normalized uniqueness, optimistic conflicts, markup/control-character rejection, and prepared SQL boundaries. |
| Installable protected app entry | Home-screen launch; Access absent/expired; Device offline | **Hybrid** — manifest/icon/start URL, responsive flow, expired-session action, and no-cache/offline behavior are automated in quick-entry/workspace/service-worker suites; actual iPhone installation and Access cookie lifetime remain remote/manual evidence. |

### `subscription-management`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| Owner-confirmed subscription plans | Recurring history is suggested; Owner confirms; Owner creates manually | **Automated** — subscription persistence/API tests and `tests/browser/subscriptions.spec.ts` cover bounded candidates, full-field review, confirmation, and manual creation without historical regeneration. |
| Idempotent due-date generation | Plan becomes due; Execution retries/catches up; Short month clamps | **Automated** — subscription domain/repository tests and `apps/web/test/subscription-schedule.spec.ts` cover Toronto dates, month ends/leap years, bounded catch-up, guarded concurrent generation, and at-least-once retries. |
| Subscription lifecycle management | Owner pauses/cancels/edits; Two devices race | **Automated** — repository/API optimistic-version tests plus desktop/mobile subscription controls verify future-only edits, reviewed resume date, status text, and no generation after a winning pause/edit. |
| Single occurrence correction | Expected charge did not occur | **Automated** — occurrence persistence/API/scheduled tests and subscription browser confirmation verify `NOT_CHARGED`, removed report status, retained provenance, and unchanged future plan. |
| Subscription management interface | Owner checks status; No plans exist | **Automated** — `tests/browser/subscriptions.spec.ts` covers candidate, active/paused/cancelled, empty, error, account/category/next-date, and keyboard/reflow states. |
| Portable subscription data | Subscription ledger is exported and restored | **Automated** — full JSON v2/v1 domain/persistence/API tests and `npm run test:restore` reconcile plans, historical occurrences after future plan edits, relationships, report totals, and migration-guard evidence. |

### `data-portability`

| Requirement | Scenarios (all mapped) | Status and evidence |
| --- | --- | --- |
| Two-phase CSV import | Valid CSV is uploaded; Owner commits a valid preview; Invalid CSV is uploaded | **Automated** — `packages/domain/src/csv-import.test.ts`, CSV import persistence/API tests, and `tests/browser/settings.spec.ts` cover bounded preview, all hidden action-required rows, no-ledger preview, and atomic commit. |
| Import deduplication and source retention | Same batch is committed twice; Suspected/unique/multiple existing matches occur | **Automated** — CSV import/reconciliation API and persistence tests cover staged replay consistency, pre-existing and racing fingerprints, one-to-one manual/subscription links, ambiguity, owner merge/new/skip, and unchanged canonical source/category/description/version. |
| Native RBC CSV adapter | Visa/Chequing row; account number; currency ambiguity; identical visible rows | **Automated** — RBC domain/API fixtures and desktop/mobile settings browser tests cover exact headers, dates, signed CAD/USD, `RBC Credit`/`RBC Debit`, occurrence ordinals, malformed-column redaction, and absence of column-B values from preview, staging, export, and UI. |
| Filtered transaction CSV export | Filtered export is requested; Exported text begins with a spreadsheet formula marker | **Automated** — transaction CSV domain/API tests. |
| Complete versioned JSON export | Full export is requested | **Automated** — full JSON domain/persistence/API tests and settings export links. |
| Secret-free exports | Export content is inspected | **Automated** — full JSON export tests assert the allowlisted schema and absence of Plaid secrets/tokens. |
| Versioned database evolution and recovery evidence | Destructive migration is proposed | **Automated** — schema/migration tests, `packages/persistence/src/remote-migration-guard.test.ts`, full JSON restore verification. |
| Provider-exit path | Bank synchronization is permanently disabled | **Automated** for portable exports and readable non-Plaid ledger; actual provider shutdown is an operational decision documented by the deployment runbook and requires no destructive Item action in the first release. |

## Authorized Sandbox preview deployment

Deployment and boundary evidence recorded on 2026-07-21 (secret values were never recorded):

- Cloudflare Zero Trust Free account; D1 `personal-ledger` (`a046cdac-587a-4031-89df-f2e7479becfc`).
- App Worker `personal-ledger-app`, version `934e99f2-b546-4fbf-910c-fd3529102400`; sync Worker `personal-ledger-sync`, version `ec46d185-ea08-4b50-bb1c-4392bbf1bcd6`. Both explicitly disable Preview URLs.
- Access application `2f42c7fa-93cb-45b4-889b-141ecf68964e` protects only `personal-ledger-app.yuanyuxiang113.workers.dev`. Policy `05454d81-7566-40ad-99ca-801192826d4b` is Allow with one exact owner-email rule and no Everyone, Bypass, domain, or additional-email rule.
- An anonymous request to `/` returned 302 to `damp-bar-7d13.cloudflareaccess.com`. A request to `/api/v1/session` with forged `Cf-Access-Jwt-Assertion` and owner-like email headers also returned the Access 302 and did not reach the application API.
- Sync Worker `GET /` and `GET /webhooks/plaid` returned 404; an unsigned JSON `POST /webhooks/plaid` returned 401 with `Cache-Control: no-store`.
- Plaid environment is Sandbox; the deployed institution IDs are RBC `ins_39` and BMO `ins_41`. No Plaid Item or live bank connection was created.
- The final `npm run verify` passed: 413 unit, 187 app Worker, 32 sync Worker, and 30 Playwright tests passed with 2 intentional project skips; formatting, lint, type checks, restore bundles, and production builds completed.

Additional deployed Sandbox evidence recorded on 2026-08-20:

- Plaid Dashboard exposed only the `default` Link customization; the stale deployed value `personal-ledger-account-select` caused `/link/token/create` to fail before the Web SDK opened. The App Worker configuration and runbook were corrected to `default`, matching Plaid's documented default customization behavior.
- App Worker version `318faec3-0f4e-4ced-919d-dc10a29e352d` was deployed with `PLAID_ENV=sandbox`; no Worker secret, D1 binding, or sync Worker was changed.
- A real-browser RBC Sandbox Link session completed with all three eligible returned accounts selected (one chequing and two credit-card accounts). The connection persisted as healthy, manual sync queued successfully, and Plaid Sandbox transactions appeared in the ledger.
- Plaid Dashboard still displayed `Request production access`; no Production/Trial Item or real bank connection was created.

## Authorized production update

Production migration, deployment, and Access evidence recorded on 2026-09-02 (secret, cookie, JWT, and transaction-description values were never recorded):

- The live App and Sync bindings both pointed to D1 `personal-ledger-production` (`908a378d-e83b-4dac-9808-b5a0476016ef`). The older D1 `personal-ledger` remained untouched because its 291 transactions are Plaid Sandbox fixtures rather than the owner's manual production ledger.
- Before migration, a fresh schema-v2 JSON export was written to `/private/tmp/personal-ledger-production-pre-migration-2026-09-02.json`. It contained 10 categories and no financial, connection, rule, import, or subscription records; SHA-256 was `0852e021743608ae103a6cf22d13c13906eacb4cfc0e1f75c8ee9822b886029d`.
- The guarded restore preflight completed in a separate local D1 with zero foreign-key or relationship violations. The migration-set digest was `bb63412a6c3aaf421719603f72d8a5baad0ee695e6064c6bf842e678be3ee6a6`.
- Remote migrations `0013_category_normalized_name.sql` through `0016_subscription_occurrence_history.sql` applied to `personal-ledger-production`. A second migration listing showed no pending migrations, the 10 seed categories remained, the financial/import/subscription tables remained empty, and `PRAGMA foreign_key_check` returned no rows.
- Sync Worker version `66c0a07f-496e-4e68-a5a0-103335e3db18` and App Worker version `0443b499-0189-4256-bd32-d9c36f0c8ea2` were deployed. The immediately preceding rollback versions are `31a0f23e-e438-41a9-b7a9-7bdb78053ff3` and `fb8e661d-2b70-433b-bd5c-6af9d5c4ac61`, respectively.
- Anonymous App `/` and `/api/v1/session` requests redirected to Cloudflare Access. Sync `GET /`, `GET /webhooks/plaid`, and unsigned JSON `POST /webhooks/plaid` returned 404, 404, and 401; the rejected webhook response remained JSON with `Cache-Control: no-store`.
- An authenticated Chrome check loaded `/add` with Toronto-date, CAD, outflow, and `RBC Credit` defaults, then loaded `/subscriptions`; neither page produced a console error.
- The Zero Trust organization exposed exactly one Access application and one reusable policy, and that policy was used by exactly one application. Global duration changed from `Same as application session timeout` to `1 month`; the application changed from `24 hours` to `1 month`; the owner policy changed from `Same as application session duration` to `1 month`. The exact App hostname, sole owner-email Include rule, Allow action, and disabled Cloudflare One Client/MFA/JIT settings were re-read unchanged.
- Existing Access cookies were not logged out or administratively revoked. Dashboard persistence is verified, but fresh application/global token expirations and the normal-browser, iPhone Safari, home-screen, and no-cookie acceptance checks remain outstanding.
- A 15-row BMO screenshot transcription passed local structural validation with zero invalid rows and zero same-file canonical duplicates, but no BMO source file was included in the later production upload and those screenshot rows remain unimported.
- The three supplied RBC files were reconciled before commit. `download-transactions.csv` contained 56 rows that were an exact subset of `download-transactions (1).csv`, so it was skipped rather than creating duplicate ledger rows. The two committed batches contained 279 RBC Credit rows from `download-transactions (1).csv` and 140 RBC Debit rows from `download-transactions (2).csv`; the resulting remote counts were `transactions=419`, `committed_batches=2`, and `import_rows=419`.
- RBC Credit same-file rows 181 and 182 were presented for owner review and confirmed as two distinct public-transit charges rather than a duplicate. Both 2026-04-29 Compass rows were retained and categorized as `Transportation`: row 181 used `RULE` provenance and created one active exact merchant rule, while row 182 used `MANUAL` provenance. The owner then confirmed the separate 2026-04-28 Compass row 178 was also public transit; it was categorized as `Transportation` with `MANUAL` provenance. A remote read verified all three rows at `needs_review=0` and confirmed the exact Compass rule remained a single active rule rather than being duplicated.
- The first authenticated production read after import exposed a compatibility contradiction: committed CSV transactions use `csv-*` identifiers, while the transaction identifier contract and SPA detail route accepted only `transaction-*`. A focused TDD correction extended those two public seams without rewriting stored identifiers. API-contract tests passed 29/29, App Worker integration tests passed 16/16, transaction-detail browser tests passed 6/6 across desktop/mobile, and the root type check passed; two independent standards/spec reviews found no P0-P2 issue.
- The corrected App Worker was deployed as version `11d72711-4721-450f-8aed-145c246fe562`; D1 and the Sync Worker were not changed by that follow-up deployment. An authenticated live smoke check then loaded `/transactions` and displayed the imported CSV ledger successfully.
- At the owner's request, production D1 received one editable, active `INCOME` category named `Tax Return Income` (`category-income-tax-return`, normalized name `tax return income`). A guarded preflight confirmed no matching identifier or normalized name existed before insertion; the authenticated settings page then reported 11 available categories and exposed `Tax Return Income` in the category selectors without browser warnings or errors.
- The owner explicitly authorized the reviewed high-confidence categorization batch: create `Travel`, `Entertainment`, and `Healthcare`, categorize 243 transactions, create 100 exact merchant rules, and reuse 2 existing rules. The frozen main and rollback SQL digests were `16584a4d199670b11b752e5bb2d52992c549dc2f2f68eac8b173eec910e8c1ee` and `5c757915f125c96757e4e9b46f11c973576644cc25935d2168d73f13561f2211`. Local D1 verification covered apply, idempotent replay, narrow rollback, repeated rollback, owner-record preservation, category collisions, exact rule counts, audit deltas, and zero scratch-table residue.
- Immediately before the production write, D1 still contained 419 transactions: 409 unclassified review items and 10 categorized items, with 5 active merchant rules, 10 category audits, none of the three new categories, and no `_autocat_%` scratch table. The guarded atomic D1 file then completed 39 statements successfully at bookmark `000002a7-0000000e-000050db-60de5cb948518c0e3b6104df64524d96`.
- Post-write read-only verification showed 253 categorized transactions and 166 remaining review items. Categorization provenance reconciled to 206 `RULE` and 47 `MANUAL` transactions. The active exact-rule count was 105, including exactly 100 rules created by this run; the other two applicable keys reused existing rules. Category counts reconciled to Bills 26, Employment Income 7, Entertainment 12, Food 107, Healthcare 1, Other Expense 5, Shopping 36, Tax Return Income 6, Transportation 50, and Travel 3. All three new categories were active, editable `EXPENSE` categories at version 1; category audits totaled 253, no scratch table remained, and `PRAGMA foreign_key_check` returned no rows.
- The owner then confirmed 14 unique RBC Debit-to-RBC Credit payment pairs, totaling CAD 11,485.00, as internal credit-card repayments. The guarded atomic D1 file digest was `e6b5c7956d87df7081ddede2ef44815dd360fc585f57f16a5dd03f41c784fc7d`; its compensating rollback digest was `9e53ec60ba6df3e4f352f7d2b1ed191d1cb9c352e7148fe6da8c90370b1fcb21`. SQLite and Wrangler/D1 local verification both produced 28 `Transfer` transactions, 14 owner-confirmed high-confidence matches, 14 transfer-decision audits, 28 category audits, zero scratch tables, and zero foreign-key violations; the rollback restored all 28 transaction review states and marked all 14 matches broken with append-only compensating audits.
- The production batch completed at D1 bookmark `000002ac-0000000a-000050db-ec1c4daf57f17745937e2cc4a75c3ece`. Read-only verification found all 28 target transactions at `Transfer`/`MANUAL` with review cleared, all 14 matches at `CONFIRMED`/`HIGH`, equal CAD 11,485.00 totals on both sides, date differences of zero to three days, and zero target rows remaining in the financial-report population. The database retained 419 transactions; all 14 card-side payment descriptions were resolved, 22 unmatched debit-side banking transfers remained untouched for later review, no scratch table remained, and `PRAGMA foreign_key_check` returned no rows. The current transaction-review count was 136; it was two lower than the 138 implied solely by this 28-row batch because two unrelated items were resolved separately while this operation was being prepared.
- The owner subsequently confirmed that the remaining 55 previously reviewed transfer candidates were also movements among owner accounts, credit cards, savings, investments, loans, cash, or their reversals rather than income or spending. Because the counterpart accounts were not present in this ledger, the batch did not invent pair records; it assigned the system `Transfer` category with `MANUAL` provenance, cleared review, and created no merchant rule or transfer match. The guarded main and compensating rollback digests were `c847a5f671b4239017c7b5e7cd5517bc22b4fe3b92e6e7fa55d15104de6c07d9` and `96ec728119d51df26d1c57146198268836a2a75e988f5b932abbe76289f43565`, respectively. Wrangler/D1 local apply and rollback both passed for all 55 rows, with zero scratch tables and foreign-key violations.
- The 55-row production batch completed at bookmark `000002af-00000007-000050db-9af19f88a95485a5c2ace58767ff050a`. Post-write verification found all 55 exact target rows at `Transfer`/`MANUAL`, comprising 31 inflows and 24 outflows totaling CAD 139,297.51, with 55 matching category audits and zero rows categorized as `INCOME` or `EXPENSE`. The active merchant-rule count remained 105 and the active confirmed-match count remained 14. All 43 separately held owner-review e-Transfer rows were found and none was touched by the batch; 42 remained pending while one had already been resolved independently. The ledger retained 419 transactions, the current transaction-review count was 81, no scratch table remained, and `PRAGMA foreign_key_check` returned no rows.

## Manual-only bank synchronization update

The local `remove-automatic-bank-sync` change removes Plaid webhook intake, recurring bank catch-up, their runtime persistence/query APIs, and the public sync-worker route. The app still creates a bounded manual run from “立即同步” and invokes the named private `SyncService` entrypoint. The App Worker daily Cron remains exclusively for subscription occurrence generation. Historical migrations and the deployed evidence above are intentionally preserved as records of earlier versions; no runtime source reads or writes the legacy webhook table.

## Outstanding manual gates

Latest complete local verification (`npm run verify`, 2026-09-03): formatting, lint, and all TypeScript checks passed; unit coverage ran 480 passing tests; app Worker coverage ran 208 passing tests; sync Worker coverage ran 5 focused manual-sync tests; Playwright ran 54 passing desktop/mobile tests with 2 intentional project skips; restore bundles and both production Worker/client builds completed. Unit/app/sync statement coverage was 92.67% / 90.09% / 94.44%, and branch coverage was 87.77% / 85.59% / 85.18%, respectively.

The following evidence is intentionally not marked complete:

1. Task 11.2: real-browser Plaid Sandbox first connection, update mode, sync, review, report drill-down, import, and export.
2. Task 12.3: deployed Sandbox Link/manual sync through the private service binding, rollback, subscription Cron, PWA cache, D1 row metrics, and HTTP/Cron/RPC CPU measurements against the 10 ms Free limit.
3. Tasks 12.4-12.5: separately authorized RBC/BMO Trial connections and a 14-day, at-least-30-transaction shadow reconciliation.

Any contradiction found by those gates must update OpenSpec before implementation changes, as required by task 12.6.
