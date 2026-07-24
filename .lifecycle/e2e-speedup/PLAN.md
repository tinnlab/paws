# PLAN — e2e-speedup

Kill the per-build ~60s spurious `ziee` recompile (headline) and trim the e2e
per-test fixed cost. Build/test-infra only — NO product behavior, NO migrations,
NO API/type changes, NO new permissions, NO UI surfaces.

## Items

- **ITEM-1**: Fix the self-invalidating migration-compose loop in the `sdk`
  submodule (`sdk/crates/ziee-build-support/src/migrations.rs`,
  `compose_merged_migrations_from`). Make the write CONTENT-STABLE: (a) remove the
  `std::fs::remove_dir_all(merged_dir)` wipe; (b) replace the unconditional
  `std::fs::copy` with a write-on-diff (only `fs::write` when the destination is
  missing or its bytes differ, so unchanged files keep their mtime); (c) after
  composing, delete any `.sql` in `merged_dir` that is NOT in the freshly composed
  set (mirror a removed source migration), by name, without touching unchanged
  files; (d) KEEP both `cargo:rerun-if-changed` emissions (source-dir watches +
  the merged-dir watch). Result: `migrations-merged/` mtime is stable across
  no-op builds, so cargo stops spuriously recompiling `ziee`. Composed output
  bytes stay byte-identical (proven by the existing compose + `openapi::emit_ts`
  golden tests). Then bump the submodule pointer in a superproject commit.

- **ITEM-2**: e2e spawns the prebuilt `src-app/target/debug/ziee` binary
  (`--config-file <cfg>`), not `cargo run --bin ziee`
  (`src-app/ui/tests/fixtures/test-context.ts` ~L376). Resolve the binary path by
  walking up to `src-app/target/debug/ziee` (`.exe` on win32), mirroring the Rust
  harness `ziee-test-harness/src/lib.rs:471-503`. Keep cwd = server dir and the
  same env. If the prebuilt binary is ABSENT, fall back to `cargo run` (preserves
  robustness when warmup is skipped/failed). Same code as `cargo run` builds →
  isolation unchanged.

- **ITEM-3**: Replace the hardcoded teardown/readiness sleeps in `test-context.ts`
  with `child.on('exit')`-driven awaits. Teardown: send SIGTERM, await the
  process `exit` event bounded by a timeout; on timeout send SIGKILL and await
  exit again (bounded). Still call `killProcessOnPort` for both ports afterwards
  (the port-release isolation guarantee is preserved — do NOT drop it). Drop the
  fixed `waitForServerStable` `consecutive` default 6→3.

- **ITEM-4a**: Per-test DB is cloned from a migrated TEMPLATE instead of a raw
  `CREATE DATABASE` that forces the server to run all migrations on boot. Build the
  template ONCE in `global-setup.ts` (after the binary warmup) by booting the
  prebuilt server against a `ziee_test_template_<runId>` DB so its boot migrates
  it, then shutting it down; publish the template name in
  `.test-configs/postgres-<runId>.json`. In `test-context.ts` create the per-test
  DB with `CREATE DATABASE <db> TEMPLATE <template>` (with a bounded retry on the
  transient "source database is being accessed by other users" conflict). Per-test
  DB stays uniquely named (`ziee_test_<testId>`) → isolation unchanged.

- **ITEM-4b**: Disable the per-boot `api.github.com` update-check in the e2e
  backend config by adding `update_check:\n  enabled: false` to the generated
  config in `test-context.ts` (verified config key: `UpdateCheckConfig.enabled`,
  `src-app/server/src/core/config.rs:100`; default true).

## Files to touch

- `sdk/crates/ziee-build-support/src/migrations.rs` (ITEM-1; submodule)
- `sdk` submodule pointer in the superproject (ITEM-1)
- `src-app/ui/tests/fixtures/test-context.ts` (ITEM-2, ITEM-3, ITEM-4a, ITEM-4b)
- `src-app/ui/tests/global-setup.ts` (ITEM-4a — build the migrated template once)

## Patterns to follow

- **ITEM-1** — mirror the CONTENT-STABLE codegen pattern already used by the hub
  seed build helper (`build_helper/hub_seed.rs`: skip-if-fresh, no gratuitous
  rewrite) and the `emit_ts` golden generator (deterministic, byte-stable output).
  Keep the existing `#[cfg(test)]` tests green; the module's own
  `merged_dir_is_wiped_before_recompose` test still passes because the
  delete-removed-by-name path still removes a stale file.
- **ITEM-2 / ITEM-4a** — mirror the Rust harness `ziee-test-harness/src/lib.rs`:
  binary resolution (`471-503`), `ensure_test_template` + `CREATE DATABASE …
  TEMPLATE …` (`239-305`, `455-462`). The TS template is built by BOOTING the
  server against it (TS can't run sqlx migrations) rather than a runtime Migrator.
- **ITEM-3** — Node child-process idiom: `once('exit')` + a bounded
  `Promise.race` timeout; keep the existing `killProcessOnPort` belt.
- **ITEM-4b** — mirror the existing conditional-config-block style already in
  `test-context.ts` (the `bio_mcp` / `code_sandbox` / `jwtAccessExpirySeconds`
  blocks).

## UI-surface checklist

N/A — this feature adds/changes NO user-facing UI surface, page, drawer, card,
panel, permission, or API. It is pure build + e2e-harness infrastructure. The
"representative existing e2e spec still passes through the new harness path"
requirement (a `tier: e2e` test) is the regression guard for the harness change,
not a new surface.
