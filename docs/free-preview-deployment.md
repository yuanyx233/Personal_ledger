# Deployment runbook

The application now uses one App Worker with static frontend assets and one D1 database. The App Worker has a scheduled handler and one `*/15 * * * *` Cron Trigger for monthly subscription catch-up. There is no Sync Worker binding, Plaid credential requirement, or bank connection flow.

The original production execution remains recorded in `openspec/changes/build-free-personal-ledger/verification.md`. The owner-authorized 2026-09-04 simplified website release and rollback version are recorded in `openspec/changes/remove-automatic-bank-sync/tasks.md`. Every subsequent deployment, Access change, remote migration, or deletion of an old remote Worker requires separate explicit authorization.

## Before deployment

### Current subscription release — verified 2026-09-16

Production version `89d65032-4549-4e12-ac53-1941b581e3e5` exposes subscription management and the active `*/15 * * * *` subscription Cron. Remote D1 reports no pending migrations through `0022_merchant_knowledge_categories.sql`. The immediately preceding deployed version is `3cb35bc0-2080-425d-b4d6-b7664612ebd9`; preserve the additive D1 migrations on any application rollback.

The complete build, test, asset-hash, screenshot, D1, and live Cron evidence is recorded in `openspec/changes/restore-monthly-subscriptions/tasks.md`.

### Merchant service grouping release — 2026-09-05

Owner-authorized version `05ba1cdc-de7d-4a92-896f-f0e629541429` combines recognized merchant orders and branches in spending rankings while keeping different services separate (Amazon shopping/Prime, Uber rides/Eats). Family drill-down filters apply before transaction pagination and CSV export limits; exact filters retain their original meaning. Original records, category rules, and duplicate matching are preserved, with no database migration.

`npm run verify` passed 294 unit tests, 135 Worker tests, and 68 browser tests (2 existing skips), along with formatting, lint, type checking, and production build. Tests reconcile 108 Amazon transactions across pagination and export, including refunds and reimbursements. The fixed release is recorded in ignored `.wrangler/merchant-family/release.json`; Worker SHA256 is `5ba2bdcd8b1411718e9293d7cbd84eed3fe28f62ca0b050d2489cb1d60037313`. Compatible rollback version: `e22ca82d-2e9c-459f-9764-ae741d37254b`. Wrangler dry-run and deployment passed. Live September analysis shows one Amazon group with five transactions totaling CAD 148.00; its transaction link returns exactly those five records. Other recognized merchants have readable group names, and anonymous analysis still returns HTTP 302.

### Merchant ranking display correction — 2026-09-05

Owner-authorized version `e22ca82d-2e9c-459f-9764-ae741d37254b` fixes merchant ranking labels when the separate merchant name is absent but the imported normalized description is available. Grouping and drill-down keys are preserved. `npm run verify` passed: 278 unit tests, 134 Worker tests, 66 browser tests (2 existing skips), formatting, lint, type checks, and production build. The new regression covers the imported-name fallback, genuinely missing names, and the merchant transaction link.

The fixed release is recorded in ignored `.wrangler/merchant-display/release.json`. Worker SHA256 `967f29cef3354a2cd8ee33d1bec0ff5e52c3845949cfdb6a3b7865093e31e20d` matches the preceding release; only two frontend assets were uploaded. Compatible rollback version: `dee46a94-fb64-4c01-99eb-404660573f24`. Wrangler dry-run and deployment passed. Authenticated live analysis now displays the existing Aesop, T&T, Amazon, and Uber Eats descriptions instead of missing-merchant placeholders; anonymous analysis still returns HTTP 302. No production data or schema was changed.

### Overview spending pie release — 2026-09-05

The homepage replaces its six-month comparison with current-month category spending pies and amount/share tables. Categories link to filtered transactions; currencies stay separate, refunds reduce their categories, and nonpositive totals have an explicit empty state. The existing current-month cash-flow figures remain.

`npm run verify` passed: 278 unit tests, 134 Worker tests and 64 browser tests (2 existing skips), plus formatting, lint, type checks and production build. Desktop and 320 px mobile screenshots were inspected. Browser coverage includes category drilldown, separate currencies, a single-category circle, net refunds and empty data. Wrangler dry-run completed with the intended existing bindings; its optional global log file was blocked by the local filesystem sandbox.

The isolated release is recorded in ignored `.wrangler/overview-pie/release.json`. Its Worker SHA256 is `967f29cef3354a2cd8ee33d1bec0ff5e52c3845949cfdb6a3b7865093e31e20d`, identical to the existing production Worker. Only frontend assets change. Compatible rollback version: `be2279f6-3f15-4ad7-9bc8-f65972064dc8`. After the owner explicitly authorized deployment, version `dee46a94-fb64-4c01-99eb-404660573f24` was published successfully. Three frontend assets were uploaded. Authenticated live verification confirmed the current-month pie, matching category amounts and shares, category transaction links, and removal of the six-month comparison. The page screenshot was inspected and browser warnings/errors were empty. No production transactions or database schema were modified.

### Import-time automatic classification correction — 2026-09-05

Version `be2279f6-3f15-4ad7-9bc8-f65972064dc8` updates the existing live ledger's CSV commit path following the owner's clarification that classification must happen as part of every import. Explicit CSV categories and exact owner rules retain priority; supported merchant families reuse unambiguous active owner rules before built-in defaults. Unknown merchants and conflicting families remain reviewable. Refund directions, fingerprints, and existing transactions are preserved. Built-in classifications appear as “自动识别商户” in transaction detail. No schema migration, historical recategorization, new service, permission change, Git commit, or push was performed.

Regression evidence: the import test first failed with four recognized rows left unclassified; the final `npm run verify` passed 279 unit tests, 134 Worker tests and 58 browser tests (2 existing skips). Unit branch coverage is 85.64%; Worker branch coverage is 86.76%. Exact/manual priority, family conflicts, inactive categories, read failures, refunds, repayments, idempotent replays and existing-transaction reconciliation are covered. OpenSpec strict validation, format, lint, type checks, build and Wrangler dry-run passed. Live settings displays the automatic-classification explanation and browser warnings/errors are empty. No test transactions were inserted in production.

The fixed release bundle is recorded in ignored `.wrangler/import-auto/release.json`, with Worker SHA256 `967f29cef3354a2cd8ee33d1bec0ff5e52c3845949cfdb6a3b7865093e31e20d`. Roll back application code to `55b923ad-3b2f-4ca5-b1e5-5acbb6c8293b` while preserving D1. Automatic approval review rejected a proposed full financial snapshot because explicit sensitive-export authorization was missing; that export was not executed. The code-only release proceeded without a database export or migration.

### Latest budget and tuition release — 2026-09-05

Owner-authorized version `55b923ad-3b2f-4ca5-b1e5-5acbb6c8293b` publishes monthly category spending shares, the month picker and persistent per-category budget limits. It also includes the existing reimbursement implementation required by the current reporting code. Migrations `0018_transaction_reimbursements.sql` and `0019_category_budgets.sql` were applied after a fresh full JSON snapshot passed an isolated restore. Existing reimbursement values initialize to zero.

The owner also authorized a tuition category and correction of the verified UofT payments. Four transactions were recategorized, with four matching exact merchant rules and four new category audits; all other 415 transactions were unchanged. Private before/after backups and verification evidence are in the ignored `backups/2026-09-05-budget-tuition/` directory. The post-release backup also passed isolated restore.

`npm run verify`, production dependency audit, Wrangler dry-run and production deployment passed. Authenticated analysis shows the budget section and tuition spending, and the tuition budget editor opens correctly without creating a test budget. Browser warnings/errors were empty; anonymous analysis still returns HTTP 302. The prior compatible Worker version is `52e07c17-4822-4059-b435-9d458f82bdab`; preserve D1 and its additive migrations on rollback. See `openspec/changes/add-monthly-category-budgets/tasks.md` for release artifact and verification details.

### Latest visual-only release — 2026-09-04

Owner-authorized version `52e07c17-4822-4059-b435-9d458f82bdab` publishes the approved neutral colors, spacing and system sans-serif typography. Rollback version: `8ebf0156-0d19-4a7c-a376-be6983f842dc`. The isolated release is `/tmp/ledger-visual-release.zewfKD`; only `/index.html` and `/assets/index-CepyVeFp.css` were uploaded. Frontend JavaScript and Worker code are byte-identical to the prior production release. The separate reimbursement implementation and migration 0018 were not deployed.

The typography pass had 54 browser tests passing (2 existing skips). The actual release artifacts were additionally checked at 320/768/1024/1440 px with mocked local reads: settings and entry have no overflow or browser errors. Vite CSS build and Wrangler dry-run passed. Live settings loads the new stylesheet and system sans-serif font; transactions renders 25 records, entry retains its submit button, and browser logs contain no errors/warnings. Anonymous settings requests still receive HTTP 302. The production D1 binding, secrets, Access policy, and empty app cron list are unchanged; no remote data writes or migrations were performed.

### Preflight

- Run `npm run verify` on the exact source being deployed.
- Confirm the intended account, existing App Worker and D1 identifiers in `apps/web/wrangler.jsonc`; do not create replacement resources for an existing ledger.
- Keep Cloudflare Access restricted to the exact owner email. The Worker must also validate the JWT and owner.
- Keep a recent complete JSON export and verify restoration before any database migration. Do not drop legacy tables as part of removing application features.
- Check the account's current free-plan usage without enabling paid services.

## Configuration and authorized deployment

Public configuration: `APP_TIMEZONE=America/Toronto`. Required encrypted secrets: `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `CSRF_HMAC_KEY`, `OWNER_EMAIL`. The CSRF key is 32 random bytes encoded as Base64. Never put real secrets in source, shell history, URLs, or logs.

After explicit deployment authorization:

```bash
npm run build
npx wrangler deploy --config apps/web/wrangler.jsonc
```

Do not deploy the removed Sync Worker. Keep the App's `triggers.crons` value exactly `["*/15 * * * *"]`; Cloudflare replaces previous Cron Triggers with the values declared in Wrangler configuration. Do not remove the subscription Cron during unrelated releases. The separate old Sync Worker and legacy secrets still require exact-resource inspection and separate authorization before removal.

For a separately authorized remote database migration, first run the documented `npm run db:migrate:remote` preflight against a fresh local restore directory. Only use its `--execute` option after reviewing the backup and migration result. Never overwrite the existing D1 or reverse its migration history.

## Acceptance and rollback

Verify anonymous/wrong-owner denial, authenticated session bootstrap, CSRF protection, manual and installment entry, subscription management and scheduled generation, category correction (including Transfer), CSV preview/commit/deduplication, currency-separated reports and both exports. Financial responses remain no-store; offline pages must not reveal cached ledger data. No bank, sync or review-queue API should be available.

On failure, preserve D1 and restore a verified compatible App Worker version under explicit authorization. Keep access denied if compatibility cannot be established. Validate login and ledger reads before re-enabling access.

## Prepared one-month Access session change

This three-duration change was authorized and saved on 2026-09-02; its evidence and remaining fresh-token checks are recorded in the verification report. Any repeat, rollback, token revocation, or change to another account/application/policy is a new remote action and requires separate authorization that names its scope. Preparing or testing local code does not grant that authorization.

The intended outcome is one-month convenience on trusted personal browsers without weakening the existing boundary: the ledger application remains deny-by-default, its only Allow identity remains the one exact owner email, and the Worker continues to validate the Access JWT and `OWNER_EMAIL`. Do not add an Everyone, email-domain, Login Methods, Bypass, Service Auth, or shared-secret rule; do not expose an alternate hostname/path; and do not store an Access token in browser storage. Cloudflare documents why an Everyone or overly broad login-method rule can expose an application and why Bypass is evaluated before Allow in [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

### Why all three durations must be inspected

Cloudflare issues a global token on the team domain and an application token on the protected hostname. The global duration controls IdP single sign-on; an explicit policy duration controls the application token, while the application duration is only the policy fallback. If **Authenticate with Cloudflare One Client** is enabled, its client-session duration overrides global, application, and policy durations. Independent MFA duration is separate and can still cause an MFA prompt during a login flow. These precedence rules and dashboard locations come from Cloudflare's [session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/) documentation; token scope and cookie expiration come from its [authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/) documentation.

Therefore, “one month” is not established by changing one dropdown. For this ordinary-browser setup, require all of the following after authorization:

| Scope                             | Prepared target | Required check                                                                                                                                                                                                                                  |
| --------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global                            | `1 month`       | Record the previous value and confirm the blast radius: this setting affects SSO for every Access application in the Zero Trust organization. Stop if unrelated applications exist unless the authorization explicitly covers that consequence. |
| `personal-ledger-app` application | `1 month`       | Confirm the application protects only the exact app hostname and that **Authenticate with Cloudflare One Client** is disabled. Do not change cookie, MFA, path, or login-method settings in this task.                                          |
| Sole owner Allow policy           | `1 month`       | Confirm the policy is attached to this application, is not unexpectedly shared, and still has exactly one Include rule for the exact owner email. Stop rather than editing a policy whose other consumers are not authorized.                   |

Cloudflare permits these session values up to one month. A policy set to **Same as application** would inherit the application value, but this prepared change records an explicit one-month value at each of the three requested scopes so the effective configuration is auditable. Do not change the duration to more than one month even if another interface later exposes a larger value.

### Authorized dashboard sequence

Only after the separate remote-change authorization:

1. In **Zero Trust > Access controls > Access settings**, record the current global session duration, then set **Set your global session duration** to `1 month` and save.
2. In **Zero Trust > Access controls > Applications**, configure only `personal-ledger-app`, record its current Session Duration and authentication settings, set **Session Duration** to `1 month`, and save.
3. In **Zero Trust > Access controls > Policies**, configure only the application’s sole owner Allow policy, record its current Session Duration and full rule list, set **Session Duration** to `1 month`, and save. Re-check that the rule is one exact owner email and that no Bypass or broader Allow policy can match first.
4. Re-open all three pages and read the saved values back. Record account/application/policy IDs, timestamps, previous values, new values, and redacted screenshots; never record cookie or JWT values.
5. Existing cookies may reflect a previously issued session. On each test browser, visit `https://personal-ledger-app.<account-subdomain>.workers.dev/cdn-cgi/access/logout`, wait at least 30 seconds, and authenticate again to obtain a fresh application session. This user logout is intentionally part of verification; an administrator-wide **Revoke existing tokens** is not authorized unless it was explicitly included in the remote-change approval.

### Trusted-browser and device verification

Use normal browsing mode for the acceptance path. Cloudflare notes that private-browser tracking protection can block the third-party cookie needed for Access XHR, so an incognito/private window is a negative fresh-session check, not evidence that a normal trusted-device session is broken.

For each intended device/browser (at minimum desktop browser, iPhone Safari, and the iPhone home-screen app):

1. After the fresh logout/sign-in above, open `/add` and make only a read request such as `/api/v1/session`; do not create a test transaction. Confirm the owner is admitted and a different email is denied.
2. Close and reopen the normal browser or home-screen app, then revisit `/add`. Confirm no IdP prompt occurs while the fresh session is valid and that no financial page is available offline.
3. Without copying values, inspect only cookie names, host scopes, and expirations where the browser permits it: the app-domain `CF_Authorization` expiration should reflect the policy/application duration, and the team-domain `CF_Authorization` expiration should reflect the global duration. Treat the cookie value as a credential and never put it in screenshots, logs, tickets, or exports.
4. In **Zero Trust > Team & Resources > Users**, open the owner and record the relevant session identity and displayed expiry time (not token contents). Cloudflare documents these fields in [User logs](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/users/); they are the durable evidence that the newly issued session has the intended lifetime.
5. On a browser profile or device with no Access cookie, confirm that opening `/add` requires authentication before HTML or ledger data is returned. Also clear site data on one disposable test profile and confirm the same behavior.
6. Confirm an expired AJAX request is handled as a sign-in/reload state rather than an unauthenticated write. Access returns `401` for an expired AJAX subrequest when it carries `X-Requested-With: XMLHttpRequest`; the application must not retain or replay a secret credential.

Do not claim the monthly-session change verified merely because the dashboard says `1 month`. Evidence requires fresh post-change tokens plus the normal-browser revisit and no-cookie device checks above. A full month need not elapse; record the server-displayed expiry and the immediate cookie/revisit behavior.

### Lost device, revocation, and rollback

A longer session increases the time a lost unlocked device may retain access. The emergency response is fail-closed:

1. From a known-safe device, secure or disable the owner identity-provider account if the identity itself may be compromised.
2. In **Zero Trust > Access controls > Applications**, use `personal-ledger-app` > **Configure > Revoke existing tokens** to terminate all active sessions for this application, or in **Team & Resources > Users** revoke the owner to terminate that user’s sessions across applications. These are remote changes and require authorization unless responding under a separately agreed emergency procedure. Revocation does not permanently block a still-active IdP identity from authenticating again; disable the IdP identity first when permanent denial is required. Cloudflare's [session revocation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#revoke-user-sessions) is authoritative for this sequence.
3. Cloudflare describes administrator revocation as immediate. For comparison, its end-user logout documentation allows 20–30 seconds for previously issued tokens to stop being accepted, and an administrator-revoked user may be unable to sign in again for up to one minute. Verify the lost/no-cookie session can no longer reach the app, then sign in from the safe device if appropriate.

To roll back the monthly setting, restore the recorded previous policy, application, and global durations at their respective dashboard locations, re-read all values, and revoke existing sessions so already-issued longer tokens cannot preserve the extended access. Because the global value affects every Access application and a user revocation affects every application for that user, the rollback scope must be explicit. Keep the sole owner Allow rule and Worker JWT checks unchanged throughout; if any value or policy cannot be proven, revoke sessions and keep the application denied until reviewed.
