# DRIFT-1 — implementation vs plan

Reconciling the shipped code against PLAN.md / DECISIONS.md.

- **DRIFT-1.1** — verdict: none — ITEM-1 (`findAvailablePorts` bind-check)
  implemented exactly as planned, mirroring `allocatePostgresPort` and reusing
  the existing `isPortBindable`. Matches the reference implementation.
- **DRIFT-1.2** — verdict: none — ITEM-2 (`killProcessOnPort` fallback) landed in
  BOTH copies (`port-manager.ts` + `test-context.ts`) with the `lsof`→`fuser`→`ss`
  `command -v`-gated chain per DEC-2; win32 arm untouched.
- **DRIFT-1.3** — verdict: none — ITEM-3 (`cleanupStaleConfigFiles` live-lock
  guard) implemented via `collectLiveRunIds()` mirroring `global-setup.ts` per
  DEC-3; `extractConfigId()` maps run-scoped filenames to their runId.
- **DRIFT-1.4** — verdict: resolved — ITEM-4 export surface: planned to export
  `killProcessOnPort`; in implementation I ALSO exported `extractConfigId` +
  `collectLiveRunIds` (they are new helpers the guard needs and are harmless pure
  functions). This is a minor superset of the plan's "export as far as tests
  require", not a divergence in intent — the plan said "the helpers as needed".
  No plan amendment required.
- **DRIFT-1.5** — verdict: none — the concurrency test file landed at the planned
  path with TEST-1..4; all 4 PASS and the before→after collision proof is
  captured in TEST_RESULTS.md.

**Unresolved drifts:** 0
