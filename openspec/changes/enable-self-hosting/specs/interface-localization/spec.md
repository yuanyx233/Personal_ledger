## ADDED Requirements

### Requirement: Bilingual interface
The web interface SHALL render every user-facing string from a language catalogue in either Simplified Chinese or English. No user-facing literal may remain hardcoded in component source. Both catalogues MUST cover the same set of keys.

#### Scenario: English interface
- **WHEN** the interface language is English
- **THEN** navigation, forms, tables, empty states, confirmations, validation messages, and error messages all render in English, with no residual Chinese text.

#### Scenario: Chinese interface unchanged
- **WHEN** the interface language is Simplified Chinese
- **THEN** the wording matches the current interface, including the established terms for reimbursement offset, installments, subscription cancellation, and budget limits.

#### Scenario: Catalogue completeness is enforced
- **WHEN** a key exists in one catalogue but not the other
- **THEN** the build or test suite fails, rather than shipping a partially translated interface.

### Requirement: Language selection and persistence
The interface SHALL choose an initial language from the viewer's browser preferences, allow switching it explicitly, and remember the explicit choice across visits on that device. Language choice MUST NOT alter stored ledger data.

#### Scenario: First visit
- **WHEN** a viewer with English browser preferences opens the application for the first time
- **THEN** the interface starts in English without requiring any action.

#### Scenario: Explicit choice wins
- **WHEN** the viewer switches language and returns later
- **THEN** the chosen language is restored, overriding browser preferences.

#### Scenario: Data is language-independent
- **WHEN** the viewer switches language
- **THEN** amounts, dates, categories, and transactions are the same records as before, and no write is issued.

### Requirement: Locale-aware number and date presentation
Amount and date formatting SHALL follow the active interface language rather than a fixed locale, while the underlying values, the configured ledger timezone, and currency separation remain unchanged.

#### Scenario: Formatting follows language
- **WHEN** the same amount and date are displayed in each language
- **THEN** grouping, decimal separators, and date presentation follow that language's conventions, and both represent the identical stored value and calendar day.

### Requirement: Category names under localization
Only immutable system categories — those carrying a non-null `system_key` and marked non-editable — SHALL be presented in the active language by that key. Every editable category, whether seeded by the default taxonomy or created by the owner, MUST be presented exactly as stored, because the owner may rename it.

#### Scenario: Immutable system category
- **WHEN** the interface language changes and a transaction is categorised as `TRANSFER`
- **THEN** its displayed name follows the active language, while reports, filters, and exports continue to key on the same underlying category.

#### Scenario: Owner renames a seeded category
- **WHEN** the owner renames a seeded editable category and switches language
- **THEN** the owner's name is shown unchanged in both languages, and is never overwritten by a translation of its original seeded name.

#### Scenario: Owner-created category
- **WHEN** the owner creates a category and switches language
- **THEN** its name is shown exactly as the owner entered it, untranslated, in both languages.

### Requirement: Default taxonomy seeded in the installer's language
Because the default expense and income categories are editable, their names SHALL be chosen at install time rather than translated at runtime. The self-hosting guide MUST document how to seed them in the operator's preferred language, and the existing English names MUST remain the default.

#### Scenario: Existing instance
- **WHEN** an instance that already applied the default taxonomy upgrades
- **THEN** its category names and identifiers are unchanged, and no migration rewrites them.
