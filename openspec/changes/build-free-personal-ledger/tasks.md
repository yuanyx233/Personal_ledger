## 1. Workspace and executable contracts

- [ ] 1.1 Initialize the TypeScript workspace for the React/Vite client, protected app Worker, public sync Worker, and shared domain package with pinned runtime/tool versions.
- [ ] 1.2 Configure linting, formatting, type checking, unit/integration tests, browser tests, coverage thresholds, and one local verification command.
- [ ] 1.3 Add checked-in environment schemas and example files that distinguish public configuration, local-only secrets, and production Worker secrets without containing real credentials.
- [ ] 1.4 Define shared API success/error envelopes, stable error codes, cursor pagination, idempotency-key, optimistic-version, money, date, and currency schemas; add contract tests before handlers.
- [ ] 1.5 Add fixture factories and a deterministic clock/timezone harness for Plaid, ledger, import, and report test data.

## 2. D1 schema and persistence boundaries

- [ ] 2.1 Write failing schema tests for connections, eligible accounts, canonical transactions, pending links, categories, merchant rules, category audits, transfer matches, sync events/runs, and import batches/rows.
- [ ] 2.2 Create the initial ordered D1 SQL migration with foreign keys, uniqueness constraints, status checks, integer minor-unit checks, timestamps, and optimistic versions.
- [ ] 2.3 Add indexes for Plaid ids, Item cursors/status, posted-date report scans, transaction filters, normalized merchant rules, review queue, sync leases/events, and import fingerprints; verify query plans for representative ranges.
- [ ] 2.4 Implement typed persistence repositories using prepared statements only and prove with tests that external filter/sort values cannot become SQL fragments.
- [ ] 2.5 Implement local migration apply/reset and fixture seed commands, then verify a clean database can be recreated and queried from scratch.

## 3. Authentication and security foundation

- [ ] 3.1 Write failing request tests for missing, forged, expired, wrong-issuer, wrong-audience, and wrong-email Cloudflare Access assertions.
- [ ] 3.2 Implement Access JWT verification against the configured JWKS plus the single-owner email allowlist for every app/static/API request.
- [ ] 3.3 Write and implement same-origin CORS denial, Origin/Fetch-Metadata checks, JSON content-type checks, and session-bound CSRF protection for all browser writes.
- [ ] 3.4 Add CSP, HSTS, frame denial, MIME-sniffing, referrer policy, and no-store headers for authenticated API/export responses; verify headers in integration tests.
- [ ] 3.5 Implement AES-256-GCM Plaid-token encryption/decryption with random IV, authenticated context, key versioning, rotation test vectors, and zero token exposure in API responses.
- [ ] 3.6 Add structured redacted logging and tests that inject token-, account-, merchant-, CSV-, and webhook-like values and confirm none appear in logs/errors.
- [ ] 3.7 Add per-route body/row/date/page limits and rate limits with stable 413/422/429 responses.

## 4. Plaid Link and connection lifecycle

- [ ] 4.1 Write Plaid-adapter contract tests for Canada-only Transactions Link configuration, 730-day request, Account Select, and checking/credit-card filters.
- [ ] 4.2 Implement protected initial Link-token creation without Auth, Identity, Balance, Assets, Statements, or Investments products.
- [ ] 4.3 Write and implement idempotent public-token exchange that verifies RBC/BMO institution identity, encrypts the access token, and rejects unsupported institutions/accounts.
- [ ] 4.4 Implement the connection/account read model and owner controls that enable only returned chequing and credit-card accounts.
- [ ] 4.5 Write and implement update-mode Link-token creation for login required, consent expiry, and account-selection changes without creating/re-exchanging an Item.
- [ ] 4.6 Add a guarded extra-Item flow that explains the non-reclaimable Plaid Trial limit and requires explicit owner confirmation.
- [ ] 4.7 Implement sanitized connection health/status mapping, last-success time, consent state, and next-action codes.

## 5. Incremental sync and webhook processing

- [ ] 5.1 Write failing sync tests for initial/multi-page incremental added, modified, removed, retry, and cursor rollback behavior.
- [ ] 5.2 Implement the shared `/transactions/sync` cursor loop and atomic batch persistence so a cursor advances only after every page succeeds.
- [ ] 5.3 Write and implement canonical Plaid transaction upsert, exact minor-unit/direction conversion, allowlisted metadata, pending-to-posted linkage, and removed-state handling.
- [ ] 5.4 Write webhook tests for valid/invalid signature, body hash, timestamp, key, oversized body, unknown Item, duplicate event, and out-of-order event.
- [ ] 5.5 Implement the sync Worker with only `POST /webhooks/plaid`, Plaid ES256 JWT verification, minimal idempotent event persistence, and fast bounded responses.
- [ ] 5.6 Implement per-Item sync leases, run states, exponential retry/backoff, and safe resume behavior; prove concurrent triggers cannot run competing cursor loops.
- [ ] 5.7 Implement the scheduled catch-up handler and stale/failed Item selection with a configurable at-least-hourly cadence and free-plan work caps.
- [ ] 5.8 Implement the protected idempotent manual sync-run endpoint and status polling, including continuation by a later scheduled execution.
- [ ] 5.9 Add Sandbox integration fixtures/tests for duplicate and out-of-order webhook delivery, pending-to-posted, Item error/update mode, and missed-webhook catch-up.

## 6. Ledger semantics and review decisions

- [ ] 6.1 Write canonical-ledger tests that combine Plaid, manual, and CSV sources without duplicate identities or floating-point amounts.
- [ ] 6.2 Implement manual transaction create/update/delete with validation, category/source provenance, audit timestamps, and 409 optimistic-conflict behavior.
- [ ] 6.3 Write positive and negative transfer-matching fixtures covering card payments, two own chequing accounts, date boundaries, different currencies/amounts, multiple candidates, and external e-Transfers.
- [ ] 6.4 Implement deterministic high-confidence transfer candidate generation and automatic matching using equal amount/currency, opposite direction, three-day window, and supporting evidence.
- [ ] 6.5 Implement audited owner decisions to confirm, break, or ignore a transfer match and ensure manual decisions override later automation.
- [ ] 6.6 Implement external e-Transfer handling that preserves unmatched inflow/outflow, displays only supplied payment metadata, and flags uncertain purpose/category for review.
- [ ] 6.7 Write and implement refund semantics and whole-transaction marketplace behavior, including Amazon as one transaction/one category.
- [ ] 6.8 Implement the filtered cursor-paginated transaction query/detail API with allowlisted filters/sorts and URL-reproducible query parameters.

## 7. Categories, merchant rules, and audit

- [ ] 7.1 Seed a minimal editable category taxonomy plus protected system categories for unclassified and transfer states; test category-type invariants.
- [ ] 7.2 Write tests for exact merchant normalization and the precedence `MANUAL > RULE > PLAID > UNCLASSIFIED`, including similar-but-not-equal merchant names.
- [ ] 7.3 Implement deterministic normalization, mapped Plaid category ingestion, exact active merchant-rule matching, and categorization-source persistence.
- [ ] 7.4 Implement “只改这一笔” as a transaction override with append-only old/new category/source audit.
- [ ] 7.5 Implement “以后这个商户都这样” as a versioned exact rule that corrects the current transaction and applies only to future matching transactions by default.
- [ ] 7.6 Implement merchant-rule list/create/update/deactivate endpoints with conflict preview and no unconfirmed historical batch rewrite.
- [ ] 7.7 Implement the unified review-queue query/count for unclassified merchants, uncertain e-Transfers, ambiguous transfers, and rule conflicts.
- [ ] 7.8 Add tests and API filters that enumerate merchants/transactions classified by owner rule versus Plaid automatic classification.

## 8. Reporting engine and APIs

- [ ] 8.1 Create reconciled report fixtures for posted/pending/removed, transfers, income, expense refunds, zero prior periods, empty months, CAD/USD, manual, and CSV transactions.
- [ ] 8.2 Write failing tests for eligible-population rules and the exact income, net-spending, and net-cash-flow formulas by currency.
- [ ] 8.3 Implement a shared report query layer using Toronto calendar month/quarter/year boundaries and safe custom ranges.
- [ ] 8.4 Implement like-for-like previous-period/previous-year absolute and percentage comparisons with `N/A` on zero denominators.
- [ ] 8.5 Implement category distribution, merchant ranking, account/category/merchant filters, and drill-down keys that reconcile to canonical transaction queries.
- [ ] 8.6 Implement separate-currency response sections and prove no endpoint silently adds non-CAD amounts into CAD.
- [ ] 8.7 Add report freshness metadata and integration tests that surface stale connections/last-success time.

## 9. Data import, export, and recovery

- [ ] 9.1 Write hostile/edge CSV fixtures for encoding, oversized files/rows/columns, invalid dates/amounts/currencies, quoted delimiters, formulas, exact repeats, and suspected duplicates.
- [ ] 9.2 Implement streaming/bounded CSV parsing, explicit column mapping, row validation, and an expiring no-write preview with valid/invalid/duplicate counts.
- [ ] 9.3 Implement idempotent import commit using batch checksum and canonical row fingerprint, with row-level results and source provenance.
- [ ] 9.4 Implement filtered transaction CSV export with stable headers, exact amount round-trip, provenance, and spreadsheet-formula neutralization tests.
- [ ] 9.5 Implement schema-versioned complete JSON export containing all portable ledger/audit/rule/decision data and no secret/sync payload material.
- [ ] 9.6 Implement a local restore command into an empty separate D1 database and verify transaction counts, audit links, rules, transfer decisions, and report totals reconcile.
- [ ] 9.7 Add a destructive-migration guard that requires passing export/restore evidence before the documented remote migration step.

## 10. Responsive product interface

- [ ] 10.1 Build the accessible mobile bottom navigation and desktop sidebar shell with routes for overview, transactions, analysis, and settings.
- [ ] 10.2 Implement shared loading, empty, error, stale, action-required, and offline states; ensure API data/exports are never cached by the Service Worker.
- [ ] 10.3 Build the overview in priority order: sync health/repair, review count, current-month income/net spending/net cash flow, and six-month trend.
- [ ] 10.4 Build the mobile transaction list and desktop table with URL-backed filters, source/status/category badges, pagination, and untrusted-text rendering.
- [ ] 10.5 Build the transaction detail/edit surface for raw fields, classification provenance/audit, the two correction scopes, and transfer decisions.
- [ ] 10.6 Build the review workflow for unclassified merchants, uncertain e-Transfers, ambiguous transfers, and rule conflicts without silent bulk changes.
- [ ] 10.7 Build month/quarter/year/custom analysis views with period navigation, summary metrics, trend/category/merchant visualizations, accessible tables, and drill-down.
- [ ] 10.8 Build settings for RBC/BMO connections/enabled accounts, repair/manual sync, categories/rules, manual entry, CSV preview/commit, and CSV/JSON exports.
- [ ] 10.9 Add clear confirmations and impact text for Item removal, manual-transaction deletion, import discard, and other destructive actions.

## 11. Verification and hardening

- [ ] 11.1 Run unit, integration, contract, migration, report-reconciliation, security, and export/restore suites under coverage thresholds and fix every failure.
- [ ] 11.2 Run real-browser mobile/desktop end-to-end flows for first connection (Sandbox), sync, review, correction, manual entry, report drill-down, import, and export.
- [ ] 11.3 Verify keyboard-only operation, focus order/visibility, labels, semantic landmarks/tables, reduced motion, contrast, zoom/reflow, and non-color-only meaning to WCAG 2.1 AA.
- [ ] 11.4 Test XSS text, SQL injection inputs, CSRF, Access-token/JWT failures, forged/replayed webhooks, CSV formula injection, oversized requests, rate limits, and log redaction.
- [ ] 11.5 Measure representative D1 query plans, Worker request/CPU counts, scheduled work, and storage against current free limits; document safe caps and failure behavior.
- [ ] 11.6 Produce a verification report mapping every OpenSpec scenario to automated evidence or a clearly identified manual shadow-validation step.

## 12. Authorized deployment and live-data validation

- [ ] 12.1 Prepare (without executing) the free `workers.dev` deployment runbook, D1 migrations, Worker secret list, Cloudflare Access deny-by-default policy, Plaid Sandbox URLs, rollback, and no-auto-paid guardrails.
- [ ] 12.2 After separate explicit user authorization, deploy preview Workers/D1, configure the single owner email and secrets, and verify Access JWT enforcement before exposing any API.
- [ ] 12.3 Verify the deployed application entirely with Plaid Sandbox, including public webhook isolation, scheduled catch-up, manual refresh, PWA cache policy, export, and rollback.
- [ ] 12.4 After separate explicit user authorization and confirmation of current Plaid Trial terms, connect RBC and BMO once each and select only chequing/credit-card accounts.
- [ ] 12.5 Run the 14-day shadow validation and reconcile at least 30 sampled live transactions for omissions, duplicates, pending-to-posted, card payments, e-Transfers, merchant fields, and report totals.
- [ ] 12.6 Record any live-data contradiction as an OpenSpec update before changing implementation; only mark personal-use readiness after all blocking discrepancies are resolved.
- [ ] 12.7 Document monthly JSON export/restore practice and the optional future custom-domain route/Access/Plaid-URL migration without purchasing or configuring a domain.
