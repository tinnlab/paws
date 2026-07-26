# Phase-6 blind audit — how it was run

Six FRESH agents, diff-only context (`bg-inconv-audit.diff` = `git diff
origin/feat/agent-core...HEAD` with the mechanically-generated
`openapi.json` / `api-client/types.ts` and `.lifecycle/**` excluded), none of them
given this session's reasoning. 17 angles:

| agent | angles |
|---|---|
| 1 | correctness · concurrency · error-handling |
| 2 | security · perms/authz · api-contract |
| 3 | design-conformance · wired-and-behaving · plan-coverage (given DESIGN.md + the three INVs) |
| 4 | tests-quality · patterns-conformance · state-management |
| 5 | a11y · perf · i18n-copy · precedent-fidelity · responsive-fidelity (given DESIGN_SYSTEM.md) |
| 6 | modularity · extensibility · maintainability · api-friendliness |

Every hunk of the diff is covered by ≥3 distinct angles (see `AUDIT_COVERAGE.tsv`).
The audit found the feature functionally broken in two ways the phase-5 gates could
not see, plus a set of hollow tests — recorded in `LEDGER.jsonl` and worked in
`FIX_ROUND-1.md`.
