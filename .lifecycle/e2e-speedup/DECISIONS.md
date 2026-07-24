# DECISIONS — e2e-speedup

This is build + e2e-harness infrastructure. There is NO user-facing product
choice to escalate to the human — every decision resolves by codebase convention.
No operational tunable is introduced (the configurable-settings rule is N/A: no
resource limit / retention / quota / toggle is added to the product; the e2e
config values are test-harness constants, not shipped settings).

### DEC-1: How is `migrations-merged` made mtime-stable — write-on-diff, or hash sidecar?
**Resolution:** Write-on-diff: for each composed source, `fs::write(dst, bytes)`
ONLY when `dst` is missing or its current bytes differ from the source bytes;
unchanged files are left untouched so their mtime is preserved. No hash sidecar
(the file bytes ARE the comparison; migrations are small).
**Basis:** convention — mirrors the hub-seed helper's skip-if-fresh content check
and keeps the change minimal + self-contained.

### DEC-2: How are removed source migrations mirrored without the wipe?
**Resolution:** After writing the composed set, enumerate the merged dir and
delete any `.sql` whose basename is NOT in the composed set (delete-by-name).
Non-`.sql` files are left alone (matches the old copy loop, which only ever wrote
`.sql`). `create_dir_all(merged_dir)` is retained so a clean checkout still
creates the dir.
**Basis:** convention — preserves the existing
`merged_dir_is_wiped_before_recompose` test's guarantee (stale file removed)
without recreating the directory (which is what churned the mtime).

### DEC-3: Prebuilt-binary spawn — hard requirement or fallback to `cargo run`?
**Resolution:** Prefer the prebuilt `src-app/target/debug/ziee`; if it is ABSENT
(warmup skipped/failed), fall back to `cargo run --bin ziee`. The binary path is
resolved by walking to `src-app/target/debug/ziee` (`.exe` on win32).
**Basis:** convention — `global-setup.ts` already warms the binary; the fallback
preserves the pre-existing robustness (a failed warmup is documented as non-fatal
there). Mirrors `ziee-test-harness` binary resolution (471-503).

### DEC-4: Teardown — how long to await process exit before SIGKILL?
**Resolution:** SIGTERM, then await the child `exit` event bounded by a 4000ms
timeout; on timeout SIGKILL and await exit bounded by 2000ms. `killProcessOnPort`
is still called for BOTH ports afterwards as the port-release guarantee.
**Basis:** convention — the old code allowed 1500ms after SIGTERM before SIGKILL;
4000ms is a strict superset (only WAITS that long when the process hasn't exited,
whereas the exit-event resolves immediately on a clean shutdown). The port kill is
unchanged, so isolation is unchanged.

### DEC-5: `waitForServerStable` consecutive count.
**Resolution:** Default `consecutive` 6 → 3 (keep `intervalMs:250`, `fastMs:800`,
the blip-reset, and the `stabilizeSeconds:30` best-effort fallback).
**Basis:** brief directive + convention — 3 consecutive fast/healthy probes
(~750ms window) is still a deep gate (strictly better than the pre-existing
single-200 gate) but ~1s cheaper per boot. The best-effort fallback means it can
never become a NEW "failed to start".

### DEC-6: Where is the migrated TEMPLATE built, and how (TS can't run sqlx)?
**Resolution:** In `global-setup.ts`, AFTER the binary warmup: create
`ziee_test_template_<runId>`, boot the prebuilt server ONCE against it (its boot
runs the migrations), wait for `/api/health`, then shut it down. Publish the
template name into `.test-configs/postgres-<runId>.json`. `test-context.ts` reads
it and does `CREATE DATABASE <db> TEMPLATE <template>`.
**Basis:** convention — the server already migrates-on-boot; booting it against
the template is the TS-side equivalent of the Rust harness's runtime Migrator
(`ensure_test_template`, lib.rs:239-305). Building it in global-setup means it
happens ONCE per run, off the per-test critical path.

### DEC-7: Template-clone concurrency (`CREATE DATABASE … TEMPLATE`) safety.
**Resolution:** Wrap the per-test `CREATE DATABASE … TEMPLATE` in a bounded retry
(up to 5 attempts, 200ms backoff) on the transient Postgres error "source
database … is being accessed by other users" (SQLSTATE 55006). Workers default to
1, so this is a safety net for a raised `PLAYWRIGHT_WORKERS`.
**Basis:** convention — Postgres locks the template during a clone; a bounded
retry is the standard mitigation. Per-test DB name stays unique → isolation kept.

### DEC-8: What if a per-test DB name pre-exists (retry after a partial failure)?
**Resolution:** No change — the per-test DB name is a fresh random `testId` per
test (`ziee_test_<testId>`), so a collision is astronomically unlikely; the
existing teardown `DROP DATABASE IF EXISTS` covers cleanup. Not adding
speculative handling.
**Basis:** convention — matches the existing raw `CREATE DATABASE` behavior.

### DEC-9: Fallback when the template build fails in global-setup.
**Resolution:** If the template build fails (or is skipped), publish NO template
name; `test-context.ts` then falls back to the existing raw `CREATE DATABASE`
(migrate-on-boot) path. Non-fatal — the run still works, just without the
per-boot migration saving.
**Basis:** convention — mirrors the warmup's documented non-fatal fallback
posture; never let an optimization become a hard failure.
