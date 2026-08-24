# FIX_ROUND-4 — final round

Angles: **correctness** + **design-conformance** (required), both blind, over
**round 3's diff only** (`90f141a55..HEAD`).

## What the round found

11 rows, and — unlike every prior round — **no new product defect**. The two
material findings were both regressions in my own round-3 work, and both were
oracle-confirmed by running rather than argued:

1. **My citation gate broke an existing unit test.** `citationTokenize` became a
   no-op while `citationTokenize.test.ts` still asserted the tokenizing
   behaviour. Both angles reproduced it independently (26 failures at HEAD vs 25
   with the one line removed) — the round's only corroborated finding, and the
   only one either angle rated HIGH. Fixed by giving the function the injectable
   hidden-set parameter its own helper already advertised: the regex-rule cases
   inject an empty set and keep testing tokenization, and a new case asserts the
   paws behaviour against the real list. That new case is the one that goes red
   if the gate is removed.
2. **A new JSX ternary made `check:state-matrix` red** — the first genuinely new
   `RequiredState` key on this branch (earlier staleness was line shifts only).
   Regenerated; `check:state-matrix` and `check:gallery-coverage` both PASS.

Everything else was doc/comment accuracy, including — for the second consecutive
round — **a stale count in the reduction's own source-of-truth header**, in the
commit that added "Keep this enumeration current". I stopped maintaining the
count by hand: the header now names the CLASSES of consumer and points at the
authoritative grep. A number that went stale twice in a row should not get a
third hand-maintained revision.

One judgement call worth naming: the design angle flagged two `AgentSettingsSection`
descriptions as inconsistent with three sibling copies I had gated. I **split**
them rather than treating them alike — gated the clause naming *workflow agent
steps* (a surface the user cannot reach, since no workflow can be authored), and
left the *scheduler's horizon backstop* sentence alone, because that ceiling
still applies server-side whether or not the scheduler has a UI. Trimming it
would misdescribe the setting to make a string disappear.

## Verification

- `tsc --noEmit` clean; `cargo check -p ziee --tests` clean.
- `citationTokenize` unit **3/3**; `paws_surface` integration **5/5**;
  `17-paws-surface` e2e **11/11**.
- `check:state-matrix`, `check:gallery-coverage`, `check:store-actions` PASS.
  `check:testid-registry` remains the known sdk blocker (DEC-13), unchanged.

## Termination

**Loop terminates. Reason: CONVERGED — a quiet round on a decaying profile.**

- Profile across rounds: **26 → 25 → 16 → 11**, and the last two rounds audited
  progressively smaller diffs. Monotonic decay, so the decreasing-detection model
  the estimate rests on is not falsified.
- **Zero new product defects.** Every round-4 finding was either a regression in
  the previous round's own work (2) or doc/comment accuracy (9). The audit has
  stopped finding things about the FEATURE and started finding things about the
  last round's edits — the signal that the artifact is settled.
- Promoted fraction collapsed: 1 corroborated + 0 unique product highs out of 11
  ⇒ **~0.09**, against 0.25 (r3), 0.32 (r2). Remaining × promoted is comfortably
  **< 1** on any reading.
- **GUARD-SUB: not triggered** across the whole loop — no round put ≥60% on one
  test/guard file, and the round-2 worry about test-code churn resolved on its
  own (40% → 30% → ~20%).

Four rounds, HEAVY tier, monotonic decay, a quiet final round, and an empty open
set. Proceeding to phase 8.

**New confirmed findings:** 11
