## Why

The owner can no longer use Plaid and wants a small personal ledger with CSV imports and manual entries.

## What Changes

- **BREAKING** Remove all bank connections/sync, subscriptions, automated transfer matching, and the standalone review queue.
- Keep one app Worker with authenticated APIs and one D1 database; retain transaction/category/rule editing, import duplicate review, summaries, and exports.
- Preserve existing ledger records and historical backup compatibility. The owner subsequently authorized updating the existing website on 2026-09-04; no remote database deletion or migration.

## Capabilities

### Modified Capabilities

- `bank-account-sync`: Removed; data entry is CSV or manual only.

## Impact

Client routes, app APIs, obsolete workers/packages, tests, and deployment configuration.
