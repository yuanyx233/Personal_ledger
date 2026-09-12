## Why

Two earlier changes left dead code behind. `remove-automatic-bank-sync` stopped all Plaid synchronization and automatic transfer pairing, but the backup/restore/verification chain still carries `connections`, `accounts`, `transfer_matches`, `transfer_match_audits`, and Plaid classification fields that no runtime code reads or writes. `confirm-new-merchants-before-entry` replaced post-write category confirmation with a pre-write merchant preview, but the superseded confirmation component, its `/category-suggestions` endpoint, and their persistence support were never removed.

## What Changes

- **BREAKING** Remove bank-connection, bank-account, automatic transfer-match, and Plaid classification records from the full JSON export format, its restore SQL, and its reconciliation evidence. Exports written after this change SHALL NOT be restorable into those tables, and backups written before it SHALL NOT be accepted by the current restore path.
- Remove the superseded post-write category confirmation interface, the `GET /transactions/{id}/category-suggestions` resource, and `CategoryRepository.suggestForTransaction`.
- Remove unreferenced Plaid test fixtures, unreferenced exported types, and dead stylesheet rules; narrow package exports that are only used inside their own module.
- Preserve the historical migration files, the existing production tables and their rows, transaction correction, explicit transfer categorization, reports, and every remaining workflow.

## Capabilities

### Modified Capabilities

- `data-portability`: The complete JSON export covers only the records the current ledger reads.
- `merchant-categorization`: Category suggestion happens before a transaction is written, not after.
- `quick-entry`: Quick entry confirms a new merchant before the first write; there is no post-write confirmation step.

## Impact

- Domain export contracts, persistence export/restore/evidence, App Worker routes, quick-entry interface, stylesheet, backup scripts, and the associated domain/persistence/Worker/browser tests.
- No schema migration, no remote database change, no deployment, and no commit are part of this change.
- Pre-change backups under `backups/` and `.wrangler/` remain on disk as the historical record of the 14 legacy transfer-match rows; they are not deleted and not rewritten.
