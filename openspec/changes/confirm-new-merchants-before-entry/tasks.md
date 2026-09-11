## 1. Contracts and merchant recognition

- [x] 1.1 Add failing domain tests for IKEA, ordinary Amazon, Amazon Prime, and near-miss names, then implement deterministic manual-entry defaults.
- [x] 1.2 Add failing API contract tests, then define strict preview response variants and the additive confirmed-rule creation request.

## 2. Persistence and Worker behavior

- [x] 2.1 Add failing persistence tests, then implement non-writing merchant preview precedence and active-category validation.
- [x] 2.2 Add failing persistence tests, then implement atomic confirmed transaction plus exact merchant-rule creation.
- [x] 2.3 Add failing Worker integration tests, then expose the preview resource and confirmed creation behavior with existing error semantics.

## 3. Quick-entry interface

- [x] 3.1 Replace post-write unknown-merchant confirmation with pre-write preview state while preserving known-merchant fast entry and cancel form state.
- [x] 3.2 Replace type-first category selection with a direct complete category list, preserve search/create as a secondary path, and handle loading, retry, and keyboard focus.
- [x] 3.3 Add browser regression coverage for known, new, changed-category, cancel, retry, category-list, and responsive flows.

## 4. Verification

- [x] 4.1 Run focused domain, persistence, Worker, and browser tests; run formatting, lint, typecheck, and build checks; review the diff against the OpenSpec requirements.
