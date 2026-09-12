## 1. Contracts and storage

- [x] 1.1 Add the installment metadata migration and update schema/query expectations.
- [x] 1.2 Extend domain create, preview, list/detail, and portability schemas with bounded installment fields.
- [x] 1.3 Add contract tests for valid and invalid installment requests and read models.

## 2. Atomic schedule creation

- [x] 2.1 Implement exact minor-unit allocation and original-day monthly date generation with edge-case tests.
- [x] 2.2 Extend manual transaction persistence to create one or 2–60 records atomically with consistent category/rule metadata.
- [x] 2.3 Update the worker endpoint and integration tests to return and validate complete installment schedules.

## 3. User interface

- [x] 3.1 Add the optional installment control and count validation to quick entry.
- [x] 3.2 Display installment position badges in transaction list and detail while preserving merchant text.
- [x] 3.3 Add browser tests for installment entry, validation, success feedback, responsive layout, and list/detail labels.

## 4. Portability and verification

- [x] 4.1 Preserve installment metadata in full JSON export and restore with round-trip tests.
- [x] 4.2 Run focused formatting, lint, type, unit, integration, browser, migration, and build verification.
