## Context

The quick-entry client currently creates a manual transaction first. Only when the response reports `UNCLASSIFIED` does the client load two category suggestions and ask the owner to create an exact merchant rule. The suggestions are transaction-backed and fall back to the two most-used expense categories, which is why a new IKEA or Amazon entry can display unrelated choices such as Dining or Bills.

Manual transaction creation already performs exact active merchant-rule matching. Separately, CSV import has a deterministic built-in merchant-family classifier. The new flow must reuse those deterministic sources, preserve the existing fast path for known merchants, and move owner confirmation ahead of every write for a new merchant.

## Goals / Non-Goals

**Goals:**

- Validate and preview a submitted quick entry without writing a transaction.
- Distinguish an active exact owner rule from a new merchant and return one explainable category suggestion.
- Let the owner directly choose from the complete active editable category list before confirming.
- Create the confirmed transaction and exact future merchant rule atomically.
- Recognize ordinary IKEA and Amazon shopping names deterministically.
- Preserve the current category-creation escape hatch and responsive, keyboard-accessible quick-entry experience.

**Non-Goals:**

- Merchant autocomplete or a merchant-list picker in the entry form.
- Probabilistic or external-AI classification.
- Product-level splitting of marketplace transactions.
- Historical transaction recategorization.

## Decisions

### Add a non-writing transaction preview resource

Add `POST /api/v1/transaction-previews` with the same validated financial fields as manual transaction creation. Its response is a discriminated union:

- `KNOWN_MERCHANT`, containing the matched active category; or
- `NEW_MERCHANT`, containing one suggested active category.

The description remains in a request body rather than a URL, and the endpoint returns no speculative transaction identifier. An additive resource avoids changing existing `POST /transactions` behavior for other clients.

Alternative considered: load all merchant rules into the browser and match locally. This was rejected because it duplicates normalization logic, requires pagination, and exposes more owner data than the screen needs.

### Use deterministic suggestion precedence

Preview resolves in this order: active exact owner rule, built-in merchant-family default, exact manually categorized history, then the most-used active editable expense category. Only the first case is `KNOWN_MERCHANT`; every other case requires owner confirmation. IKEA and ordinary Amazon map to Shopping, while Amazon Prime remains Bills.

Alternative considered: keep two popularity suggestions. This was rejected because popularity is not evidence that either category fits the merchant and caused the reported misleading UI.

### Extend transaction creation with an explicit rule-save intent

Add an optional `rememberMerchant: true` field to the existing manual-transaction create contract. It is valid only with an explicit `categoryId`. The repository uses one D1 batch transaction to upsert the exact merchant rule and insert the posted transaction already categorized with that rule. Existing requests without the flag retain current behavior.

The confirmed category is authoritative if the rule changes between preview and confirmation. This is acceptable for the single-owner application and ensures the owner’s explicit final choice wins.

Alternative considered: create the transaction and then call the existing rule-correction route. This was rejected because the first write could succeed while the rule write fails, recreating the partial state the new flow is intended to remove.

### Use a direct category select in the confirmation surface

The new-merchant confirmation replaces the post-save confirmation state. It displays the merchant, suggested category, a native category select populated with all active editable categories, and explicit confirm/cancel actions. Native selection provides a complete list, keyboard support, and a compact mobile picker. The existing search/create control remains available as a secondary path when no listed category fits.

Cancel returns to the unchanged form. Confirmation failure keeps the preview and selection on screen for retry.

## Risks / Trade-offs

- [Built-in mappings can be too broad] → Keep anchored, ordered merchant-family patterns and cover near-miss names in domain tests.
- [Preview can become stale before confirmation] → Treat the owner’s confirmed category as authoritative and perform rule plus transaction writes atomically.
- [The extra preview request adds latency] → Skip taxonomy loading and confirmation entirely for known merchants; load categories only for `NEW_MERCHANT`.
- [Category creation remains a separate preliminary write] → Preserve the existing explicit creation confirmation and only treat the newly created category as selected; transaction and merchant-rule creation still occur together on final confirmation.
- [Existing clients rely on current transaction creation] → Make the new request field optional and keep existing response fields and semantics.

## Migration Plan

No database migration is required. Deploy the additive contracts, preview route, and extended repository behavior together with the updated client. Rollback is the reverse application deployment; existing transaction and merchant-rule rows remain compatible.

## Open Questions

None.
