# DRIFT-1 — implementation vs plan (e2e-speedup)

Reconciling the shipped diff against PLAN.md item by item.

- **DRIFT-1.1** — verdict: none — ITEM-1 implemented exactly as planned
  (`migrations.rs`: removed `remove_dir_all`, `create_dir_all` retained,
  write-on-diff via `fs::read`+compare+`fs::write`, delete-removed-by-name using
  the `seen` set, both `cargo:rerun-if-changed` emissions kept). Doc comment +
  test rename updated. Measured 62s→0.62s (proof captured for TEST_RESULTS).

- **DRIFT-1.2** — verdict: none — ITEM-2 spawns the prebuilt
  `src-app/target/debug/ziee` with a `cargo run` fallback when absent, cwd/env
  unchanged, mirroring the Rust harness binary resolution. As planned.

- **DRIFT-1.3** — verdict: none — ITEM-3 replaced the fixed SIGTERM+1500ms /
  SIGKILL+500ms sleeps with `terminateChild()` (exit-event driven, bounded 4s/2s),
  kept both `killProcessOnPort` calls, and dropped `waitForServerStable`
  `consecutive` 6→3. As planned.

- **DRIFT-1.4** — verdict: impl-wins (minor, plan clarified) — ITEM-4a. PLAN said
  "publish the template name in `.test-configs/postgres-<runId>.json`". The impl
  builds `configData` (runId/port/dockerComposePath) BEFORE the binary warmup, so
  I RE-WRITE that same JSON with `templateName` added AFTER the template build.
  Net effect identical to the plan (the JSON carries `templateName`); the plan's
  "publish in" is satisfied by the re-write. Also added two opt-outs not spelled
  out in the plan but consistent with the codebase's `E2E_SKIP_*` idiom:
  `E2E_SKIP_DB_TEMPLATE=1` (skip template) — a natural sibling of the existing
  `E2E_SKIP_BUILD` / `E2E_SKIP_SERVER_WARMUP`. PLAN.md updated to note the
  re-write + opt-out (see amendment below). No behavior conflict; recorded as
  impl-wins for the extra env var.

- **DRIFT-1.5** — verdict: none — ITEM-4a template concurrency handled with the
  bounded 55006 retry (DEC-7); per-test DB name stays unique (isolation kept). As
  planned.

- **DRIFT-1.6** — verdict: none — ITEM-4b added `update_check:\n  enabled: false`
  to the generated e2e config (verified key). As planned.

- **DRIFT-1.7** — verdict: resolved — the two helper fns `findFreePort` +
  `waitForHttp` were added to global-setup (not called out as separate files in
  the plan, but they live inside `global-setup.ts`, a planned file). No new file.

## PLAN amendment (from DRIFT-1.4)
PLAN ITEM-4a's mechanism is refined: the template name is published by RE-WRITING
`postgres-<runId>.json` after the template build (the JSON is first written
pre-warmup), and an `E2E_SKIP_DB_TEMPLATE=1` opt-out mirrors the existing
`E2E_SKIP_*` env idiom. No item added/removed; TESTS.md coverage unchanged.

**Unresolved drifts:** 0
