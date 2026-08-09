# HUMAN_FEEDBACK

**No human feedback received.** The feature was implemented, audited and tested
without a human review pass in this session. This file exists as the deliberate
claim that absence is absence — not that review happened and produced nothing.

The branch is **not pushed** (per the task constraints), so nothing has reached
a human reviewer yet. When it does, the two things worth reviewing first are:

1. **The scope grew from 3 endpoints to 12 query parameters + 6 body fields.**
   That growth is evidence-backed (`REPRO_PRE_FIX.txt` records a measured 500 for
   every one) and it is what "fix the class, not the symptom" means here — but it
   is a judgement call a human may want to re-scope.
2. **`DEC-7` deliberately did NOT tighten `background/runs?status|kind` into
   enums**, and `DEC-14` deliberately did NOT build a source-derived inventory
   check. Both are real findings, recorded rather than fixed, because each is a
   separate change with its own blast radius.

## Candidate generalizable rules harvested from the blind audits

Recorded here because they are not specific to this feature, in the shape the
orchestrator harvests:

- `[generalizable: yes — A "shared helper" refactor must classify each call site
  by what the OLD code did, not by what the helper conveniently offers. Replacing
  a raw bind with a trim+blank→None normalizer silently widens a filter from
  "match the empty string" to "no filter at all". Adopt the two-entry-point shape
  (guard-only vs normalize) so the choice is forced at every site.]`
- `[generalizable: yes — A regression test for a "filter must still filter" bug
  is a TAUTOLOGY on an empty table: filtered and unfiltered are both zero. Seed
  rows AND assert the unfiltered baseline is non-empty, then mutate the fix and
  watch the test go red. This branch shipped three such tautologies and only
  caught them because a blind angle asked "would this pass with the fix
  reverted?"]`
- `[generalizable: yes — Never whole-file `rustfmt` a file you touched: this repo's
  main is not fmt-clean, so it buries ~10 semantic lines under ~200 of churn and
  inflates the merge-conflict surface. Format only the hunks you wrote.]`
- `[generalizable: yes — `source tests/.env.test` without `set -a` does not export
  to child processes; every provider-configuring test then panics with "No AI
  provider API keys found". A 79-failure log that is really one missing shell flag
  is exactly what gets mis-reported as a regression. Always `set -a && source … &&
  set +a`, and confirm one failing test passes in isolation before believing a
  bulk failure count.]`
- `[generalizable: yes — A doc-comment edit inside a git SUBMODULE does not ship:
  it is absent from the parent repo's diff and from every commit unless the
  submodule is committed AND pushed. Put shipping guidance in a file the consuming
  repo actually tracks.]`

## Operator note (not a code finding)

While cleaning up a contended test run I ran `pkill -f "testharness-"`, which
also killed a test server belonging to a DIFFERENT worktree
(`.claude/worktrees/agent-aa149e0a86853a522`). Recorded plainly rather than
quietly: a broad `pkill` on a shared box is not worktree-scoped, and the correct
form targets this worktree's own PIDs.
