## 1. Licensing and configuration hygiene

- [x] 1.1 Confirm the licence choice with the owner (Open Question 1), then add `LICENSE` at the repository root and declare the same identifier in `package.json`.
- [x] 1.2 Replace the production `database_id` in `apps/web/wrangler.jsonc` with a recognizable placeholder and verify that deploying without replacing it fails with an error naming the placeholder rather than targeting another account.
- [x] 1.3 Record the real `database_id` in the owner's ignored local notes so the owner's own deployment path is unbroken.

## 2. Configurable timezone

- [x] 2.1 Add an IANA timezone validator in `packages/domain` using `Intl.DateTimeFormat` construction, with tests covering valid identifiers, invalid identifiers, and empty values.
- [x] 2.2 Relax `APP_TIMEZONE` and `VITE_APP_TIMEZONE` in `packages/domain/src/environment.ts` from `z.literal` to the validator; verify startup fails loudly on an invalid value.
- [x] 2.3 Replace the fixed `REPORT_TIME_ZONE` and the remaining Toronto literals in `financial-reporting.ts` and `subscriptions.ts` with the configured value threaded through existing call sites.
- [x] 2.4 Replace the fixed timezone in `apps/web/src/features/analysis/analysis-period.ts` and `quick-entry/quick-entry-preferences.ts`, and remove the hardcoded timezone label in `AnalysisControls.tsx`.
- [x] 2.5 Relax the `timezone` literal in the bootstrap contract (`api-contracts.ts`) and add the frontend/Worker agreement check that blocks the UI with both values on mismatch.
- [x] 2.6 Re-run the existing date-sensitive domain, Worker, and browser tests parameterised over `America/Toronto` and one other timezone; confirm Toronto results are bit-for-bit unchanged.

## 3. Open currency set

- [ ] 3.1 Add a currency validator in `packages/domain`: three uppercase letters, with an explicit rejection list for known zero-decimal and three-decimal ISO 4217 codes; test acceptance, scale-risk rejection, and malformed input.
- [ ] 3.2 Replace `z.enum(["CAD","USD"])` in `api-contracts.ts`, `subscriptions.ts`, and `full-json-export.ts` with the validator.
- [ ] 3.3 Rework the two-candidate currency inference in `csv-import.ts` so a third currency is detected per row and ambiguity is surfaced instead of guessed; cover it with import tests.
- [ ] 3.4 Confirm every `/100` conversion and `toFixed(2)` display site still holds under the restricted currency set, and that reports keep currencies separate.

## 4. Backup compatibility

- [ ] 4.1 Relax the `currency` constraint in the v5 export schema without changing `schemaVersion`; prove a pre-change backup restores unchanged. (The `timezone` half landed with task 2.3, which could not compile against a literal-typed export field; covered by tests in `full-json-export.test.ts`.)
- [ ] 4.2 Add the restore-time check that reports a timezone mismatch between the backup and the instance configuration before any write.
- [ ] 4.3 Confirm `remote-migration-guard` and the documented v4-and-earlier rejection boundary are unaffected.

## 5. Interface localization

- [ ] 5.1 Build the typed translation catalogue and React context: `TranslationKey` derived from the Chinese catalogue, English typed as `Record<TranslationKey, string>` so a missing key fails typecheck.
- [ ] 5.2 Extract the 434 hardcoded Chinese lines across the 31 files in `apps/web/src` into the catalogue, in feature-sized batches, keeping the Chinese wording identical to today's interface.
- [ ] 5.3 Write the English catalogue, matching established Chinese terms for reimbursement offset, installments, subscription cancellation with its inclusive effective date, and budget limits.
- [ ] 5.4 Add language selection: initial language from browser preferences, explicit switching, per-device persistence of the explicit choice, and no write to ledger data on switch.
- [ ] 5.5 Replace the fixed `Intl.NumberFormat("zh-CN")` locales in `overview-data.ts` and `analysis-data.ts` with the active language, keeping values and currency separation unchanged.
- [ ] 5.6 Localize only the two immutable system categories by `system_key`; confirm editable and owner-renamed categories always render their stored name (design D6).
- [ ] 5.7 Add a blocking check that fails when a Chinese literal reappears in user-visible positions in `apps/web/src`.
- [ ] 5.8 Verify both languages at 320/768/1024/1440 px for overflow and truncation, since English strings are typically longer than their Chinese equivalents.

## 6. Documentation

- [ ] 6.1 Confirm the documentation language decision with the owner (Open Question 3).
- [ ] 6.2 Write `docs/self-hosting.md`: D1 creation, migrations, Zero Trust Access application setup, the source of each of `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `OWNER_EMAIL` and `CSRF_HMAC_KEY`, the Cron Trigger, regional configuration, and a final check that the owner can log in while anonymous requests are denied.
- [ ] 6.3 State the supported-currency limitation and the Cloudflare Access prerequisite explicitly in the guide.
- [ ] 6.4 Strip self-hoster-facing content from `docs/free-preview-deployment.md`, leaving it as the owner's operations record.
- [ ] 6.5 Update `README.md` for the self-hosting path, the configurable timezone and currency, the interface languages, and a link to the guide.
- [ ] 6.6 Document how a self-hoster gets default categories in their own language (design D6, Open Question 4).

## 7. Verification

- [ ] 7.1 Run `npm run verify` and record the result; confirm coverage thresholds are not lowered to accommodate new code.
- [ ] 7.2 Verify the owner's own configuration end to end: Toronto, `CAD`/`USD`, Chinese interface, existing backup restores, subscription Cron behaviour unchanged.
- [ ] 7.3 Deploy nothing. Surface the remaining open questions for the owner's decision before any release. (The repository was already public when this change began; open question 2 covers what that implies for history.)
