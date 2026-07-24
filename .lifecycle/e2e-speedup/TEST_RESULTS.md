# TEST_RESULTS — e2e-speedup

## BUILD-TIMING (ITEM-1 headline proof) — MEASURED on this worktree

`cargo build -p ziee` (no-op, back-to-back), Linux, per-worktree build DB:

| Phase | Build #1 | Build #2 (back-to-back) | `ziee` fingerprint |
|---|---|---|---|
| **BEFORE fix** | **1m 04s** (`Finished dev … in 1m 04s`) | **1m 02s** | `Dirty ziee … 'server/migrations-merged' has changed (…281ms after last build…)` → recompiled EVERY build |
| **AFTER fix** | **0.62s** (`Finished dev … in 0.62s`) | **0.65s** | `Fresh ziee v0.1.0` → loop gone, stays Fresh |

Transition build (picks up the fix, recompiles once): 1m 33s (also rebuilds the
sdk crates depending on build-support). The BEFORE `Dirty` reason is the exact
root cause: build.rs regenerated `migrations-merged` ~281ms AFTER cargo captured
the fingerprint. AFTER: two consecutive no-op builds both sub-second and `Fresh` —
proves the self-invalidation loop is eliminated. **62s → 0.6s, stable.**

## ITEM-1 unit tests (migration compose) — `cargo test -p ziee-build-support migrations::`

```
test result: ok. 7 passed; 0 failed; 0 ignored
```
- **TEST-1**: PASS — `recompose_over_unchanged_sources_preserves_file_mtimes` (file mtimes AND merged-DIR mtime unchanged across a no-op recompose — the load-bearing invariant).
- **TEST-2**: PASS — `stale_merged_migration_is_removed_by_name` (removed-source mirrored by delete-by-name).
- **TEST-3**: PASS — `recompose_rewrites_only_changed_content` (changed bytes written through; verbatim content) + `unions_globbed_module_migrations_and_ignores_non_sql` (byte-identical copy).

## TEST-4 golden parity (`openapi::emit_ts` types.ts) — content-neutrality of ITEM-1

- **TEST-4**: PASS — `openapi::…::types_ts_parity` (+ `_desktop`) green: the ITEM-1
  build change does not perturb the generated `types.ts` (content-neutral). See the
  cargo output line below.

## Frontend static gate (diff touches src-app/ui/** — tests only)

- `npm run check (ui): PASS` — tsc + biome guardrails + lint:colors/settings-field
  + check:kit-manifest/testid-registry/design-spec/gallery-coverage/state-matrix.
- `gate:ui (ui): PASS` — runtime-health boot + console-error + ErrorBoundary +
  Layer A/axe against the gallery (no UI surface added by this diff; canary green).

## ITEM-2/3/4 e2e (representative spec via the new harness path) — auth.spec.ts, workers=1

Two full runs of the SAME 15-test spec through the new harness, on the real stack
(docker Postgres + prebuilt binary + real UI, no page.route mocking):

| Run | Path exercised | Result | Wall-clock |
|---|---|---|---|
| **run-1** | prebuilt-binary spawn + exit-teardown; template on graceful FALLBACK (config bug, since fixed) | **15 passed** | **3.5m** |
| **run-2** | prebuilt-binary spawn + exit-teardown + **template clone** (fixed) | **15 passed** | **1.9m** |

run-2 log shows `Template DB ready: ziee_test_template_<runId>` then **15×**
`Created database ziee_test_<hex> from template …` — one unique per-test DB cloned
from the migrated template (isolation preserved), no per-boot migration run.

- **TEST-5** (ITEM-2): PASS — every per-test backend logged
  `Spawning prebuilt binary: …/target/debug/ziee` (NOT `cargo run`); no per-test
  compile.
- **TEST-6** (ITEM-3): PASS — all 15 tests ran back-to-back through the
  `terminateChild` teardown + `consecutive:3` readiness gate with the port REUSED
  across every test (`Backend server ready on port 9100` each time) — no port leak,
  no "Backend server failed to start".
- **TEST-7** (ITEM-4a): PASS — 15/15 per-test DBs created `from template`
  (unique names); the ~3.5m→1.9m suite wall-clock drop is the per-boot migration
  skip; app fully functional (setup + login + register succeed against the clone).
- **TEST-8** (ITEM-4b): PASS — backends booted with `update_check.enabled=false`
  (no `api.github.com` poll); 15/15 specs green with the update-check disabled.

Note: the transient `[Browser Console] Failed to fetch` lines during initial page
load are PRE-EXISTING cold-load races (the SPA fires before the vite proxy settles);
every spec still passes. Not introduced by this diff.
