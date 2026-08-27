# FIX_ROUND-1 — paws-ui-polish

Merged the phase-6 ledger (18 confirmed findings), fixed or explicitly accepted
every one, then re-audited **this round's diff**.

## Disposition of the 18

| state | n |
|---|---|
| fixed | 16 |
| accepted (with rationale, in the ledger) | 2 |
| rejected as false positives | 0 |

The two accepted are recorded in the ledger with reasons, not waved through:

- **#11 — the single-pass gate for INV-5.** The finding was right and the
  response was to act on it rather than argue: three versions of that gate were
  written and **every one passed with the duplicate `validator::enqueue` still
  present**. `validation_status` cannot count passes — the worker pops the next
  queue entry immediately, so the terminal write between two back-to-back passes
  is a single DB write that no affordable poll rate catches. The gate was
  REMOVED and the gap stated in `start_races_test.rs` and the PR body. Shipping
  a test that is green with and without the defect would convert "tested" into a
  false claim.
- **#18 — orphaned extracted skill directories.** Real, unfixed, no behavioural
  effect (with no row the skill is neither listed nor injected). Deliberately not
  fixed for the same reason the migration names its three targets instead of
  reconciling: a general "delete anything no longer embedded" sweep would delete
  a built-in the moment a build shipped without it, including a broken build.

## The item-5 redesign happened inside this round

The owner directed option (b) — make the start path aware of an in-flight
validation, wait for it, and reuse the engine — plus two constraints: "loading"
and "crashed" must become distinguishable states, and the fix must be
demonstrated at the timeout value that actually ships.

Reproducing rather than reasoning found **five** defects, not one. Each was
exposed by a run failing, and each alone leaves the symptom intact:

1. **Duplicate Tier-2 enqueue** — two spawn/health/SIGTERM cycles per creation.
2. **The single-flight was not cancellation-safe.** `OnceCell`'s init future ran
   inline in whichever caller arrived first; the validator's outer `timeout`
   dropped it mid-spawn while the child kept running, and `OnceCell` handed init
   to the next waiter, which collided with the live child. The collision landed
   **90s after the spawn, to the second** — the old flat deadline.
3. **`status()` reported a zombie as running.** `Child::id()` keeps returning
   `Some` for an unreaped child. This also *defeated* fix (4): `Starting` would
   read a dead engine as "still loading" and wait forever — strictly worse than
   the behaviour it replaced, which is why (3) and (4) cannot ship apart.
4. **`Crashed` and "still loading" were the same state**, so a slow load fed the
   flap cap and a user could brick a model by sending too early.
5. **Validation killed the engine its own waiter was waiting for.** Measured:
   `stopped gracefully` 0.4ms before the chat's `Finalize called`, empty message,
   no error logged anywhere.

Plus the shipped-default change: `auto_start_timeout_secs` 30s → 180s
(migration `202607220200`), safe to raise only because `do_start` now fails fast
when the child exits.

## Re-audit over this round's diff

Three angles over the round's own changes (`correctness`, `design-conformance`,
`tests-quality`). It produced **one** new confirmed finding, and it came from the
negative-control discipline rather than from reading:

- **A sixth product defect, found by a gate.** `LocalDeployment::start()` used a
  bare `contains_key`, so a dead child's stale map entry permanently refused
  every restart with `Model instance already running`. Because `ensure_running`
  counts a failed start as a crash, a user whose engine died out-of-band could
  brick the model by retrying a few times — the same bricking class the owner
  asked to close, through a different door. Found by
  `g2b_engine_killed_out_of_band_recovers_without_waiting_out_the_timeout` going
  from `in restart backoff` to `marked failed (flap protection)`. Fixed by
  reaping the entry via `try_wait()` and replacing it; the gate is now green and
  was verified RED against the revert.

Two further defects were found in **my own test fixtures**, by the negative
controls rather than by the tests passing. Both are recorded because a gate that
has never been red is not a gate:

- the stub's die-on-load sentinel exited **before** binding, while real llama.cpp
  **binds then dies** (its own log puts `binding port` before `loading model`),
  so `g2c` measured a path the fix does not live on and passed with the fix
  reverted;
- `g2c` originally drove `POST /start`, which calls `deployment.start()` directly
  and never enters `do_start`'s health-poll loop at all.

Every surviving gate was run against its own fix reverted and observed to FAIL,
reproducing the pre-fix signature: `g2a` reproduces `Model instance already
running already exists` verbatim; `g2b` reproduces `marked failed (flap
protection)`; `g2c` took **120.2s** against a 120s timeout versus its 30s bound.

## Profile

Round 1 confirmed: 18. Round 1 re-audit new confirmed: 1 (product), plus 2
fixture defects in this round's own test code, all fixed within the round.

**New confirmed findings:** 1
