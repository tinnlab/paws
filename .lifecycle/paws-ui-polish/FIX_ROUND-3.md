# FIX_ROUND-3 — paws-ui-polish

Fixed round 2's two findings, then re-audited **round 3's own diff**
(`correctness`, `design-conformance`, `tests-quality`).

## Fixed from round 2

- `stop()` now asks `try_wait()` before killing, so an already-reaped child
  produces an informational line instead of `Failed to kill process for model …`
  on the one path where the engine had exited cleanly on its own.
- `settings_test::{get_returns_defaults, partial_patch_preserves_other_fields}`
  updated from 30 to 180, with a comment naming migration `202607220200` and the
  measurement behind it.

## New confirmed finding in round 3's diff

**1 — a regression THIS BRANCH introduced, caught before it shipped.**

Before `Liveness::Starting` existed, an engine that was alive but not answering
`/health` was reported `Crashed`, which marked the row stopped and let the caller
restart it. **That was the recovery path for a wedged engine** — an engine that
loaded fine and then deadlocked or thrashed. Nothing else provides one:
`reaper.rs::monitor_health` → `report_health` only records the state transition;
it never stops or respawns.

Adding `Starting` so a slow LOAD is not counted as a crash therefore converted
"wedged engine self-heals" into "wedged engine is waited on as though it were
still loading, and stays registered as running forever". A user would see every
request to that model hang for the full auto-start budget, indefinitely, with no
way back short of an admin stop.

The fix keeps both properties by making the distinction TEMPORAL rather than
categorical: loading is a claim with a deadline. Inside the auto-start budget a
live-but-unhealthy engine is `Starting` and no health event is recorded. At the
bound it is treated as crashed — stopped, row marked, `HealthEvent::Crashed`
recorded, restart attempted — exactly as before. So a merely-slow engine still
never counts against the flap cap, and a wedged one still self-heals.

Pinned by `g2d_wedged_engine_is_reclaimed_not_waited_on_forever`.

## Two vacuous gates caught and fixed BEFORE being believed

Both were caught by running the negative control, not by the test passing:

1. **G2d asserted the wrong property.** Its first version asserted only that the
   request returned within a bound. That passed with the recovery reverted,
   because *both* versions return a bounded error — the bound is the auto-start
   budget either way. It measured nothing. The property that actually differs is
   whether the wedged engine is RECLAIMED, so it now asserts the model stops
   reporting `running`.

2. **G2d's fixture could not reach the state under test.** Its second version
   used the `stub-unhealthy` path sentinel, which is unhealthy from the *first*
   probe — so no instance row is ever persisted, `probe_liveness` answers
   `NotRunning`, and `do_start`'s own timeout reclaims the process. The
   `Starting` arm was never entered, and the test passed with the recovery
   reverted for a second, different reason.

   The state needs an engine that was healthy and *then* stopped responding. A
   stub endpoint to flip health was written and then **reverted**: the engine the
   server actually spawned did not serve it (404) even though the rebuilt binary
   did standalone, and chasing that was not worth it. `SIGSTOP` is better anyway
   — the kernel still reports a live, unreaped process, so `status()` says
   running and `Liveness` says `Starting`, and it models a real deadlocked engine
   rather than one that politely self-reports.

## Negative controls — every surviving gate

| gate | reverted fix | observed RED |
|---|---|---|
| `g2a` | detached leader → `OnceCell` | `Model instance already running already exists` (the live-reproduction string, verbatim) |
| `g2b` | `start()` stale-entry reap | `engine for this model is marked failed (flap protection)` |
| `g2c` | `do_start` fail-fast | 120.2s against a 120s timeout, vs the 30s bound |
| `g2d` | wedged-engine recovery | model still reports `running` |

## Profile

| round | new confirmed |
|---|---|
| 1 | 1 |
| 2 | 2 |
| 3 | 1 |

Rounds 2 and 3 were both dominated by consequences of this branch's own item-5
redesign rather than by new territory, and each was found by a mechanism that
keeps working (a negative control, a suite run) rather than by re-reading. The
profile is not yet decayed, so round 4 follows. It is well short of the ABORT
condition (flat/rising at round ≥5), and no round has ≥60% of its findings in one
guard file, so GUARD-SUB does not apply either.

**New confirmed findings:** 1
