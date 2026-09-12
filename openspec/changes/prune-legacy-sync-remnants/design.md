## Decisions

- Scope is deletion only. No behavior that the owner can reach today changes, apart from the export format and the removed suggestion resource.
- The legacy tables stay in D1. Their migration files are historical and are not rewritten, and no `DROP TABLE` migration is introduced, because that would be a destructive remote data operation requiring separate authorization.
- The export format drops the legacy record sets outright rather than keeping them optional. An optional field would preserve exactly the maintenance burden this change removes.
- Accepting a pre-change backup is given up deliberately. The owner confirmed this trade-off; the last pre-change exports remain on disk under `backups/2026-09-10-new-merchant-release/` and `.wrangler/`, so the 14 legacy transfer-match rows stay recoverable by hand if they are ever needed.
- The restore reconciliation evidence and the report reconciliation query drop their transfer-match exclusion clause. Transfers are already excluded from income and spending by `TRANSFER` category kind, so the two definitions converge instead of diverging.
- Suggestion removal completes `confirm-new-merchants-before-entry`. The pre-write preview already returns the single suggestion the interface uses, so no replacement resource is needed.
- Exports that are only consumed inside their own module lose the `export` keyword rather than being moved, to keep the diff a deletion rather than a reorganization.
