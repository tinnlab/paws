# HUMAN_FEEDBACK — paws-ui-polish

Each critique received, and what changed because of it. Recorded whether or not
it required a code change.

## HF-1 — the lead, on ITEM-5's test strategy (phase 4, before implementation)

> "Prefer a DETERMINISTIC gate… treat any racing end-to-end spec as
> corroboration rather than the gate itself. If you conclude a deterministic
> assertion cannot capture the user-visible symptom, say so explicitly and
> explain what the racing test does and does not prove, rather than presenting a
> flaky spec as the acceptance criterion."

**Resolution: adopted, and it decided the shape of the whole item.** The gates
(`start_races_test.rs`) each put the system into a state and assert, rather than
racing to land a request inside a moving window. The live end-to-end run is
reported as corroboration in `INFRA_INTEGRATION.md`, explicitly not as the gate.

The escape clause was also used honestly, twice: the duplicate-`enqueue` gate and
the validation-hand-off gate could NOT be made deterministic, so both are stated
as gaps in the test file and the PR body rather than shipped as timing-dependent
specs. The first was written three times and removed after every version passed
WITH the defect present.

## HF-2 — the owner, on the hub skill and the desktop spec (phase 7)

> "KEEP the seeded-hub-skill removal. DROP the desktop e2e spec — do not ship it…
> remove the spec rather than leaving it skipped or ignored, and say in TESTS.md
> and the PR body what is therefore uncovered — per your own DEC-10, an honest
> gap beats a test that cannot run. hub_version DOES need the bump."

**Resolution: all three done.** The seeded skill removal stands (`hub_version`
2.0.0 → 2.1.0, 29 items, 0 skills, asserted by `catalog_v1.rs`). The desktop spec
is deleted — not skipped, not ignored — and the uncovered surface (the rendered
one-row geometry under the desktop module set) is stated in TESTS.md, in
TEST_RESULTS.md and in the PR body. Its TEST-ID was retired rather than carried,
so the phase-8 gate is not asked to excuse an ID for a test that does not exist.

## HF-3 — the owner, on the ITEM-5 redesign (phase 7)

> "option (b) — make ensure_running aware a validation is in flight for that
> model, wait for it, and reuse the engine." Plus two constraints: "'loading' and
> 'crashed' must become distinguishable states — a fix that only widens the
> timing window would leave a user able to brick a model by sending a few
> messages too early"; and "either ship the changed default or demonstrate the
> fix at the value that actually ships, because a green run under a config no
> user has is not evidence."

**Resolution: both constraints met, and the second one changed the outcome.**

- `Liveness` gains a `Starting` variant that records NO health event, so a slow
  load can no longer feed the flap cap. The distinction is temporal, not
  categorical: past the auto-start budget the engine is treated as crashed, which
  preserves the wedged-engine recovery path that `Crashed` used to provide. That
  regression was caught in round 3 by auditing my own fix, not by the reviewer.
- The shipped default moved 30s → 180s (migration `202607220200`) rather than
  being set by hand, and the passing run was performed on a fresh first-boot
  instance that reported `row=180 / coldefault=180` BEFORE any manual edit.

The owner's instruction to "verify empirically against the live reproduction" is
what found four of the five defects; reasoning had found one.

## HF-4 — the lead, on idle time and stopping to report (phase 8)

> "83 percent idle… when you finish a phase and nothing genuinely requires the
> owner's judgement, append your findings to STATUS.md and CONTINUE into the next
> phase in the same turn rather than stopping to report. Stop only when you
> actually need a decision… Your last three stops were all reports, not
> questions."

**Resolution: adopted for the remainder of the branch.** Phases 7, 8 and 9 ran
without stopping; findings went to STATUS.md as they landed. Recorded here
because it is process feedback that changed how the work was executed, and the
next worker on this repo should inherit it rather than rediscover it.

Also from the same message, a housekeeping item: two stale `tauri build --debug`
processes and two app instances from this worktree were still running. They have
since been terminated, and the final review instance is the only process this
branch leaves behind (its port and data dir are in STATUS.md).

## HF-5 — the owner, on scope (phase 8)

> "drop the separate PR for defects A and B… make sure both defects are written
> up somewhere durable he can hand to a new worker… Those become briefs, not
> commits."

**Resolution: done, and no second branch was started.** BRIEF-A (the misleading
git auth error, `Cred::default` / `stdio.rs:341`), BRIEF-B (the bare-origin
seeded repository, `download_instances` row `561b45f5`) and BRIEF-C (a model
created from a 134-byte LFS pointer is accepted) are written into
`paws-ui-polish.STATUS.md` with their evidence. None is fixed on this branch.

Because BRIEF-B is not fixed, the review instance's notes tell the reviewer to
exercise item 5 via the Onboarding default-model step or the
`Hugging Face (tinnlab, anonymous)` repository — choosing `Hugging Face Hub`
composes a dead URL and fails with BRIEF-A's misleading error.

## Not human feedback, but recorded because it changed the work

Three of my own gates passed while their defect was present and were rewritten
rather than kept (`FIX_ROUND-2..4.md`). Two fixture defects were caught by
running negative controls, not by the tests going green. This is noted here
because the discipline that caught them — reverting each fix and requiring the
gate to fail — came directly from HF-1's framing.
