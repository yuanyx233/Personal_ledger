## ADDED Requirements

### Requirement: Quick entry previews before writing
The system SHALL validate and preview a submitted quick entry before creating a transaction. Previewing MUST NOT create or modify a transaction, merchant rule, category, or audit record.

#### Scenario: Known merchant is submitted
- **WHEN** the normalized merchant matches an active exact owner rule
- **THEN** preview SHALL report the merchant as known and the UI SHALL record the transaction immediately without showing merchant confirmation

#### Scenario: New merchant is submitted
- **WHEN** the normalized merchant does not match an active exact owner rule
- **THEN** preview SHALL report the merchant as new, SHALL return one active category suggestion, and the UI SHALL show confirmation before any transaction is written

#### Scenario: Owner cancels a new merchant
- **WHEN** the owner cancels the new-merchant confirmation
- **THEN** the system SHALL create no transaction or merchant rule and SHALL preserve the entered form values

### Requirement: Merchant-specific deterministic suggestion
For a new merchant, the system SHALL derive one suggestion using deterministic built-in merchant recognition, exact owner history, or stable popularity fallback in that order. A suggestion MUST remain advisory until the owner confirms it.

#### Scenario: IKEA is entered
- **WHEN** the owner submits an ordinary IKEA merchant name without an exact owner rule
- **THEN** the system SHALL suggest the active Shopping category and SHALL require confirmation

#### Scenario: Amazon shopping is entered
- **WHEN** the owner submits ordinary Amazon shopping without an exact owner rule
- **THEN** the system SHALL suggest the active Shopping category and SHALL require confirmation

#### Scenario: Amazon Prime is entered
- **WHEN** the owner submits Amazon Prime without an exact owner rule
- **THEN** the system SHALL preserve the distinct Prime merchant recognition and suggest the active Bills category

#### Scenario: Similar merchant is entered
- **WHEN** a merchant name merely contains a recognizable word without matching an anchored supported pattern
- **THEN** the system MUST NOT apply that built-in merchant mapping

### Requirement: Complete direct category selection
New-merchant confirmation SHALL display the suggested category and a directly operable list of all active editable expense categories. The owner SHALL be able to accept the suggestion, choose another listed category without typing its name, or use the existing search and category-creation path.

#### Scenario: Owner opens the category list
- **WHEN** the new-merchant confirmation is visible
- **THEN** every active editable expense category SHALL be available in the category selector and inactive, income, transfer, or protected unclassified categories SHALL NOT be selectable

#### Scenario: Owner replaces the suggestion
- **WHEN** the owner chooses another listed category and confirms
- **THEN** the selected category rather than the original suggestion SHALL be used for the transaction and future exact merchant rule

### Requirement: Confirmed creation is atomic
Confirming a new merchant SHALL atomically create one posted manual transaction with the selected category and save one active exact merchant rule for future entries. The created transaction SHALL report categorization source `RULE` and SHALL NOT enter the unclassified review queue.

#### Scenario: Confirmation succeeds
- **WHEN** the owner confirms a valid selected category
- **THEN** the transaction and exact merchant rule SHALL both be committed and subsequent matching quick entries SHALL not require confirmation

#### Scenario: Confirmation fails
- **WHEN** either the transaction or merchant-rule write cannot complete
- **THEN** neither write SHALL be committed and the UI SHALL retain the confirmation state for retry

### Requirement: Confirmation remains usable across supported layouts
The preview, direct category selector, confirm action, and cancel action SHALL be keyboard accessible and SHALL remain usable without horizontal overflow at supported mobile and desktop widths.

#### Scenario: Narrow and wide layouts
- **WHEN** the confirmation is viewed at 320, 768, 1024, or 1440 CSS pixels
- **THEN** the category selector and both actions SHALL remain visible and the page SHALL not overflow horizontally
