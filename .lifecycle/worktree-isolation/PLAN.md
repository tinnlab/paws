# PLAN — Concurrent-Worktree Resource Isolation

Source of truth: `/data/pbya/ziee/tmp/isolation-audit-wt/ISOLATION_AUDIT.md`
(branch `audit/isolation-map`). This plan implements the audit's prioritized list
(§8) via the audit's unified run-key design (§7). Goal: N concurrent worktree
test/dev runs coexist on one box with ZERO shared-mutable-state conflict. Fixed
port anywhere = defect; the key only seeds a bind-checked search start.

This is NOT a UI feature — it adds no page/drawer/card/panel/component/render
state. It touches build/test/dev **infrastructure** (Rust build-support, Node
harness scripts, vite/playwright configs, embedded-binary extract). The
UI-surface plan checklist (precedent / cardinality / responsive / JTBD /
multi-instance) is therefore **N/A** — recorded explicitly so the gate's UI
expectations are understood: the only "frontend workspace" files touched are
harness/config, not product surfaces, so no new gallery cell / state-matrix entry
is introduced (see DEC on the sentinel).

## Items

- **ITEM-1**: Extend the Rust FNV key (`sdk/crates/ziee-build-support/src/worktree_db.rs`) — add `worktree_key_for_cwd()` (resolve worktree root from CWD, not just `CARGO_MANIFEST_DIR`) and a pure `port_base(key, floor, span)` helper (deterministic port-base from key) so both languages derive the same base. Keep existing `worktree_key(manifest_dir)` untouched. SDK-submodule change → commit in `sdk/`, bump pointer.
- **ITEM-2**: Byte-identical **TS twin** run-key module `sdk/packages/gallery/scripts/lib/run-key.mjs` — `worktreeKey(root?)` = FNV-1a of `git rev-parse --show-toplevel` (same algorithm/constants as Rust, verified equal against a shared fixture vector), `portBase(key, floor, span)` (identical math to Rust `port_base`), and `pickBindablePort(start, maxAttempts)` mirroring `port-manager.ts::isPortBindable` (bind 0.0.0.0). SDK-submodule change.
- **ITEM-3**: Gallery **dynamic port + no-foreign-reuse** (flagship, audit fix #1). In `gate-ui.mjs`: derive `PORT` from `portBase(worktreeKey())` (bind-checked via `pickBindablePort`) when `GALLERY_PORT`/`CFG.port` not explicitly forced; the reuse branch (`galleryUp(PORT)`) must verify the running server is **THIS worktree** via a health-payload sentinel (worktree root), else pick a fresh port and boot its own — never reuse a foreign server. Boot vite on the freshly bind-verified port (strictPort on a verified port is fine).
- **ITEM-4**: Gallery **worktree sentinel** — the gallery dev server must expose its worktree root so gate-ui/runtime-health/the proof can prove provenance. Add a `/__worktree` (or a meta payload on `/gallery.html`) served by a tiny vite middleware plugin keyed off `process.cwd()`/worktree root; gate-ui's reuse check and the proof harness read it. No new gallery *surface* (not a React cell) → no state-matrix churn.
- **ITEM-5**: `runtime-health.mjs` + `playwright.visual.config.ts` + web `vite.config.ts` — consume the key-derived port instead of the fixed `1420`/`1421`. runtime-health already honors `GALLERY_PORT`; ensure gate-ui passes the resolved port through (it does via env) and the visual config + vite dev port + HMR port derive from the key when not explicitly set. Kill the fixed `1420` default (fall back to key-derived), derive HMR `1421` from the dev port.
- **ITEM-6**: `gallery.config.json` (web + desktop) — remove the hardcoded `"port": 1420`/`1455` reliance; make `port` optional (null → key-derived). `gallery-config.mjs` default `port` becomes `null` (meaning "derive"), and consumers resolve `GALLERY_PORT || CFG.port || portBase(worktreeKey(),...)`.
- **ITEM-7**: Desktop gallery/dev/e2e scripts + configs — `desktop/ui/vite.config.ts` (`1420`), `desktop/ui/playwright.config.ts` (`1420` baseURL + webServer), `desktop/ui/playwright.gallery.config.ts` (`1455`), stale desktop `scripts/*.mjs` defaulting to `1420` — all key-derived; retire the stale `1420` in desktop scripts (read gallery.config.json / run-key like web).
- **ITEM-8**: Isolate the Playwright web-e2e `app.data_dir` off shared `~/.ziee` — the generated `test-<testId>.yaml` (`src-app/ui/tests/common/test-context.ts`) sets `app.data_dir` to a per-run dir under `<worktree>/.ziee-cache/e2e-app-data/<testId>` (symlinking the expensive read-only `bin/` cache like the Rust harness's `make_isolated_data_dir`), so e2e stops writing shared `~/.ziee` (files/workflows/skills/temp/models/sandboxes).
- **ITEM-9**: Atomic + flock embedded-binary extract — `bio_mcp/embedded.rs` + `file/utils/embedded.rs` (+ any twin under `mcp/utils/embedded.rs`) replace `if !exists { fs::write(final,bytes) }` with temp-file-write + atomic `rename` + an advisory `flock` on `bin/.extract.lock`, mirroring `code_sandbox/embedded.rs`'s existing atomic-rename pattern.
- **ITEM-10**: Desktop-e2e reaper — `desktop/ui/tests/global-setup.ts` namespaces the `docker ps` filter by the run's port-base namespace + judges liveness from the **shared** lock dir (`collectLiveRunIds`), never an un-namespaced `docker ps` + never a broad `rm`. Port the core/SDK fix.
- **ITEM-11**: Desktop-e2e port-manager — `desktop/ui/tests/fixtures/port-manager.ts` add `isPortBindable` bind-verify, move the backend base off the web-e2e `9100` overlap (separate floor), and make the lock dir env/key-overridable (`ZIEE_DESKTOP_E2E_LOCK_DIR`), key-derived defaults.
- **ITEM-12**: Web-e2e run-key defaults — `src-app/ui/tests/fixtures/port-manager.ts`: when `ZIEE_E2E_BASE_*` / `ZIEE_E2E_LOCK_DIR` are unset, derive them from `worktreeKey()` (base ports via `portBase`, lock dir per-worktree) so cross-worktree isolation is automatic, not a manual opt-in. Lock-dir and port-base move together (never one alone).
- **ITEM-13**: `just prove-isolation K=<n>` acceptance harness (`scripts/prove-worktree-isolation.sh` + a justfile recipe) — create K throwaway worktrees, launch the full matrix simultaneously (gate:ui, `just test`, web+desktop test:e2e, a dev pair), assert ZERO cross-run interference per the audit §9 spec (disjoint bound ports; zero `"reusing gallery dev server"` foreign hits; each gate:ui sees only its own sentinel; zero `ERR_ABORTED/ECONNREFUSED/EADDRINUSE/port already allocated/ENOENT-config/55006/3D000/42P04`; no run's docker reaped by another; sha256-intact extracted binaries; each e2e wrote to its OWN data-dir not `~/.ziee`). Green at K=8 cold = exit condition. Harness only touches its own runId-scoped resources — no broad docker/pkill/rm.
- **ITEM-14**: [DESCOPED] Dev-server `app.data_dir` per-worktree default (audit #6, embedded-PG WAL) — see DECISIONS.
- **ITEM-15**: [DESCOPED] Integration-template `pg_advisory_lock` (audit #7) — see DECISIONS.
- **ITEM-16**: [DESCOPED] Stale-config reaper `vite-`/`test-<testId>` live-lock guard (audit #8) — see DECISIONS.
- **ITEM-17**: [DESCOPED] `/tmp/ziee-workflows` key + guard `test-db.js clean` (audit #9) — see DECISIONS.

## Files to touch

- `sdk/crates/ziee-build-support/src/worktree_db.rs` (ITEM-1) — SDK submodule
- `sdk/packages/gallery/scripts/lib/run-key.mjs` (ITEM-2, new) — SDK submodule
- `sdk/packages/gallery/scripts/gate-ui.mjs` (ITEM-3) — SDK submodule
- `sdk/packages/gallery/scripts/runtime-health.mjs` (ITEM-5) — SDK submodule
- `sdk/packages/gallery/scripts/lib/gallery-config.mjs` (ITEM-6) — SDK submodule
- `sdk/packages/gallery/vite/vite-plugin-gallery-sentinel.js` (ITEM-4, new) — SDK submodule
- `src-app/ui/gallery.config.json`, `src-app/desktop/ui/gallery.config.json` (ITEM-6)
- `src-app/ui/vite.config.ts`, `src-app/ui/playwright.visual.config.ts` (ITEM-5, ITEM-4)
- `src-app/desktop/ui/vite.config.ts`, `src-app/desktop/ui/playwright.config.ts`, `src-app/desktop/ui/playwright.gallery.config.ts`, `src-app/desktop/ui/scripts/*.mjs` (ITEM-7)
- `src-app/ui/tests/fixtures/test-context.ts` + new `src-app/ui/tests/fixtures/e2e-data-dir.mjs` (ITEM-8) — actual path is `tests/fixtures/`, and the logic is extracted to a testable `.mjs` (see DRIFT-1)
- new shared `src-app/server/src/common/embedded.rs` (`extract_atomic`) consumed by `bio_mcp/embedded.rs`, `file/utils/embedded.rs`, `mcp/utils/embedded.rs` (ITEM-9) — DRY shared extractor rather than per-file duplication (see DRIFT-1)
- `src-app/desktop/ui/tests/global-setup.ts` (ITEM-10)
- `src-app/desktop/ui/tests/fixtures/port-manager.ts` + `src-app/desktop/ui/tests/fixtures/isolation-keys.mjs` (ITEM-11) — bases/lock-dir live in the reused `isolation-keys.mjs` helper (see DRIFT-1)
- `src-app/ui/tests/fixtures/port-manager.ts` (ITEM-12)
- `scripts/prove-worktree-isolation.sh` (ITEM-13, new), `justfile` (ITEM-13)
- unit tests: `worktree_db.rs` `#[cfg(test)]` (ITEM-1); `sdk/packages/gallery/scripts/lib/*.test.mjs` or a node test (ITEM-2/3/4); `embedded.rs` `#[cfg(test)]` (ITEM-9)

## Patterns to follow

- **Rust run-key** — mirror `worktree_db.rs::worktree_key`/`stable_suffix` exactly (FNV-1a 0xcbf29ce484222325 / 0x100000001b3, fold `hash ^ (hash>>32)` → 8 hex). New helpers live in the SAME module.
- **Bind-check** — mirror `src-app/ui/tests/fixtures/port-manager.ts::isPortBindable` (net.createServer on 0.0.0.0) for both the TS twin and any allocator.
- **Atomic extract** — mirror `src-app/server/src/modules/code_sandbox/embedded.rs` (temp write + `fs::rename` + flock) — the audit names it as the in-tree template.
- **Isolated e2e data-dir** — mirror the Rust harness `ziee-test-harness/src/lib.rs::make_isolated_data_dir` (per-run dir + symlinked read-only caches) applied to the e2e yaml.
- **Desktop reaper / port-manager** — mirror the already-fixed web `port-manager.ts` (`collectLiveRunIds`, `isPortBindable`, env-overridable `LOCK_DIR`) and `ui/tests/global-setup.ts` reaper (namespaced filter + shared-lock liveness).
- **Proof harness** — mirror the audit §9 spec + the existing per-run scoping idioms (runId-scoped compose names, `--rm`, no broad prune).
