## ADDED Requirements

### Requirement: Deterministic category precedence

The system SHALL resolve a transaction category in this order: transaction-level manual override, active exact owner merchant rule, then source-specific automatic classification. CSV imports SHALL resolve a recognized merchant family using unambiguous active owner rules before built-in merchant defaults, then `Unclassified`. Historical Plaid records retain their mapped categories.

#### Scenario: Manual override and rule both exist

- **WHEN** a transaction has a manual category override and its merchant matches an active rule
- **THEN** the manual override SHALL remain effective

#### Scenario: Rule and Plaid category both exist

- **WHEN** a transaction without a manual override matches an active owner rule and has a Plaid category
- **THEN** the owner rule SHALL determine the effective category

#### Scenario: No trusted category is available

- **WHEN** no manual override, applicable merchant rule, built-in CSV classification, or mapped Plaid category exists
- **THEN** the transaction SHALL be `Unclassified` and SHALL enter the review queue

### Requirement: Automatic classification during CSV import

Every CSV commit SHALL classify new transactions before returning success, without requiring a separate correction request or an assistant. Classification SHALL use bounded, deterministic merchant families and built-in defaults for recognized merchants. It SHALL preserve the original amount, direction, description, normalized exact key, and duplicate fingerprint. Unknown merchants SHALL remain reviewable. No external AI service or paid dependency is required.

#### Scenario: Recognized merchant has no exact owner rule

- **WHEN** an imported Amazon order, supermarket branch, subscription, or other recognized merchant has no exact rule
- **THEN** commit SHALL apply an unambiguous active owner rule from that merchant family, or its built-in category when no family rule exists, with source `RULE`
- **AND** inactive categories SHALL NOT be assigned and built-in classifications SHALL be labeled separately from owner rules

#### Scenario: Owner rules disagree within a family

- **WHEN** active rules for the same recognized family specify different categories
- **THEN** an exact match SHALL retain priority and a new unmatched family member SHALL remain unclassified rather than selecting an arbitrary rule or default

#### Scenario: Refund or credit-card repayment is imported

- **WHEN** a known merchant refund is imported
- **THEN** it SHALL retain `INFLOW` and use that merchant's expense category to reduce net spending
- **WHEN** a recognized credit-card repayment is imported as `INFLOW` on a credit account
- **THEN** the built-in category SHALL be `Transfer`, without inventing a transfer match or treating it as income

#### Scenario: Repeated import or existing manual transaction

- **WHEN** an import is replayed or merged into an existing manually categorized transaction
- **THEN** classification SHALL NOT create duplicates or overwrite existing transaction categories

### Requirement: Owner-confirmed category suggestions

For an unclassified quick transaction, the system SHALL return at most two active editable category suggestions derived from deterministic owner history or a stable fallback ordering, together with enough provenance to label them as suggestions rather than automatic results.

#### Scenario: Suggested category is displayed

- **WHEN** an unknown merchant has one or more eligible suggestions
- **THEN** the UI SHALL show no more than two suggestion buttons plus an “other category” path and SHALL NOT imply that a suggestion has already been applied

#### Scenario: Owner confirms a suggestion

- **WHEN** the owner selects a suggested or searched existing category
- **THEN** the current transaction SHALL be corrected and an exact future merchant rule SHALL be saved using the existing audited rule path

### Requirement: Explicit editable category creation

The owner SHALL be able to create a uniquely named editable category only after an explicit confirmation. Quick outflow creation SHALL create an `EXPENSE` category; an owner-managed taxonomy MAY also contain editable custom `TRANSFER` categories for explicit transaction-level classification. System categories SHALL remain protected and category names SHALL be normalized for uniqueness.

#### Scenario: Owner confirms a new category

- **WHEN** a quick-entry outflow has no desired existing category and the owner confirms a valid new name
- **THEN** the system SHALL create one active editable expense category and make it available to the current correction without exposing a partially created state

#### Scenario: Equivalent category exists

- **WHEN** normalized category-name uniqueness conflicts with any existing active or inactive category
- **THEN** the API SHALL return a stable conflict and SHALL NOT create a second category

#### Scenario: Owner groups historical e-Transfers without guessing purpose

- **WHEN** the owner explicitly assigns otherwise unresolved historical e-Transfers to an editable custom transfer category
- **THEN** the system SHALL preserve each transaction's direction, classify only those selected historical transactions, exclude them from income and spending totals, and SHALL NOT create a future merchant rule

### Requirement: Transparent classification provenance

Every effective category SHALL expose one of `MANUAL`, `RULE`, `PLAID`, or `UNCLASSIFIED`, and the transaction detail SHALL identify the matched rule or Plaid mapping where applicable.

#### Scenario: Rule-classified transaction is viewed

- **WHEN** the owner opens a transaction categorized by a merchant rule
- **THEN** the UI SHALL show the rule source, normalized merchant key, category, and rule identifier/name

#### Scenario: Automatically categorized merchants are reviewed

- **WHEN** the owner filters or groups by automatic source
- **THEN** the UI SHALL show which merchants and transactions were categorized by rules versus Plaid

### Requirement: Safe merchant normalization and rule matching

Merchant normalization SHALL remain deterministic and owner rules SHALL retain their exact normalized keys; a rule change MUST be previewable and versioned. CSV classification MAY additionally recognize explicitly supported merchant families without changing exact keys or duplicate matching.

#### Scenario: Merchant varies only by case or repeated whitespace

- **WHEN** two merchant strings normalize to the same exact key
- **THEN** the same active exact-match rule SHALL apply to both

#### Scenario: Merchant names are merely similar

- **WHEN** two normalized keys are not exactly equal
- **THEN** a rule for one SHALL NOT automatically classify the other unless both belong to the same explicitly supported CSV merchant family and all active rules in that family agree

### Requirement: Two explicit correction scopes

The owner SHALL be able to choose between correcting only the current transaction and saving a future exact merchant rule; saving a future rule SHALL correct the current transaction but SHALL NOT silently recategorize historical transactions.

#### Scenario: Owner corrects one transaction only

- **WHEN** the owner chooses “只改这一笔” and selects a category
- **THEN** the system SHALL create a transaction-level manual override and SHALL NOT create or modify a merchant rule

#### Scenario: Owner saves a future merchant rule

- **WHEN** the owner chooses “以后这个商户都这样”
- **THEN** the system SHALL save/update an exact rule, apply it to the current transaction, and use it for later matching transactions, including recognized CSV family variants when family rules agree

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

#### Scenario: Unclassified item is shown for review

- **WHEN** an unclassified transaction appears in the review queue
- **THEN** its card SHALL display the transaction's posted date without inventing a time of day

#### Scenario: Owner clears the last review item

- **WHEN** the final unresolved item receives a valid category/transfer decision
- **THEN** the queue count SHALL become zero and the item SHALL remain discoverable through normal transaction history

#### Scenario: Bulk destructive correction is attempted

- **WHEN** an action would change multiple existing transactions
- **THEN** the first release SHALL require an explicit preview and confirmation or SHALL refuse the action; it SHALL NOT silently batch overwrite history
