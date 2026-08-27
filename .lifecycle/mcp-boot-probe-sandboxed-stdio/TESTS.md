# TESTS — mcp-boot-probe-sandboxed-stdio

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-1] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: a system stdio server with `run_in_sandbox: true` and `command: "Rscript"` (the owner's `rcpa` row shape) is NOT probed on the host by the boot sweep — it keeps `enabled: true` and its `last_health_check_reason` never contains "is not allowed on the host". Drives the real `run_startup_health_check` against the test DB, so it exercises the sweep rather than a reimplementation of it.
- **TEST-2** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-2] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: a NON-sandboxed server that genuinely fails its probe is left `enabled: true` and recorded `unhealthy` with a reason. Pins that the sweep records rather than mutates; goes RED against the current auto-disable.
- **TEST-3** (tier: unit) [covers: ITEM-4] file: `src-app/server/src/modules/mcp/client/stdio.rs` — asserts: the host-path rejection for a row with `run_in_sandbox: true` names the sandbox runtime as the cause and does NOT contain "Enable run-in-sandbox", while a genuine host row with a disallowed command still gets the original allowlist message. Both branches asserted so the fix cannot degrade into one message for everything.
- **TEST-4** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: `POST /mcp/system-servers/test-connection` for a STORED server whose row has `run_in_sandbox: true` reports that Test Connection cannot validate a sandboxed server, instead of the host-allowlist message. Pins the honesty fix.
- **TEST-5** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/mcp/connection_health.rs` — asserts: the readiness wait returns promptly once `code_sandbox::config::init_status()` is terminal, and returns (rather than hanging) when it stays `NotInitialized` past the bound. Pins the ordering guarantee without needing a full boot.
- **TEST-6** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-5] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: Test Connection against a STORED sandboxed row records `last_health_check_status = "untested"`, not `"unhealthy"`, and leaves `enabled` alone. A test that could not run is not a failed test; recording it as one paints the badge red with a message that says the server is fine, and re-creates the badge TEST-1's skip clears. Proven RED by neutering `health_record_for`: `left: Some("unhealthy") right: Some("untested")`.
- **TEST-7** (tier: integration) [covers: ITEM-6] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: creating a sandboxed row records `untested` WITH a non-empty reason. Without it the row sits at the column default with a NULL reason and the card draws "Click Test Connection or toggle Enabled to run a probe" — the two actions that are no-ops for it. Proven RED: `the create-time skip must record its reason; got None`.
- **TEST-8** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-6, ITEM-8] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: the remedy path. A disabled sandboxed row seeded with the reported damage verbatim is PUT `enabled: true`, and BOTH the persisted row AND the response carry a true verdict. Proven RED: the response came back `"last_health_check_status":"unhealthy","last_health_check_reason":"is not allowed on the host"` immediately after a successful enable — the stale red Alert the drawer renders next to the success toast.
- **TEST-9** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-7, ITEM-9] file: `src-app/ui/tests/e2e/mcp/mcp-sandboxed-create-no-host-probe.spec.ts` — asserts: on the system create drawer, with `command: Rscript` and Run-in-sandbox ticked, toggling Enabled leaves the switch ON and neither "is not allowed on the host" nor "Enable run-in-sandbox" appears anywhere on the page. A host probe of `Rscript` can only fail and a failure snaps the switch back off, so the switch state alone distinguishes "did not probe" from "probed and failed". **Ran and passed (45.3s); proven RED** by neutering the skip — `Expected: "true" Received: "false"`, the switch snapping back exactly as reported.

## Note on ITEM-3 and what a test can honestly claim

TEST-5 pins the *mechanism* (the sweep waits for a verdict and is bounded). It does not
prove the end-to-end ordering on a real boot, which would need a deterministic interleave
of two module inits inside one process — the harness spawns whole binaries and cannot
schedule that. Stated here rather than implied: after ITEM-1 the race no longer produces
the reported symptom at all, so ITEM-3 is defence-in-depth for any future
`get_state()`-dependent boot work, and is tested at that level.

## Known coverage gaps, stated rather than implied

- **TEST-9 covers the create-mode skip; the rest of the frontend does not have
  automated coverage.** The toast tones, both tooltip branches and the card's
  sandbox-aware fallback are covered only by `tsc`, the lints, the regenerated
  state matrix, and blind auditors reading them.
- **The USER-mode variant of TEST-9 cannot run on a sandbox-off deployment.** It
  is the sharper case — policy force-sandboxes the row and that screen has no
  toggle, so the advice is impossible rather than merely wrong — but with
  `code_sandbox` disabled the policy filters `stdio` out of the transport options
  entirely (`user_policy/repository.rs:41-51`), making the path unreachable. A
  first draft of TEST-9 drove it and SKIPPED; it was rewritten to the admin
  drawer rather than left as a test that reports success while asserting nothing.
  Covering it needs a `code_sandbox`-enabled e2e deployment.
- **The backfill migration is not exercised by a test.** It is verified to APPLY
  (the harness rebuilds its template from migrations and all four integration
  tests pass on it), but no test seeds a pre-migration damaged row and asserts it
  was cleared. The statement is a single unconditional UPDATE with an explicit
  WHERE; a test would restate it rather than check it.
- **`sandbox_skip_reason`'s `Ready` branch is not reached by any test**, because
  nothing in a test process sets the sandbox status. The two other branches are
  reached (the test process yields `NotInitialized`, the server subprocess
  `DisabledInConfig`).
- **No macOS or Windows build.**
