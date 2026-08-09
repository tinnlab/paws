# FIX_ROUND-1

Angles: `correctness` + `tests-quality` (core roster), plus `concurrency-resource`
as the conditional angle (the change concerns async load ordering and a
hook-count race).

Findings promoted to WORK: 1 — the ledger's `corroborated_by: 2`,
`oracle_confirmed: true` row (import cost inside the per-test budget). Fixed by
moving the module-graph warm-up into `beforeAll` with an explicit budget.

Findings NOT promoted, each with its disposition recorded in LEDGER.jsonl rather
than dismissed silently:
- FB-11 (`mount.tsx:58`) — `rejected-as-cause`, DEC-2.
- `createStoreProxy` path selection — `not-reproduced` over 40 probe runs.
- `app-store-seams.ts` — `verified-clean`.

Re-audit scope: this round's diff is one spec file. Re-ran the whole component
suite (9 files / 118 tests) and `tsc --noEmit`: both green.

**New confirmed findings:** 0
