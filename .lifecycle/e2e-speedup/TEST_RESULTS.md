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

<!-- filled after the run below -->

## Frontend static gate (diff touches src-app/ui/**)

<!-- npm run check (ui): filled after the run -->

## ITEM-2/3/4 e2e (representative spec via the new harness path)

<!-- TEST-5..8 filled from the auth.spec.ts run + its log -->
