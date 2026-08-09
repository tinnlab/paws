# DRIFT-1 — implementation vs plan

- **DRIFT-1.1** — verdict: resolved — PLAN's *Files to touch* said "sdk submodule:
  none expected (see DRIFT if that changes)". Confirmed by implementation: the sdk
  scripts were ALREADY fully config-driven, so **zero sdk changes were required**.
  `git -C sdk status --short` is empty and the pin is unmoved at
  `0ba6253855742813bb43e7e0466131496c8ed97a`. The brief anticipated sdk commits;
  the measurement says none are needed, which is the stronger outcome (the shared
  package did not have to grow a key for a second consumer).
- **DRIFT-1.2** — verdict: plan-wins — the phase-3 gate refused the plan because a
  frontend workspace is touched with no `tier: e2e` test. Rather than argue the
  paths are tooling-only, TESTS.md was amended to add **TEST-9**, a real e2e that
  boots the desktop gallery and drives the shared enumeration in a browser. The
  gate was right that the invariant deserved a runtime proof: TEST-4 exercises the
  module against a stub, TEST-9 exercises it against the actual product. Mutation
  MUT-F (swapping in the stale lib) reds TEST-9, so it is not ceremony.
- **DRIFT-1.3** — verdict: impl-wins — PLAN ITEM-7 named two follow-ups to record;
  implementation found a **third** worth recording (`affordance-audit.mjs` /
  `gen-crop-review-manifests.mjs` are still per-workspace forks differing only in
  the dev-server port source, one of which is the hardcoded `1420` collision trap)
  and a **fourth** in milder form (the shared capture scripts default `--url=` to a
  hardcoded `localhost:1466`). Both are written into CLAUDE.md as 1c. PLAN amended
  in spirit; no item re-scoped, only the recorded set widened.
- **DRIFT-1.4** — verdict: resolved — PLAN ITEM-2 was verdict CONCERN pending proof
  that the registry stays byte-identical. Proven: all 12 generated artifacts across
  BOTH workspaces are byte-identical to the pre-change snapshot, and MUT-C (drop
  the config key) reds three tests plus desktop's own `check:overlay-registry`,
  so the key is demonstrably load-bearing rather than decorative.
- **DRIFT-1.5** — verdict: none — ITEM-4's risk (that `@ziee/gallery/scripts/*`
  might not resolve from a workspace) did not materialise; `createRequire(...).resolve`
  from all four consumer scripts lands on the one sdk module (TEST-7).

**Unresolved drifts:** 0
