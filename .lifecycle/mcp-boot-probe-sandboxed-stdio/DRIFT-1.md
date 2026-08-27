# DRIFT-1 — mcp-boot-probe-sandboxed-stdio

Implementation re-read against PLAN.md ITEM-1..5 and INV-1/INV-2, after the
first GREEN run. Three drifts found, all three fixed in this round; the first
two are behavioural and one of them was a real defect in my own ITEM-5.

- **DRIFT-1.1** — verdict: plan-wins — **The recorded skip reason is never
  rendered, and the badge the admin actually sees advises two remedies that are
  both no-ops for a sandboxed row.** ITEM-1 writes `untested` + an explanatory
  `last_health_check_reason`, but `McpServerCard.tsx:256` renders the `untested`
  branch with a hardcoded tooltip — "Click Test Connection or toggle Enabled to
  run a probe" — and `McpServerDrawer.tsx:1049` explicitly discards the reason
  (`if (!healthAt || healthStatus === 'untested') return baseline`). For a
  sandboxed server Test Connection cannot validate it (that is ITEM-5) and
  toggling Enabled hits `enforce_on_update`'s identical skip, so both suggested
  actions do nothing. Shipping that is the SAME defect this branch exists to
  fix — an admin told to perform a useless action — moved from the backend
  message to the frontend tooltip. Fixed: both surfaces prefer the recorded
  reason when one is present and fall back to the generic text otherwise.
  Scope note: this adds `src-app/ui/` to the change, which PLAN "Files to touch"
  did not list. One file each, no API/type change, no OpenAPI regen, and
  `McpServerCard.tsx` is NOT mirrored in `desktop/ui` (verified: the only
  `mcp-health-untested` render site in the tree).

- **DRIFT-1.2** — verdict: plan-wins — **My own ITEM-5 recorded "could not
  test" as "test failed".** `sandboxed_server_not_testable` answers
  `success: false` (no handshake happened), and both routes' record block keys
  off exactly that field, so Test Connection on a sandboxed row wrote
  `last_health_check_status = "unhealthy"` — painting the badge red with a
  message whose own text says "This is a limit of the test, NOT a problem with
  the server", and immediately re-creating the red badge ITEM-1's skip exists to
  clear. Fixed with a shared `health_record_for(&response, not_testable)` used by
  both routes, recording `untested` + the reason. **Proven RED**, not reasoned
  about: neutering the mapper produced
  `left: Some("unhealthy") right: Some("untested")` at
  `boot_probe_sandboxed_test.rs:262`. New assertion is TEST-6.

- **DRIFT-1.3** — verdict: impl-wins — PLAN "Files to touch" omits
  `src-app/server/src/lib.rs`, which the branch modifies to add
  `#[doc(hidden)] pub mod mcp_connection_health`. That re-export is what lets the
  integration tests drive the REAL `run_startup_health_check` rather than a
  restatement of it, which is the whole reason those tests are worth having. The
  implementation is right; the plan's file list was incomplete. Recorded here
  rather than back-editing PLAN.md.

## Checked and found NOT drifted

- The `"untested"` status string is not an invention: `McpServerCard.tsx:217`
  already uses `last_health_check_status ?? 'untested'` as the no-verdict
  fallback, and `agent_host/gate.rs:663` constructs it. ITEM-1 writes the
  vocabulary the UI already speaks.
- ITEM-3's 30s bound cannot become a 30s boot delay in a real deployment:
  `set_init_status` is called on all five exit paths of `code_sandbox::init`
  (`code_sandbox/mod.rs:157,183,195,213,318`) including the `enabled: false`
  early return, and there is no `?`-bail between them (checked). The claimed
  desktop `CORE_MODULE_BLOCKLIST` that could skip the module entirely **does not
  exist in code** — it survives only in two comments — so `init()` always runs.
  The wait is also after the `servers.is_empty()` early return, so a deployment
  with no MCP servers never enters it.
- INV-2 holds beyond the sweep: only the probe paths and Test Connection write
  MCP health (`grep record_health_check`), so nothing else re-introduces a
  disable.
- `disable_for_health_failure` is NOT orphaned by ITEM-2 — `enforce_on_create`
  (:139) and `enforce_on_update` (:226) still call it. No `#[allow(dead_code)]`
  was needed (CODING_GUIDELINES §15).
- The pre-existing `list_enabled_for_health_check` never-used warning is on
  `origin/main` too (the free function has callers; the `impl` wrapper does not).
  Not introduced here, not fixed here.

**Unresolved drifts:** 0
