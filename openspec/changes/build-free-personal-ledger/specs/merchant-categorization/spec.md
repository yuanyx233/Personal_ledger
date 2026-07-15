## ADDED Requirements

### Requirement: Deterministic category precedence

The system SHALL resolve a transaction category in this order: transaction-level manual override, active owner merchant rule, mapped Plaid Personal Finance Category, then `Unclassified`.

#### Scenario: Manual override and rule both exist

- **WHEN** a transaction has a manual category override and its merchant matches an active rule
- **THEN** the manual override SHALL remain effective

#### Scenario: Rule and Plaid category both exist

- **WHEN** a transaction without a manual override matches an active owner rule and has a Plaid category
- **THEN** the owner rule SHALL determine the effective category

#### Scenario: No trusted category is available

- **WHEN** no manual override, merchant rule, or mapped Plaid category exists
- **THEN** the transaction SHALL be `Unclassified` and SHALL enter the review queue

### Requirement: Limited automatic classification of new merchants

For a new merchant, the system SHALL use only a mapped Plaid category or an exact deterministic merchant rule; it MUST NOT use paid AI, fuzzy similarity, arbitrary regex, or broad substring matching in the first release.

#### Scenario: New merchant includes a mapped Plaid category

- **WHEN** the first transaction for a merchant arrives with a supported Plaid category
- **THEN** the system SHALL apply that category with source `PLAID` and display it as automatic

#### Scenario: New merchant has no mapped Plaid category

- **WHEN** no exact rule or supported Plaid category is available
- **THEN** the system SHALL leave the transaction unclassified for owner review instead of guessing

### Requirement: Transparent classification provenance

Every effective category SHALL expose one of `MANUAL`, `RULE`, `PLAID`, or `UNCLASSIFIED`, and the transaction detail SHALL identify the matched rule or Plaid mapping where applicable.

#### Scenario: Rule-classified transaction is viewed

- **WHEN** the owner opens a transaction categorized by a merchant rule
- **THEN** the UI SHALL show the rule source, normalized merchant key, category, and rule identifier/name

#### Scenario: Automatically categorized merchants are reviewed

- **WHEN** the owner filters or groups by automatic source
- **THEN** the UI SHALL show which merchants and transactions were categorized by rules versus Plaid

### Requirement: Safe merchant normalization and rule matching

Merchant normalization SHALL be deterministic and rules SHALL use an exact normalized merchant key in the first release; a rule change MUST be previewable and versioned.

#### Scenario: Merchant varies only by case or repeated whitespace

- **WHEN** two merchant strings normalize to the same exact key
- **THEN** the same active exact-match rule SHALL apply to both

#### Scenario: Merchant names are merely similar

- **WHEN** two normalized keys are not exactly equal
- **THEN** a rule for one SHALL NOT automatically classify the other

### Requirement: Two explicit correction scopes

The owner SHALL be able to choose between correcting only the current transaction and saving a future exact merchant rule; saving a future rule SHALL correct the current transaction but SHALL NOT silently recategorize historical transactions.

#### Scenario: Owner corrects one transaction only

- **WHEN** the owner chooses “只改这一笔” and selects a category
- **THEN** the system SHALL create a transaction-level manual override and SHALL NOT create or modify a merchant rule

#### Scenario: Owner saves a future merchant rule

- **WHEN** the owner chooses “以后这个商户都这样”
- **THEN** the system SHALL save/update an exact rule, apply it to the current transaction, and use it for later matching transactions

#### Scenario: Existing historical matches exist

- **WHEN** a new future rule is saved and older matching transactions already exist
- **THEN** those older transactions SHALL remain unchanged unless the owner explicitly reviews and changes them

### Requirement: Append-only categorization audit

Every effective-category change SHALL append an audit record containing transaction, old/new category, old/new source, applicable rule, reason, and timestamp.

#### Scenario: Automatic category is manually corrected

- **WHEN** the owner changes a Plaid- or rule-assigned category
- **THEN** the previous and new values SHALL remain visible in the transaction's audit history

### Requirement: Unified review queue

The system SHALL place unclassified new merchants, uncertain e-Transfers, ambiguous internal transfers, and classification-rule conflicts into a single filterable review queue.

#### Scenario: Owner clears the last review item

- **WHEN** the final unresolved item receives a valid category/transfer decision
- **THEN** the queue count SHALL become zero and the item SHALL remain discoverable through normal transaction history

#### Scenario: Bulk destructive correction is attempted

- **WHEN** an action would change multiple existing transactions
- **THEN** the first release SHALL require an explicit preview and confirmation or SHALL refuse the action; it SHALL NOT silently batch overwrite history
