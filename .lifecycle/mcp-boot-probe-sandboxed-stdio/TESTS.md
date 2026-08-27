# TESTS — mcp-boot-probe-sandboxed-stdio

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-1] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: a system stdio server with `run_in_sandbox: true` and `command: "Rscript"` (the owner's `rcpa` row shape) is NOT probed on the host by the boot sweep — it keeps `enabled: true` and its `last_health_check_reason` never contains "is not allowed on the host". Drives the real `run_startup_health_check` against the test DB, so it exercises the sweep rather than a reimplementation of it.
- **TEST-2** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-2] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: a NON-sandboxed server that genuinely fails its probe is left `enabled: true` and recorded `unhealthy` with a reason. Pins that the sweep records rather than mutates; goes RED against the current auto-disable.
- **TEST-3** (tier: unit) [covers: ITEM-4] file: `src-app/server/src/modules/mcp/client/stdio.rs` — asserts: the host-path rejection for a row with `run_in_sandbox: true` names the sandbox runtime as the cause and does NOT contain "Enable run-in-sandbox", while a genuine host row with a disallowed command still gets the original allowlist message. Both branches asserted so the fix cannot degrade into one message for everything.
- **TEST-4** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: `POST /mcp/system-servers/test-connection` for a STORED server whose row has `run_in_sandbox: true` reports that Test Connection cannot validate a sandboxed server, instead of the host-allowlist message. Pins the honesty fix.
- **TEST-5** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/mcp/connection_health.rs` — asserts: the readiness wait returns promptly once `code_sandbox::config::init_status()` is terminal, and returns (rather than hanging) when it stays `NotInitialized` past the bound. Pins the ordering guarantee without needing a full boot.
- **TEST-6** (tier: integration) [invariant: INV-2] [covers: DRIFT-1.2] file: `src-app/server/tests/mcp/boot_probe_sandboxed_test.rs` — asserts: Test Connection against a STORED sandboxed row records `last_health_check_status = "untested"`, not `"unhealthy"`, and leaves `enabled` alone. A test that could not run is not a failed test; recording it as one paints the badge red with a message that says the server is fine, and re-creates the badge TEST-1's skip clears. Proven RED by neutering `health_record_for`: `left: Some("unhealthy") right: Some("untested")`.

## Note on ITEM-3 and what a test can honestly claim

TEST-5 pins the *mechanism* (the sweep waits for a verdict and is bounded). It does not
prove the end-to-end ordering on a real boot, which would need a deterministic interleave
of two module inits inside one process — the harness spawns whole binaries and cannot
schedule that. Stated here rather than implied: after ITEM-1 the race no longer produces
the reported symptom at all, so ITEM-3 is defence-in-depth for any future
`get_state()`-dependent boot work, and is tested at that level.
