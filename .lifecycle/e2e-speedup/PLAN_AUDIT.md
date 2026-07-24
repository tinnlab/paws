# PLAN_AUDIT — e2e-speedup

Plan audited against the codebase on base `origin/feat/agent-core` (`ec00a14de`).

## Breakage risk

- **ITEM-1** — `compose_merged_migrations_from` has ONE production caller,
  `src-app/server/build.rs:93` (verified). The desktop crate does NOT call compose
  (`src-app/desktop/tauri/build.rs` has no `compose_merged` reference); it reuses
  the server-built `ziee_build_<key>` schema. The runtime consumer is
  `sqlx::migrate!("./migrations-merged")` (`core/database/mod.rs:39`) which embeds
  the dir at COMPILE time — so as long as the composed BYTES are identical, the
  embedded migrator is identical. My fix only changes WHEN files are written (skip
  no-op writes) + removes the wipe; the resulting file SET and bytes are identical.
  The public fn signature is unchanged → no caller breaks. Risk: LOW.
  - Edge: a clean checkout (`git clean`) has no `migrations-merged/` dir → I KEEP
    `create_dir_all(merged_dir)` so first build still creates it. A source
    migration DELETED between builds → covered by the new delete-removed-by-name
    step (and by the existing `merged_dir_is_wiped_before_recompose` test, which
    still passes: the stale file is not in the composed set → deleted).
  - `build.rs:186-200` ALSO emits `rerun-if-changed=migrations-merged` and runs a
    Migrator over it for build-DB provisioning — unaffected (it reads, doesn't
    write; mtime stability is what stops the spurious rerun).

- **ITEM-2** — spawning the prebuilt binary instead of `cargo run` changes only
  HOW the identical server binary is launched. The warmup (`global-setup.ts:309`)
  already produces `src-app/target/debug/ziee`. A fallback to `cargo run` when the
  binary is absent preserves the old behavior. Same code path server-side → no
  behavioral or isolation change. Risk: LOW.

- **ITEM-3** — replacing fixed sleeps with `exit`-event awaits + retained
  `killProcessOnPort` cannot leak a port (the port kill remains the guarantee); it
  only shortens the wait when the process already exited. `waitForServerStable`
  6→3 lowers the stable-window requirement but keeps the fast/slow blip reset and
  the best-effort fallback. Risk: LOW–MEDIUM (readiness tuning) — mitigated by
  running a real representative spec in Phase 8.

- **ITEM-4a** — cloning the per-test DB from a migrated template. The per-test DB
  is still uniquely named (`ziee_test_<testId>`) and dropped in teardown →
  isolation preserved. Concern: `CREATE DATABASE … TEMPLATE t` requires no other
  session connected to `t`; the throwaway warmup server is shut down before any
  test runs, and workers default to 1, so concurrency is minimal — a bounded retry
  on the transient "source database is being accessed by other users" error
  handles a raised `PLAYWRIGHT_WORKERS`. Risk: MEDIUM — mitigated by retry +
  Phase-8 real-spec run.

- **ITEM-4b** — `update_check.enabled: false` is a documented config field
  (`UpdateCheckConfig`, `core/config.rs:100`; default true). Setting it false in
  the e2e config only suppresses the outbound GitHub poll (notification-only). No
  functional surface depends on it. Risk: LOW.

## Pattern conformance

- ITEM-1 mirrors the content-stable / skip-if-fresh idiom of the hub-seed build
  helper and the deterministic `emit_ts` generator (byte-stable output). The
  module's own `#[cfg(test)]` suite is the conformance guard.
- ITEM-2 / ITEM-4a mirror `ziee-test-harness/src/lib.rs` (binary resolution
  471-503; `ensure_test_template` 239-305; `CREATE DATABASE … TEMPLATE` 455-462).
  The ONE deliberate divergence: the TS template is migrated by BOOTING the server
  against it (TS cannot run a sqlx Migrator), whereas the Rust harness runs the
  runtime Migrator directly. Equivalent outcome (a fully-migrated template).
- ITEM-4b mirrors the existing conditional-config blocks in `test-context.ts`.

## Migration collisions

None. This feature adds ZERO migrations (highest existing prefix `202607191300`).

## OpenAPI regen

Not required. No handler/type/schema change; `openapi.json` and
`api-client/types.ts` are untouched. The `types_ts_parity` golden tests
(`openapi/mod.rs:201`) stay green because no source type changes.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — single caller (`build.rs:93`), byte-identical
  composed output, existing compose tests + `emit_ts` parity are the guard.
- **ITEM-2** — verdict: PASS — mirrors `ziee-test-harness` binary spawn; identical
  server code; `cargo run` fallback retained.
- **ITEM-3** — verdict: CONCERN — readiness/teardown tuning; keep `killProcessOnPort`
  belt; validate with a real Phase-8 spec run (no fixed-sleep flakiness reintroduced).
- **ITEM-4a** — verdict: CONCERN — template-clone concurrency; mitigate with a
  bounded retry on the transient conflict; per-test DB stays unique (isolation kept).
- **ITEM-4b** — verdict: PASS — verified config key + default.
