## Why

Large purchases paid over several months currently require repeated manual entry, which is slow and error-prone. Quick entry should create the full installment schedule once while preserving exact totals and normal reporting behavior.

## What Changes

- Add an optional installment choice to quick entry with a validated range of 2–60 periods.
- Treat the entered amount as the total purchase amount and atomically create one posted manual transaction per monthly installment.
- Use the selected date for the first installment, retain its day in later months, and fall back to each month’s final day when necessary.
- Divide exact minor units evenly and add any remainder to the final installment.
- Preserve the original merchant/description and expose separate installment position metadata such as “第 1/12 期” in transaction lists and detail.
- Apply one category decision and merchant rule consistently to the complete installment group.

## Capabilities

### New Capabilities

- `transaction-installments`: Creating, storing, reading, and displaying grouped monthly installments from quick entry.

### Modified Capabilities

None. The new capability integrates with quick entry and the canonical ledger without changing their existing non-installment behavior.

## Impact

- Quick-entry form and merchant-confirmation flow.
- Manual transaction request/response contracts and server write endpoint.
- Canonical transaction schema, migration, persistence repository, and read models.
- Transaction list/detail presentation, reporting inputs, JSON export/restore, and automated tests.
