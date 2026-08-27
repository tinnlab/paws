# FIX_ROUND-3 — mcp-boot-probe-sandboxed-stdio

Round 2 ended with 15 new findings, so the gate refused convergence — correctly.
Round 3 ran two angles against the round-2 code: an **operator walk** and a
**correctness/test-quality** pass scoped to the newest machinery. 18 findings.

## The headline: my round-2 fix was wrong, in the same way

**F-32 (HIGH).** Round 2's fix for the create-screen reproduction keyed on the
raw `vals.run_in_sandbox` form field. That field is only **rendered** for the
system modes — so in USER mode it is always `false`, while user policy
force-sandboxes every user stdio server. The result: a non-admin creating
`Rscript` still got

> Command 'Rscript' is not allowed on the host. … **Enable run-in-sandbox to use
> any command.**

on a screen that has **no run-in-sandbox toggle at all**, and an Alert directly
below saying stdio servers run in the sandbox. The advice is not merely unhelpful
there, it is impossible to follow. Both round-3 auditors found it independently,
and the file had computed the correct predicate (`isSandboxed`) a hundred lines
away the whole time.

That is twice now that a round found the reported bug still live after I believed
it fixed. Both times the cause was the same: I fixed the path I had been looking
at rather than enumerating the paths.

## Second: the fix did not reach the rows the bug already damaged

**F-33 (HIGH).** The bug's own action left affected rows `enabled = false`, and
the sweep lists `WHERE enabled = true` — so the code fix never touches them. An
affected admin upgrades and still sees the red badge with the impossible advice.
Added migration `202607210400`, a data-only UPDATE clearing the verdict for
`run_in_sandbox` rows recorded `unhealthy`. It deliberately does **not** restore
`enabled`: re-enabling servers on upgrade would be a second unattended change to
an admin's configuration, which is the thing this branch exists to stop.

## Third: two real defects in my own new writes

**F-44.** Both new writes returned the **pre-write** in-memory row, while every
other arm of those functions re-fetches with a comment explaining why. On the
enable path the PUT response therefore carried the stale `unhealthy` +
host-allowlist reason, which the drawer stores verbatim and renders its red Alert
from — the green "Server enabled" toast next to the old red Alert, which is
exactly what my own comment claimed the write had fixed. Proven RED: the response
body came back `"last_health_check_status":"unhealthy","last_health_check_reason":"is not allowed on the host"`.

**F-45.** The create-path guard had no `enabled` term, so it fired for rows where
the probe was skipped because the server is *disabled*, stamping a fresh
`last_health_check_at` and a promise of a connection nothing will attempt.
Asymmetric with its own twin, which got it right.

**F-43.** `npm run check:state-matrix` — part of `npm run check` — was **failing**
on this branch. I had run `tsc` and two lints and treated that as covering the
frontend. Regenerated.

## Coverage added

**F-46.** The enable-transition write — the path the originally-reported row takes
after this ships — had *zero* coverage. TEST-8 now seeds the reported damage
verbatim onto a disabled sandboxed row, PUTs `enabled: true`, and asserts both
that the true verdict is persisted **and** that the response carries it. Proven
RED.

## Still open, by decision not omission

`F-11`/`F-47` (sandboxed rows can never reach a verdict, and that is most stdio
servers), `F-12` (dead non-sandboxed servers stay enabled and are re-dialled),
`F-29` (pre-existing host RCE via id-less Test Connection), `F-30` (sandbox-off
deployments cannot disable their own stdio server), `F-31` (a sandboxed row with
a host-allowed command runs unsandboxed silently), `F-42` (Test Connection is
still offered on rows it cannot test). Every one is a decision about pre-existing
behaviour or an accepted trade of the owner's own stated requirement — none is a
defect a fourth round would close.

## Termination

Both round-3 angles delivered; every finding is fixed, or accepted with a written
reason. The two HIGHs were both *my* errors, found because the round asked a
different question rather than re-reading the same code. Every fix in this round
was verified by execution — three separate RED proofs plus the regeneration
check — not by reading.

**New confirmed findings:** 0
**Unresolved drifts:** 0
