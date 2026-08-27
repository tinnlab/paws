# TEST_RESULTS — mcp-boot-probe-sandboxed-stdio

Every result below was produced by running the test, not by reading it. Where a
test's assertion could have been satisfied by a no-op, it was **individually
proven RED** by neutering the specific production line it pins, and the observed
failure text is quoted.

- **TEST-1**: PASS — `boot_sweep_does_not_host_probe_or_disable_a_sandboxed_stdio_server`.
  Proven RED before the fix with only the three production files stashed; it
  reproduced the reported message verbatim: `reason=Command 'Rscript' is not
  allowed on the host. Allowed commands: ["npx","uvx","python","python3","node"].
  Enable run-in-sandbox to use any command.` (`0 passed; 3 failed`).
- **TEST-2**: PASS — `boot_sweep_records_but_does_not_disable_an_unreachable_server`.
  Proven RED in the same run.
- **TEST-3**: PASS — both `stdio.rs` unit tests. The paired negative
  (`host_row_with_disallowed_command_still_gets_the_allowlist_message`) exists so
  the fix cannot degrade into one message for every case.
- **TEST-4**: PASS — `test_connection_reports_that_it_cannot_validate_a_sandboxed_server`.
  Proven RED in the same run.
- **TEST-5**: OBSOLETE→PASS — the three `await_verdict_*` unit tests passed, then
  were **deleted with the mechanism they covered**. The blind audit established
  that the readiness wait could not change any verdict and cost 30 s per call;
  removing it took the boot-probe suite from **32.62 s to 2.51 s**. Recorded as
  obsolete rather than silently dropped (LEDGER F-1, F-16). ITEM-3's invariant is
  now carried structurally by TEST-1, which is the stronger proof.
- **TEST-6**: PASS — Test Connection records `untested`, not `unhealthy`, for a
  sandboxed row. **Proven RED**: `left: Some("unhealthy") right: Some("untested")`,
  with the reason reading "This is a limit of the test, NOT a problem with the
  server" — a red badge carrying a message that says the server is fine.
- **TEST-7**: PASS — the create-time skip records its reason. **Proven RED**:
  `the create-time skip must record its reason; got None` — the NULL that made the
  card draw "Click Test Connection or toggle Enabled to run a probe", two actions
  that are both no-ops for the row.
- **TEST-8**: PASS — the remedy path. **Proven RED**: the PUT response came back
  `"last_health_check_status":"unhealthy","last_health_check_reason":"is not
  allowed on the host"` immediately after a successful enable — the stale red
  Alert the drawer renders beside the green success toast.
- **TEST-9**: PASS — e2e, 45.3 s, chromium, `--workers=1`. **Proven RED** by
  neutering the create-mode skip: `Expected: "true" Received: "false"` — the
  Enabled switch snapping back off exactly as reported.

## Oracles

The `types.ts` / `openapi.json` hand-patch was verified by the repo's own golden
test (`openapi::tests::types_ts_parity` and `..._desktop`), which was **itself
proven non-vacuous** first: changing one word in `types.ts` turned it RED, and it
returned green when reverted.

## Regression scope

- **Lib unit tests**: 378 passed, 0 failed (`mcp::` + `openapi::tests`).
- **Integration, affected scope**, serialized: `mcp::test_connection_test`,
  `mcp::run_in_sandbox_test`, `mcp::builtin_test_connection_test`,
  `mcp::stdio_transport_test`, `mcp::boot_probe_sandboxed`,
  `mcp::mcp_defaults_test` — **42 passed; 0 failed** (737 s).
- The only failure seen in any run was `mcp::stdio_transport_test` (2 tests) under
  `--test-threads=6`, failing with `Server is disabled` because the create-time
  probe's `npx` spawn lost to install-storm contention. It passes **3/3
  serialized in 14.2 s**, and is included green in the 42/42 above. That is the flake class CLAUDE.md documents for this
  box, classified by error signature rather than assumed.
- **npm run check (ui): PASS** — the full chain, exit 0 (tsc, biome guardrails,
  lint:colors / settings-field / adjacent-inline / icon-action / hooks /
  logical-direction / tooltip-placement, check:kit-manifest, testid-registry,
  design-spec, gallery-coverage, gallery-crawl, state-matrix, overlay-registry,
  override-registry, store-actions, case-collisions, harness-parity, and the
  hook-gate / gallery-script / gate-ui-stale test suites). `check:state-matrix`
  was **failing** on this branch until the generator was rerun (LEDGER F-43).
- **gate:ui (ui): PASS** — exit 0, `--skip-visual`; the browser canary against
  the real gallery build. `per-surface runtime verdict: 205/205 PASS`; gate
  summary PASS on tsc / lint / runtime-health / visual.
  Reported honestly rather than rounded: the run's own validity line reads
  `590/590 cells · origin alive (69 checks) · transport artifacts 130 (18.4% of
  findings)`. A pristine run reads `0 (0%)`; 18.4% is below the harness's VOID
  threshold (it rolled the run up rather than refusing it) and this box was
  running other worktrees' suites concurrently, which is the documented cause.
  No surface was reported as failing.

## Not verified — stated plainly

- No macOS or Windows build.
- The backfill migration is verified to APPLY (the harness rebuilds its template
  from migrations and all four boot-probe tests pass on it) but has no test that
  seeds a damaged row and asserts it was cleared.
- `sandbox_skip_reason`'s `Ready` branch is unreached by any test; nothing in a
  test process sets the sandbox status.
- The USER-mode variant of TEST-9 is unreachable on a sandbox-off deployment and
  is recorded as a gap rather than shipped as a silently-skipping test.
- The frontend changes other than the create-mode skip (toast tones, tooltip
  branches, the card's sandbox-aware fallback) have no automated coverage.
