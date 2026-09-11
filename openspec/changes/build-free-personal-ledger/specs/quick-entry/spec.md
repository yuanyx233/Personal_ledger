## ADDED Requirements

### Requirement: iPhone-first quick entry

The system SHALL provide a protected `/add` route optimized for recording a purchase immediately after it occurs. The primary flow SHALL require only amount and merchant/description; it SHALL default to the current `America/Toronto` date, `OUTFLOW`, `CAD`, and the owner-selected default account label, initially `RBC Credit`, while allowing every default to be changed before saving.

#### Scenario: Owner records a normal purchase

- **WHEN** the owner opens `/add`, enters a valid amount and merchant/description, and saves without expanding optional fields
- **THEN** the system SHALL create one posted manual transaction using the quick-entry defaults and SHALL NOT require category selection before the first save

#### Scenario: Owner used a different account

- **WHEN** the owner changes the account from `RBC Credit` before saving
- **THEN** the transaction SHALL use the selected account label while the global default remains available for the next entry

#### Scenario: Quick-entry input is invalid

- **WHEN** amount, date, currency, direction, account label, or description fails the shared transaction boundary schema
- **THEN** the system SHALL return field-level validation without creating a partial transaction

### Requirement: Immediate category confirmation when needed

After a quick transaction is saved, the system SHALL finish immediately when an active deterministic merchant rule already supplied the category. Otherwise it SHALL keep the saved transaction as `Unclassified` and immediately show a compact confirmation step containing at most two category suggestions plus an “other category” control.

#### Scenario: Known merchant is saved

- **WHEN** the normalized merchant/description matches one active owner rule
- **THEN** the transaction SHALL be categorized by that rule and the quick-entry flow SHALL show success without an extra confirmation step

#### Scenario: Unknown merchant is saved

- **WHEN** no active deterministic rule supplies a category
- **THEN** the transaction SHALL be saved once, included in total spending as unclassified, and the same screen SHALL immediately ask the owner to confirm a category

#### Scenario: Owner postpones confirmation

- **WHEN** the owner chooses “稍后确认”
- **THEN** the transaction SHALL remain unclassified in the existing review queue and SHALL NOT be duplicated or discarded

### Requirement: Bounded suggestions and searchable alternatives

Category suggestions SHALL be advisory only, SHALL contain active editable categories, and SHALL be derived from deterministic owner history or stable fallback ordering. Suggestions MUST NOT silently classify an unknown merchant. The “other category” control SHALL search existing categories before offering category creation.

#### Scenario: Owner accepts a suggestion

- **WHEN** the owner chooses one suggested category
- **THEN** the system SHALL atomically categorize the current transaction and save an exact future merchant rule so the same normalized merchant can complete without confirmation next time

#### Scenario: Owner searches an existing category

- **WHEN** the typed text matches an existing active editable category
- **THEN** the UI SHALL let the owner select that category without creating another category

#### Scenario: Typed category does not exist

- **WHEN** no existing category matches the normalized typed name
- **THEN** the UI SHALL show an explicit “创建新类别” confirmation and SHALL NOT create anything until the owner confirms

#### Scenario: New quick-entry category is confirmed

- **WHEN** the owner explicitly confirms a unique valid category name for an outflow purchase
- **THEN** the system SHALL create one editable expense category, apply it to the current transaction, and save the exact future merchant rule in one owner-visible flow

### Requirement: Safe category names

Owner category creation SHALL normalize surrounding/repeated whitespace for uniqueness, enforce a bounded display name, reject empty/control-character/markup-like unsafe input at the API boundary, and use optimistic conflict semantics when an equivalent active or inactive category already exists.

#### Scenario: Equivalent category already exists

- **WHEN** the owner attempts to create a category whose normalized name matches an existing category
- **THEN** the system SHALL return a stable conflict referencing the existing safe category read model and SHALL NOT create a duplicate

### Requirement: Installable protected app entry

The application SHALL expose a standards-based web app manifest and safe application icons with standalone display metadata and `/add` as the launch target. Installation or a home-screen shortcut MUST NOT weaken Cloudflare Access, cache authenticated financial API responses, or enable offline writes.

#### Scenario: Owner launches from the iPhone home screen

- **WHEN** the installed/home-screen app opens with a valid Access session
- **THEN** it SHALL land on `/add` and provide the same protected quick-entry flow as the browser

#### Scenario: Access session is absent or expired

- **WHEN** the home-screen app opens without a valid Access authorization cookie
- **THEN** Cloudflare Access SHALL require authentication before any application HTML, account label, category, or transaction data is returned

#### Scenario: Device is offline

- **WHEN** the owner opens the installed app without network access
- **THEN** it SHALL show the existing no-ledger-data offline state and SHALL NOT queue or cache a financial write
