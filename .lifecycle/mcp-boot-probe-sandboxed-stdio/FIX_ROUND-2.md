# FIX_ROUND-2 — mcp-boot-probe-sandboxed-stdio

Round 1 ended with the gate's own T1 estimate reporting **~2.33 promotable
findings still unfound**, and my FIX_ROUND-1 nonetheless declared termination.
That claim was wrong and I ran round 2 anyway. Two fresh angles, differing in
kind from both round-1 lenses: **security/authz** and **operator-experience**.
15 more findings.

## The one that matters: the reported bug was never actually fixed

**F-17 (HIGH).** Add a system MCP server, enter `command: Rscript`, tick **Run
in sandbox**, flip **Enabled**:

> Command 'Rscript' is not allowed on the host. Allowed commands: [...].
> **Enable run-in-sandbox to use any command.**

…and the switch snaps back off, so the server is created disabled. That is the
reported message, the reported advice-you-already-followed, and the reported
silent disable — on the first screen an admin meets, after two commits and one
full audit round claiming to have fixed it.

Create mode sends no `id`, so `existing` is `None` and the sandboxed branch
cannot fire; `build_ephemeral_server` hardcodes `run_in_sandbox: false`, so the
new `stdio.rs` branch cannot fire either. **Round 1 saw this** — both auditors
noted the id-less case — but as a "related, lower" aside, and I filed it as
DEC-4's follow-up without walking the screen. The operator angle, whose whole
brief was to walk what an admin sees, rated it HIGH immediately.

The lesson worth keeping: *the two round-1 angles both read the code correctly
and both under-rated the same fact.* What changed the rating was asking a
different question — not "is this code right?" but "what does the operator
see?".

## Second theme: messages that assert instead of check

**F-18** — the badge promised "connects on the first real tool call" and Test
Connection said "NOT a problem with the server" **without consulting whether the
sandbox exists**. On `code_sandbox.enabled: false` both are reassuring
falsehoods about a permanently broken row. The auditor caught that my own second
commit, in deleting the inert wait, had removed the module's only sandbox-state
awareness. Fixed with `sandbox_skip_reason()`, which reads `init_status()` and
names the `SandboxAvailability` variant — the awareness back, without the wait.

**F-19/F-21** — `enforce_on_create` and the enable transition wrote *no* reason,
so a fresh sandboxed row showed the generic "Click Test Connection or toggle
Enabled" tooltip that my own code comment calls misleading, and the owner's
existing red row had no discoverable remedy (the sweep skips `enabled = false`
rows entirely). Both skips now record the shared reason, which gives that row
the exit an operator would actually reach for.

**F-20/F-22** — the enable toast claimed "connection test passed" when none ran,
while the drawer rendered "Connection test failed" for the same row at the same
instant; the toggle tooltip promised a probe that never runs and asserted
reachability it had just said was unestablished.

## Security: one win, three escalations

**F-28 is a WIN I had under-claimed.** The `existing.id` gating I made in round 1
for consistency is a **security fix**: on `origin/main`, `record_health_check` is
`UPDATE mcp_servers ... WHERE id = $1` with no ownership predicate, and both
handlers passed the unscoped `request.id`. Any holder of `mcp_servers::create`
could stamp `unhealthy` onto **any row in the table** — another user's server or
a system server. Closed symmetrically on both routes.

**F-29 (HIGH, pre-existing)** — `build_ephemeral_server` bypasses the policy that
force-sandboxes user stdio servers, so an id-less Test Connection with
`command: npx, args: [attacker-package]` runs `bun x <package>` on the host.
**Independently rediscovered by a second auditor on a second branch** — I
escalated the same finding on PR #16. It is re-escalated here, not fixed.

**F-30, F-31** — a sandbox-off deployment leaves a user unable to even disable
their own stdio server (every PUT 422s before reaching the field), and a
sandboxed row whose command *is* host-allowed spawns unsandboxed with no signal.
Both pre-existing; both escalated because this change makes such rows look
benign.

## Method note

A batch edit in round 1 asserted on a later item and aborted **before writing**,
silently losing three earlier replacements in the same batch (F-26). That is why
a stale doc survived a round that reported it fixed. Re-applied and verified by
grep rather than by trusting the tool's "ok".

## Termination

Every fix in this round is verified by execution, not reading: TEST-7 was proven
RED (`the create-time skip must record its reason; got None`), the parity oracle
was proven RED by a one-word mismatch, and the regression scope is 28/28.
Four findings remain **open** — F-29, F-30, F-31 and the earlier F-11/F-12 —
and every one of them is a decision for the owner about pre-existing behaviour,
not a defect a third round would close.

**New confirmed findings:** 15
**Unresolved drifts:** 0
