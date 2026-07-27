# INFRA_INTEGRATION — the mandatory per-item walks

This feature has no product-UI surface; "entities" here are the shared MUTABLE
resources, and "subsystems" are the build/test/dev harnesses that touch them.

## UX walk (who encounters this, end-to-end)

The "user" is a developer/agent running N concurrent git worktrees on the shared
box. Today they hand-assign `--port 1479/1480/…` to dodge the fixed-1420
collision (audit §2 live evidence), and a gate:ui can silently pass against a
SIBLING worktree's tree. After this change: they run `npm run dev` / `gate:ui` /
`just test` / `test:e2e` in any worktree with NO manual port/env wiring — each
run derives a per-worktree key, binds a verified port, and never reuses or reaps
another worktree's resource. The acceptance experience is `just prove-isolation
K=8 COLD=1` → green.

## Infrastructure-integration walk (every subsystem the items touch)

- **build.rs / sqlx keying** (`worktree_db.rs`): ITEM-1 only ADDS helpers
  (`worktree_key_for_cwd`, `port_base`); the existing `worktree_key` /
  `should_auto_isolate` / `with_database` are untouched → the build-DB isolation
  contract is unchanged. Verified: `cargo test -p ziee-build-support` green.
- **Gallery gate:ui / runtime-health / visual** (SDK scripts): the port is now
  key-derived + bind-checked and the reuse branch is sentinel-gated. Integration
  point: gate-ui passes the finalized `GALLERY_PORT` to its runtime-health child
  and the visual config, so all three agree (TEST-7). Backward-compat: a server
  booted from an OLD config has no `/__worktree` → `serverIsThisWorktree` false →
  we boot our own (safe).
- **vite dev server** (web + desktop): `server.port` is now the bind-verified
  key port; the CLI `--port` from gate:ui/playwright still overrides (so those
  paths are unaffected). HMR port derives from the dev port.
- **Playwright e2e** (web + desktop): the desktop full-app config now derives its
  dev port and passes `--port` to `npm run dev`; baseURL/webServer url match. The
  web-e2e `app.data_dir` is set per-run (ITEM-8) so servers stop writing shared
  `~/.ziee`. Integration with the port-manager: ITEM-12 makes its DEFAULTS
  key-derived; an explicit `ZIEE_E2E_*` (CI) still wins.
- **Docker reaper** (desktop e2e): ITEM-10 narrows the `docker rm -f` filter to a
  port-base namespace + a shared-lock liveness check — it can now only reap LESS
  (its own run's orphans), never a sibling's live Postgres.
- **Embedded-binary extract** (bio_mcp/file/mcp): ITEM-9 makes the extract atomic
  (temp+rename) + flock — the runtime spawn path that reads `~/.ziee/bin/*` now
  never sees a torn/partial binary under concurrent cold tests.
- **Chat/MCP/permissions/sync/streaming/workflow**: NOT touched — this feature
  adds no route, handler, migration, permission, or sync entity (BASE.md). No
  OpenAPI regen. The only product-code edits (embedded.rs) are internal extract
  logic with no public type surface.

## Entity-lifecycle walk (each shared MUTABLE resource: create / use / reclaim)

| Resource (entity) | create | use | reclaim / access-loss |
|---|---|---|---|
| key-derived vite/gallery **port** | `portBase(key)` → `pickBindablePort` bind-verify | vite binds it | freed on process exit (no lock file); a stale binder is skipped by the next bind-check |
| gallery **sentinel** `/__worktree` | vite middleware at boot | gate:ui/proof read it to prove provenance | dies with the vite server; absent sentinel ⇒ treated as foreign (safe default) |
| e2e **app.data_dir** (per-test) | `test-context.ts` mkdir under `.ziee-cache/e2e-app-data/<testId>` | the spawned server writes files/workflows/… there | removed by the existing per-test teardown (extended to the data dir), testId-scoped only; symlinked `bin/` cache is shared read-only (never deleted per-test) |
| desktop-e2e **docker container** | `docker compose up` (runId+portbase name) | the desktop backend | reaped ONLY by its own run's namespaced filter or an orphan whose runId ∉ shared live set; never a sibling's |
| extracted **binary** in `bin/` | temp-write + atomic rename under a per-binary flock | spawned at runtime | intact-check skips re-extract; a crashed extract leaves only a `.tmp` (never a torn final) |
| proof **worktrees + PIDs** | `git worktree add` + spawned matrix | the assertions | `cleanup()` trap removes ONLY our worktrees + our PROVE_RUNID docker + our spawned PIDs — never broad |

Access-loss cases proven by RUNNING (not inferred): the proof harness's
provenance probe hits each live server's sentinel and asserts own-root; the
forbidden-marker scan proves no run's resource was yanked from under another
(ECONNREFUSED/EADDRINUSE absent).
