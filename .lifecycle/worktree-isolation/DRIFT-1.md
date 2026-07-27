# DRIFT-1 — implementation vs plan

Reconciliation of divergences found after implementing all non-descoped items.
All are `impl-wins` (the implementation is BETTER than the plan's literal file
map) and each is reconciled by amending PLAN.md's *Files to touch* — no
behavioral scope changed, so no re-gate of phases 1–3 semantics is needed (the
ITEM set and TEST mapping are unchanged).

- **DRIFT-1.1** — verdict: impl-wins — ITEM-9 extracted ONE shared
  `src-app/server/src/common/embedded.rs::extract_atomic` (temp+rename+flock,
  is_intact fast-path) consumed by all three sites (`file/utils`, `bio_mcp`,
  `mcp/utils`) instead of duplicating the atomic logic per file. DRY + one place
  to test (the 4-test suite incl. the 8-thread concurrency test lives there).
  PLAN.md amended. Reconciled.

- **DRIFT-1.2** — verdict: impl-wins — ITEM-8 landed in
  `src-app/ui/tests/fixtures/test-context.ts` (not `tests/common/…` as the plan
  guessed) and the path/default logic was extracted into a testable
  `tests/fixtures/e2e-data-dir.mjs` (so TEST-8/TEST-12 unit-test pure helpers
  rather than the whole harness). PLAN.md amended. Reconciled.

- **DRIFT-1.3** — verdict: impl-wins — ITEM-10/11 reused the pre-existing
  `src-app/desktop/ui/tests/fixtures/isolation-keys.mjs` helper (created by an
  earlier e2e-isolation feature), refining it to derive the desktop bases
  (9600/54600 off the web 9100/54331 overlap) + key-derived lock dir from the new
  `run-key.mjs`, rather than hand-rolling a parallel helper. Affordance reuse.
  PLAN.md amended. Reconciled.

- **DRIFT-1.4** — verdict: impl-wins — the proof harness setup copies the base
  repo's populated `sdk`/`agent-kit` submodule working trees (rsync, excluding
  `target/`/`node_modules/`) instead of `git submodule update --init`, because
  the feature's `sdk` submodule commit is LOCAL-ONLY (not pushed to the sdk
  remote) so a remote fetch fails. Harness-only; makes throwaway worktrees able
  to `npm install`-link `@ziee/*`. Reconciled.

- **DRIFT-1.5** — verdict: impl-wins — the ITEM-9 fork's files were swept into
  the ITEM-13 commit (concurrent same-tree edits) and never compile-verified
  before the session-limit crash; on resume they were verified: `cargo check -p
  ziee --tests` exit 0 and `common::embedded` 4/4 tests PASS. No code change
  needed — verification gap closed. Reconciled.

**Unresolved drifts:** 0
