# TESTS — e2e-speedup

Every ITEM is covered. No new permission is introduced → no `[negative-perm]`
restricted-user spec is required (A10 N/A). The `src-app/ui/**` diff mandates ≥1
`tier: e2e` test — satisfied by TEST-5..8 (a representative existing spec run
through the new harness path IS the regression guard for the harness change).

## ITEM-1 — content-stable migration compose (unit + golden)

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-build-support/src/migrations.rs` — asserts: composing twice over UNCHANGED sources leaves every merged `.sql` file's mtime IDENTICAL (no gratuitous rewrite), and the merged DIR's own mtime is unchanged across the second no-op compose — the mechanism that stops cargo's spurious rerun.
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-build-support/src/migrations.rs` — asserts: a `.sql` present in the merged dir but NOT in the composed source set is DELETED on recompose (removed-source mirroring), without the wipe (the existing `merged_dir_is_wiped_before_recompose` behavior preserved under the new delete-by-name path).
- **TEST-3** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-build-support/src/migrations.rs` — asserts: composed output bytes are byte-identical to the source `.sql` (content copied verbatim; the existing `unions_globbed_module_migrations_and_ignores_non_sql` + a changed-content rewrite case).
- **TEST-4** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/openapi/mod.rs` — asserts: the `types_ts_parity` golden test stays green (composed-bytes / build change does not perturb the generated `types.ts`), i.e. the ITEM-1 change is content-neutral.

> ITEM-1's headline BUILD-TIMING proof (62s → sub-second on a no-op `cargo build
> -p ziee`, AND a second back-to-back build staying sub-second) is a MEASURED
> result recorded in TEST_RESULTS.md as `BUILD-TIMING`; TEST-1 is the unit-level
> mechanism guard for that behavior.

## ITEM-2 — spawn prebuilt binary (e2e)

- **TEST-5** (tier: e2e) [covers: ITEM-2] file: `src-app/ui/tests/e2e/auth/auth.spec.ts` — asserts: a representative spec passes with the backend launched from the prebuilt `src-app/target/debug/ziee` (verified from the per-test log: the server is spawned as the binary path, NOT `cargo run`, and there is no per-test compile).

## ITEM-3 — exit-driven teardown + readiness (e2e)

- **TEST-6** (tier: e2e) [covers: ITEM-3] file: `src-app/ui/tests/e2e/auth/auth.spec.ts` — asserts: the spec's multiple tests run back-to-back through the new `child.on('exit')` teardown + `consecutive:3` readiness gate WITHOUT a port leak or a "Backend server failed to start" (ports are released between tests; readiness still deep-gates before the test proceeds).

## ITEM-4a — per-test DB from migrated template (e2e)

- **TEST-7** (tier: e2e) [covers: ITEM-4a] file: `src-app/ui/tests/e2e/auth/auth.spec.ts` — asserts: each per-test backend boots against a DB cloned via `CREATE DATABASE … TEMPLATE ziee_test_template_<runId>` (unique per-test DB name retained → isolation) and the boot does NOT re-run the full migration set (verified from the boot log: migrations already applied / no fresh 100+ migration run), yet the app is fully functional (setup + login succeed against the cloned schema).

## ITEM-4b — disable per-boot GitHub update-check (e2e)

- **TEST-8** (tier: e2e) [covers: ITEM-4b] file: `src-app/ui/tests/e2e/auth/auth.spec.ts` — asserts: the e2e backend config carries `update_check.enabled = false` and the boot log shows `server_update: update checks disabled in config` with NO `api.github.com` request during the run.
