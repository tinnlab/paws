# PLAN_AUDIT — plan vs codebase

## Breakage risk

- **Gallery port change (ITEM-3/5/6):** the risk is a run that EXPLICITLY sets
  `GALLERY_PORT`/`VITE_DEV_PORT` must keep working byte-for-byte (operators
  currently hand-assign ports). Resolution: explicit env > key-derived >
  bind-check. The key only seeds the search start; an explicit env is honored.
  Also `playwright.visual.config.ts` boots `npm run dev -- --port $PORT
  --strictPort` — strictPort on a **freshly bind-verified** port is safe (the
  window is TOCTOU-narrow; the audit accepts the same caveat for
  `allocatePostgresPort`).
- **`gallery.config.json` `port` → null (ITEM-6):** existing readers do
  `Number(process.env.GALLERY_PORT || CFG.port)` → `Number(undefined)` = `NaN`.
  Every consumer must be updated to fall through to key-derived when `CFG.port`
  is null. Enumerated: `gate-ui.mjs`, `runtime-health.mjs`,
  `playwright.visual.config.ts`, desktop scripts. Risk mitigated by ITEM-5/7
  touching every consumer + a unit test asserting resolution.
- **Web-e2e key defaults (ITEM-12):** ONLY changes behavior when `ZIEE_E2E_*`
  are UNSET (today = fixed 9000/9100/54331). Setting them explicitly (CI) is
  unchanged. The lock-dir + port-base MUST move together (audit §7) — both
  derive from the same key or both stay default. Verified: the port-manager
  already reads all three from env; I only change the DEFAULT.
- **Atomic extract (ITEM-9):** `code_sandbox/embedded.rs` is the proven template;
  replicating temp+rename+flock cannot regress correctness (rename is atomic on
  the same fs; flock is advisory, released on process exit). Risk: the temp file
  must be on the SAME filesystem as the final path (rename across fs fails) —
  handled by writing the temp beside the final in `bin/`.
- **e2e data-dir (ITEM-8):** setting `app.data_dir` in the e2e yaml where none
  was set. Risk: a test that implicitly relied on shared `~/.ziee` state
  (unlikely — tests are isolated). The Rust harness already proves per-run
  data-dir works; mirroring it is low-risk. Symlink the read-only `bin/` cache
  so extract cost isn't paid per test.
- **Desktop reaper (ITEM-10):** narrowing the `docker rm -f` filter can only
  make it reap LESS (safer). No risk of over-reaping; only risk is under-reaping
  a genuine orphan — mitigated by the same TTL/liveness the web reaper uses.

## Pattern conformance

- ITEM-1 mirrors `worktree_db.rs::worktree_key`/`stable_suffix` (same module).
- ITEM-2 TS twin replicates the FNV constants; a shared fixture vector asserts
  byte-identical output (Rust test + node test compute the same key for the same
  root string).
- ITEM-9 mirrors `code_sandbox/embedded.rs` (named by the audit as the template).
- ITEM-8 mirrors `ziee-test-harness/src/lib.rs::make_isolated_data_dir`.
- ITEM-10/11/12 mirror the already-fixed web `port-manager.ts` + `global-setup.ts`.
- ITEM-13 mirrors the existing per-run docker scoping (runId names, `--rm`, no
  broad prune) and the audit §9 spec.

## Migration collisions

None — this feature adds no migration (see BASE.md). ITEM-15 (template advisory
lock) is DESCOPED and, if implemented, is a runtime `pg_advisory_lock`, not a
schema migration.

## OpenAPI regen

None — no handler/route/response-type change. No `just openapi-regen` needed;
`emit_ts` golden parity unaffected. The only backend edits (ITEM-9 `embedded.rs`)
are internal extract logic with no public type surface.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — extends `worktree_db.rs` in place; no new migration; pure helpers.
- **ITEM-2** — verdict: PASS — new SDK lib; byte-identical-to-Rust asserted by a shared fixture test.
- **ITEM-3** — verdict: PASS — mirrors gate-ui reuse logic; explicit-env precedence preserves operator overrides.
- **ITEM-4** — verdict: PASS — new vite middleware plugin; not a React surface, so no state-matrix/gallery-coverage impact.
- **ITEM-5** — verdict: CONCERN — must update EVERY port consumer when `CFG.port`→null; enumerated + unit-tested to resolve.
- **ITEM-6** — verdict: CONCERN — `NaN` fall-through risk in `Number(env||CFG.port)`; every consumer updated in ITEM-5/7.
- **ITEM-7** — verdict: PASS — desktop mirrors web; retire stale 1420 scripts.
- **ITEM-8** — verdict: PASS — mirrors the Rust harness isolated-data-dir; low risk.
- **ITEM-9** — verdict: PASS — mirrors code_sandbox atomic-rename template; same-fs temp.
- **ITEM-10** — verdict: PASS — narrowing a reaper filter is strictly safer; mirrors web fix.
- **ITEM-11** — verdict: PASS — additive bind-verify + separate base + env lock dir.
- **ITEM-12** — verdict: PASS — default-only change; env override unchanged; lock+base move together.
- **ITEM-13** — verdict: CONCERN — the K=8-cold proof is resource-heavy + long; must be runId-scoped and never broad-reap. Structured per audit §9; small-K first.
- **ITEM-14** — verdict: PASS — [DESCOPED] dev-server app.data_dir (audit #6); approved in DECISIONS; K=8 proof passes without it.
- **ITEM-15** — verdict: PASS — [DESCOPED] integration-template advisory lock (audit #7); approved in DECISIONS; same-worktree-concurrent-binary edge only.
- **ITEM-16** — verdict: PASS — [DESCOPED] stale-config reaper testId guard (audit #8); approved in DECISIONS; long-test edge only.
- **ITEM-17** — verdict: PASS — [DESCOPED] /tmp/ziee-workflows key + test-db.js guard (audit #9); approved in DECISIONS; rare.
