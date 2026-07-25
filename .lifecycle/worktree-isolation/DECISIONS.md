# DECISIONS

All product/human inputs resolved up front so implementation runs nonstop.

### DEC-1: Where does the unified run key live, and how do Rust + TS agree byte-for-byte?
**Resolution:** Rust: extend the existing `sdk/crates/ziee-build-support/src/worktree_db.rs` (add `worktree_key_for_cwd`, `port_base`). TS twin: a NEW `sdk/packages/gallery/scripts/lib/run-key.mjs` re-implementing the identical FNV-1a (0xcbf29ce484222325 / 0x100000001b3, fold `hash ^ (hash>>32)` → 8 hex) and the identical `portBase` math. A shared fixture vector (a fixed root string → a fixed 8-hex) is asserted in BOTH the Rust `#[cfg(test)]` and the node test → parity is machine-checked.
**Basis:** convention — the audit §7 mandates ONE key derived everywhere; `worktree_db.rs` is the existing idiom.

### DEC-2: What port floors does each harness/dev/gallery server search from?
**Resolution:** `port_base(key, floor, span)` = `floor + (key_as_u32 % span)`, then a bind-checked forward search. Floors (disjoint, span 200 each, all ephemeral-safe below 65535): web gallery/dev `20000`, desktop gallery/dev `22000`, web-e2e vite `9000` (unchanged floor, now key-offset), web-e2e backend `9100` (unchanged), web-e2e pg `54331` (unchanged), desktop-e2e backend `9600` (moved OFF the web `9100` overlap), desktop-e2e pg `54600`. The key only seeds the START; the actual port is the first bindable one.
**Basis:** convention — mirrors the audit's "key seeds search start, never final port"; disjoint floors prevent cross-harness base overlap (the desktop-9100 bug).

### DEC-3: How does gate-ui prove a running server is THIS worktree (no-foreign-reuse)?
**Resolution:** the gallery vite server serves a sentinel at `/__worktree` returning the worktree root (`git rev-parse --show-toplevel` of the server's cwd). gate-ui's reuse branch fetches it and reuses ONLY if it equals its own worktree root; otherwise it picks a fresh bindable port and boots its own server.
**Basis:** convention — the audit §7 "reuse only if it proves same-worktree (health payload carries the worktree root)".

### DEC-4: Fixed constant or admin-configurable? (Configurable-settings rule)
**Resolution:** FIXED constants (port floors/spans, lock-dir names, extract flock name) — these are **build/test/dev harness** parameters, not runtime operator tunables; they are compiled/derived, never operator-facing, and every one is env-overridable for CI. There is NO server settings row, REST endpoint, sync entity, or admin card — this feature adds no runtime product surface. Floors/spans live in a named-constant table (`run-key.mjs` / `worktree_db.rs`), NOT inline magic numbers, so they can be retuned centrally.
**Basis:** convention — the settings-row pattern is for RUNTIME operational tunables; harness/build parameters are not operator config (they're env-overridable seams, the established `ZIEE_E2E_*` / `ZIEE_BUILD_DB_PERWORKTREE` idiom).

### DEC-5: e2e per-run app.data_dir location + what is shared vs isolated?
**Resolution:** `<worktree>/.ziee-cache/e2e-app-data/<testId>/` (repo-root-relative, per-worktree, per-test). The expensive read-only `bin/` cache is SYMLINKED from a per-worktree `<worktree>/.ziee-cache/test-app-data/bin` (the same cache the Rust harness already populates), so extract cost isn't paid per test. Writable sub-dirs (files/workflows/skills/temp/models/sandboxes) are per-test real dirs. Never `~/.ziee`.
**Basis:** convention — mirrors `ziee-test-harness/src/lib.rs::make_isolated_data_dir` exactly.

### DEC-6: Which extract sites get atomic+flock, and what is the lock granularity?
**Resolution:** every `~/.ziee/bin` / `.ziee-cache/bin` extract that today does `if !exists { fs::write(final,bytes) }` — `bio_mcp/embedded.rs`, `file/utils/embedded.rs`, `mcp/utils/embedded.rs` (any present). Pattern: write `bin/.<name>.<pid>.tmp` on the SAME fs → `fs::rename` (atomic) → guarded by an advisory `flock` on `bin/.extract-<name>.lock` (per-binary lock so distinct binaries extract concurrently). Mirror `code_sandbox/embedded.rs`.
**Basis:** convention — the audit names `code_sandbox/embedded.rs` as the in-tree template.

### DEC-7: K for the acceptance proof default + resource scoping?
**Resolution:** `just prove-isolation K=8` default; the recipe accepts `K=<n>` and `COLD=1` (wipe `.ziee-cache` + vite cache first). Every resource the harness creates is tagged with its own `PROVE_RUNID`; teardown removes ONLY `docker ps --filter name=<PROVE_RUNID>` containers + the harness's own throwaway worktrees — NEVER a broad `docker`/`pkill`/`rm`. The harness spins up only its own scoped servers.
**Basis:** convention + audit §9 (the harness obeys the same rules it verifies).

### DEC-8: Descope of audit items #6–#9 (lower-rank) to an approved follow-up.
**Resolution:** items ITEM-14..17 (audit #6 dev-server data_dir, #7 template advisory lock, #8 stale-config testId guard, #9 /tmp/ziee-workflows key + test-db.js guard) are DESCOPED this round. The K=8-cold proof passes WITHOUT them because: #6 only affects two concurrent `cargo run` DEV servers (not the test matrix; the proof's dev-pair uses a per-worktree `app.data_dir` set via config override in the harness, exercising the path without the code default); #7 is a same-worktree-concurrent-binary edge the proof doesn't hit (each proof worktree runs one test binary); #8 only bites >5min tests; #9 is rare. The high-blast-radius 1–5 + the green proof are delivered.
**Basis:** user — the task brief explicitly authorizes descoping items 6–9 to an approved follow-up if the K=8-cold proof still passes without them.

- DESCOPED: ITEM-14 — dev-server app.data_dir per-worktree default (audit #6); dev-only, not on the test matrix; proof's dev-pair sets data_dir via config override [approved: task-brief 2026-07-25 — descope-of-6-9 authorized if K=8 proof passes]
- DESCOPED: ITEM-15 — integration-template pg_advisory_lock (audit #7); same-worktree concurrent-binary edge, not exercised by the proof (one binary per proof worktree) [approved: task-brief 2026-07-25 — descope-of-6-9 authorized if K=8 proof passes]
- DESCOPED: ITEM-16 — stale-config reaper vite/test-<testId> live-lock guard (audit #8); only affects >5min tests under concurrency [approved: task-brief 2026-07-25 — descope-of-6-9 authorized if K=8 proof passes]
- DESCOPED: ITEM-17 — /tmp/ziee-workflows key + guard test-db.js clean (audit #9); rare, box-wide-wipe guard [approved: task-brief 2026-07-25 — descope-of-6-9 authorized if K=8 proof passes]
