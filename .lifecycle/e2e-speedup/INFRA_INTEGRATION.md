# INFRA_INTEGRATION — e2e-speedup

Per-item UX / infra-integration / entity-lifecycle walks. This feature has no
end-user surface and no persisted entities — the "user" of every item is a
DEVELOPER running builds / e2e; the "entities" are build artifacts and per-test
OS resources (processes, ports, databases).

## ITEM-1 — content-stable migration compose

- **UX walk (developer):** A developer runs `cargo build`/`cargo run`/`cargo test`
  or the e2e warmup. TODAY every invocation eats ~62s recompiling `ziee` for no
  reason. After: a no-op build is Fresh (<1s). The developer sees the same
  composed `migrations-merged/` content; nothing about the schema changes.
- **Infra-integration walk — subsystems touched:**
  - `build.rs::compose_merged_migrations` (the ONE caller) — unchanged call site.
  - Build-DB provisioner (`build.rs:186` Migrator over `migrations-merged`) — reads
    the dir; unaffected by write-on-diff.
  - Runtime `sqlx::migrate!("./migrations-merged")` (`core/database/mod.rs:39`) —
    embeds the dir at COMPILE time; requires byte-identical content → preserved.
  - `cargo:rerun-if-changed` fingerprinting — the exact subsystem being fixed: the
    merged-dir watch now sees a STABLE mtime on no-op builds (no wipe/recreate, no
    gratuitous file rewrite) so it stops re-dirtying `ziee`. Source-dir watches
    still fire on REAL migration edits.
  - Concurrent cross-worktree builds — the merged dir is per-manifest (per
    worktree), not shared; no new cross-worktree interaction.
- **Entity-lifecycle walk (build artifacts):**
  - ADD a migration (new source `.sql`): write-on-diff writes the new file (dst
    missing) → dir mtime changes ONCE → cargo reruns build.rs + recompiles ONCE
    (correct — real input changed). Source-dir `rerun-if-changed` also fires.
  - MUTATE a migration (edit an existing source `.sql`): bytes differ → write →
    that file's mtime changes → recompile ONCE (correct). Dir mtime may or may not
    change; the source-dir watch fires regardless.
  - REMOVE a migration (delete a source `.sql`): the delete-by-name step removes it
    from merged → dir mtime changes → recompile ONCE (correct).
  - NO-OP (nothing changed): no writes, no deletes, no create → merged dir + all
    file mtimes unchanged → cargo stays Fresh. THIS is the fix.
  - Clean checkout (merged dir absent): `create_dir_all` recreates it; all files
    written (all dst missing) → composes correctly.

## ITEM-2 — spawn prebuilt binary

- **UX walk:** e2e author runs a spec; the backend starts from the already-warm
  binary in ~0.8s instead of paying cargo's per-test graph-check / build-lock.
- **Infra-integration walk:** `spawn()` target changes from `cargo` to the binary
  path; cwd (server dir) + env (hub-dir override, debug seams, PATH) unchanged. No
  interaction with the build-DB (the binary is already built). If the binary is
  missing → `cargo run` fallback (identical to today).
- **Entity-lifecycle walk (server process):** the returned `ChildProcess` is the
  SERVER directly (not a `cargo` wrapper that orphans the real child) — so SIGTERM/
  SIGKILL in teardown now reach the server itself, STRENGTHENING cleanup (the old
  `cargo run` parent could orphan the server; `killProcessOnPort` was the backstop
  and REMAINS). No new orphan risk.

## ITEM-3 — exit-driven teardown + readiness

- **UX walk:** teardown between tests no longer burns a fixed 2s; it returns as
  soon as the process actually exits.
- **Infra-integration walk:** the `port-manager` lock heartbeat + `releasePortLock`
  are unchanged; `killProcessOnPort` (lsof/netstat kill) remains the port-release
  guarantee. Only the WAIT strategy changes (event vs fixed sleep).
- **Entity-lifecycle walk (ports + processes):** server + vite children are awaited
  to real exit, then both ports are force-killed and the lock released — every exit
  path (clean exit, timeout→SIGKILL) converges on the same port-release. No port can
  leak because the port kill is unconditional and last.

## ITEM-4a — per-test DB from migrated template

- **UX walk:** each per-test backend boots faster (skips ~107 migrations).
- **Infra-integration walk:** touches (a) global-setup (builds the template once,
  booting the warm binary against it), (b) the postgres-<runId>.json config
  contract (adds `templateName`), (c) test-context DB creation (TEMPLATE clone +
  retry). The docker Postgres container + port allocation are unchanged. The
  template DB lives in the same container and is dropped with it at teardown (the
  container is `docker rm -f`'d in global-teardown — no separate cleanup needed;
  documented below).
- **Entity-lifecycle walk (databases):**
  - Template ADD: created + migrated once in global-setup; if it already exists
    from a crashed prior run, `CREATE DATABASE` would error → global-setup drops it
    first (`DROP DATABASE IF EXISTS`) mirroring the Rust harness.
  - Per-test DB ADD: `CREATE DATABASE … TEMPLATE …` (unique name).
  - Per-test DB REMOVE: existing teardown terminates backends + `DROP DATABASE IF
    EXISTS` — unchanged.
  - Template REMOVE: the whole per-run Postgres CONTAINER is removed in
    global-teardown (it is ephemeral per runId), so the template dies with it; no
    orphan. (Confirmed: global-teardown `docker compose down`/`rm -f` the container.)

## ITEM-4b — disable update-check

- **UX walk:** no behavioral change a developer sees except a cleaner boot log +
  no shared-egress GitHub rate-limit hazard across 393 boots.
- **Infra-integration walk:** `server_update` module reads `update_check.enabled`
  at boot (`mod.rs:68`); false → it logs "disabled" and spawns NO poll task. No
  other subsystem depends on the update check.
- **Entity-lifecycle walk:** N/A (removes a background task; nothing persisted).
