## Why

Quick entry currently writes an unknown merchant as an unclassified transaction before asking the owner to choose between generic popular categories. This makes familiar merchants such as IKEA and Amazon appear unrecognized, presents misleading suggestions, and violates the intended rule that the owner confirms a new merchant before it is recorded.

## What Changes

- Preview merchant classification when the owner submits quick entry, before creating a transaction.
- Continue to record merchants with an active exact owner rule immediately, without extra confirmation.
- For a new merchant, present one merchant-specific suggested category and the complete active expense-category list before any write occurs.
- Allow the owner to accept the suggestion or directly choose another category from the list, with optional search.
- On confirmation, atomically create the transaction with the selected category and save the exact future merchant rule.
- Keep the form intact and create nothing when the owner cancels the confirmation.
- Recognize ordinary IKEA and Amazon names as Shopping suggestions while preserving distinct Amazon Prime handling.

## Capabilities

### New Capabilities

- `quick-entry-merchant-confirmation`: Pre-write merchant matching, new-merchant confirmation, complete category selection, and atomic transaction-plus-rule creation.

### Modified Capabilities

None.

## Impact

- Quick-entry React state and category-selection UI.
- Manual-transaction API contracts and Worker routes.
- Merchant-family classification and persistence transaction boundaries.
- Browser, domain, persistence, and Worker integration tests.
- No new runtime dependency or external classification service.
