## REMOVED Requirements

### Requirement: Owner-confirmed category suggestions

**Reason**: Superseded by `quick-entry-merchant-confirmation`, which returns one suggestion from the pre-write merchant preview. The post-write suggestion resource had no remaining caller.

**Migration**: None. The owner still sees a suggested category and the complete active category list, now before the transaction is written instead of after. `GET /transactions/{id}/category-suggestions` is removed; the preview resource already carries the suggestion.
