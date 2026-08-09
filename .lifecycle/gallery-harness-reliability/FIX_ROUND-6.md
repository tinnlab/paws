# FIX_ROUND-6 — blind audit of the RE-SCOPED artifact (ITEM-25)

The validator's ABORT required restarting the loop against the new artifact, not
running another round against the old one. The new artifact is much smaller: a
deletion (two forks) plus two config keys. Audited blind
(correctness + behavioural-equivalence) against a frozen tree.

## The headline is a clean equivalence result

The auditor recovered BOTH deleted forks from git and diffed them against the
shared scripts, axis by axis — gallery dir, `portWhich` (resolved live: desktop
**22076** vs web **20076**), gallery URL, dev command, lint commands, the
runtime-baseline module (a static import in the fork, config path now), and the
host-lock owner. **Every axis is reproduced by config.** Two extras it checked
that I had not: `enumerateSurfaces` moved from the desktop-local
`gallery-surfaces.mjs` to the sdk one (diffed — only adds an `interactions` key
`runtime-health` never reads, so crawl enumeration is unchanged), and the shared
script *adds* a PORT-validity guard the fork lacked.

It also confirmed `gateExtraCmds` **does not fail open**: driving the real
`gate-ui.mjs` with a failing extra step gives `FAIL coverage` and **exit 1**;
mis-shaped entries throw to `main().catch` and exit 2. And the web workspace is
unaffected (`test:gate-ui-stale` green — the pre-existing-consumer control).

## What it found, and what I fixed

- **F1 (MEDIUM)** — a typo'd `gateExtraCmds` **silently deleted a gate stage**:
  no line printed, no warning, exit 0. Moving a hardcoded stage into config
  created a new silent-misconfiguration class. `resolveGalleryConfig` now refuses
  unknown keys.
- **F2 (MEDIUM)** — run from the wrong cwd, the now-shared scripts silently
  adopted the **web** defaults, including a `portWhich` that points a desktop run
  at the web gallery's port. Both entry points now refuse to run without a config
  in cwd. (A bad PORT already failed loudly; a missing config did not — that
  asymmetry is closed.)
- **F3 (MEDIUM, evidence)** — the sharpest one. TESTS.md claimed TEST-38 as proof
  of desktop equivalence, but the only desktop transcript in `TEST_RESULTS.md`
  read *"every **desktop** UI DONE criterion met"* — a string **only the deleted
  fork emits**. The real post-unification run had been made and simply never
  written down, so the artifact pointed at pre-unification evidence. Recorded
  properly now, with the strings that distinguish it.
- **F4/F5/F6/F7 (LOW)** — a stale CLAUDE.md claim naming a deleted path; an extra
  step reported `FAIL` when it never ran; `--skip-coverage` silently widened with
  a reason naming a non-existent flag; and TEST-40's claim that the CLI states its
  own limit, which nothing asserted. All fixed.

## Deferred, deliberately

- **Scope**: "exactly ONE implementation" covers TWO filenames. `desktop/ui/scripts`
  still carries its own `gallery-surfaces.mjs`, `capture-gallery-*.mjs`,
  `gen-overlay-registry.mjs`, `gen-state-matrix.mjs`, `gen-gallery-coverage.mjs`
  beside sdk equivalents — and its `gallery-surfaces.mjs` **has already drifted**.
  Same defect class, different files, outside this branch's remit.
- **`mountGallery` handover** — see HUMAN_FEEDBACK FB-11.

## Note on the convergence profile — it spans TWO artifacts

The validator reads one profile across rounds 3-6 and calls it flat. That mixes
incomparable rounds: rounds 3-5 audited the **regex parity guard** (the artifact
that was ABORTED and then REPLACED), and round 6 audits the **re-scoped artifact**
— a deletion plus two config keys. By the validator's own ABORT instruction the
loop was to be restarted against the new artifact, so round 6 is round *one* of
that restart, not round four of the old one.

Reported rather than worked around: I am not going to relabel rounds to make a
profile decay. Phase 7 stays RED until a re-audit of THIS artifact's fixes gives
an honest convergence signal (round 7), which is the same standard I applied when
I refused round 3's unaudited zero.

**New confirmed findings:** 7
