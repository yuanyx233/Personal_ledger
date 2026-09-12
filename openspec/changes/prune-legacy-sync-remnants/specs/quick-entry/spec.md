## REMOVED Requirements

### Requirement: Immediate category confirmation when needed

**Reason**: Superseded by `quick-entry-merchant-confirmation`. A new merchant is now confirmed before the first write, so there is no saved `Unclassified` transaction to confirm afterwards and no "稍后确认" deferral.

**Migration**: None. Known merchants still record immediately; new merchants are confirmed before any write, and cancelling creates nothing.

### Requirement: Bounded suggestions and searchable alternatives

**Reason**: Superseded by `quick-entry-merchant-confirmation`, which presents one suggestion plus the complete active expense-category list, with search and explicit creation retained as a secondary path.

**Migration**: None. Suggestions remain advisory and never silently classify an unknown merchant.
