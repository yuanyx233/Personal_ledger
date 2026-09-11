## Decisions

- Reuse the existing frontend, App Worker, and D1; remove the sync Worker and all scheduled handlers.
- New transactions enter only through CSV or manual entry. Keep merchant rules and explicit category overrides, including Transfer.
- Keep suspected duplicate confirmation in CSV preview; expose unclassified entries as a transaction filter.
- Preserve historical records, account names, transfer exclusions, and backup/restore compatibility. Historical migrations are not rewritten or remotely executed.
- Remove old feature code and tests; retain meaningful verification for imports, edits, rules, reports, authentication, and exports.
- No additional infrastructure or speculative abstraction. No commits.
- Following the owner's 2026-09-04 website-update authorization, deploy only the existing App Worker and assets with an explicitly empty cron list to remove old app schedules. Preserve the production D1 binding, authentication secrets, Access policy, and rollback version. Do not delete the independent remote Sync Worker or its secrets in this release.
