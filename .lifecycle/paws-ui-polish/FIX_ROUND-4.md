# FIX_ROUND-4 — paws-ui-polish

Fixed round 3's finding, then re-audited **round 4's own diff**.

## Fixed from round 3

The wedged-engine recovery regression: `Liveness::Starting` now treats the
auto-start budget as the deadline on the "still loading" claim. Inside it, no
health event is recorded (a slow load never counts against the flap cap); at the
bound the engine is stopped, the row marked, `HealthEvent::Crashed` recorded and
a restart attempted — the pre-existing recovery path, preserved. Pinned by
`g2d_wedged_engine_is_reclaimed_not_waited_on_forever`, verified RED.

## New confirmed finding in round 4's diff

**1 — `g2d` could leak a SIGSTOPped process on a shared box.**

The test stops the engine with `SIGSTOP` and relied on the production reclaim
path to kill it. On the FAILING path that never happens: an assertion panics, the
test aborts, and a stopped process is left behind that cannot exit on its own and
that nothing will reap. This box is shared with other worktrees, so that is
somebody else's problem, not just this test's — and a test whose failure mode
degrades the machine discourages exactly the negative-control runs that found
half the defects on this branch.

Fixed by capturing the outcome, cleaning up (`SIGCONT` then `SIGKILL`, in that
order so the kill is not queued behind the stop) and asserting afterwards.
Verified: after a full gate run, zero stopped `stub-engine` processes remain.

## Re-audit result

No further findings. The round-4 diff is one test-hygiene change plus the round-3
recovery hunk, and the recovery hunk was re-read against its three risks:

- **`stop()` on a SIGSTOPped child** — `kill()` sends SIGKILL, which is delivered
  to a stopped process; `g2d` passing is the evidence, not the reasoning.
- **Fall-through to the single-flight claim** — a concurrent caller arriving
  between the stop and the respawn sees `NotRunning` and claims the slot
  normally; the single-flight is what serialises them, and it is now
  cancellation-safe.
- **Flap accounting** — a persistently wedged engine now records one crash per
  `ensure_running` that reaches the bound, each costing the full budget, so it
  takes five such calls to be marked failed. That is the intended behaviour for
  an engine that genuinely never comes up, and it cannot be reached by a merely
  slow one.

## Profile

| round | new confirmed |
|---|---|
| 1 | 1 |
| 2 | 2 |
| 3 | 1 |
| 4 | 0 |

Round 4 yields **0**, and the profile decayed (1, 2, 1, 0) with the peak behind
it. Rounds 2–4 were consequences of this branch's own item-5 redesign rather than
new territory, and each was surfaced by a mechanism that keeps working — a
negative control, a suite run — rather than by re-reading the same diff. No round
had ≥60% of its findings in one guard file, so GUARD-SUB does not apply, and the
ABORT condition (flat/rising at round ≥5) was never approached.

**Converged.**

**New confirmed findings:** 0
