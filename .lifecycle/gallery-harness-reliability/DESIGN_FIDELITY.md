# DESIGN_FIDELITY — plan vs DESIGN.md invariants

- **INV-1** — fidelity: UPHELD, but by a DIFFERENT cause than the design names.
  The design's stated cause — `page.close()` cancelling in-flight module imports —
  **does not reproduce** (four probe variants, zero events; DRIFT-1.1), so the
  quiesce fix it prescribes would have been a fix for nothing. The invariant's
  actual demand is *"fix the cause, not the symptom … muting must be PAIRED with
  the cause fix, never instead of it"*, and that is met against the mechanism that
  DOES reproduce (DRIFT-1.2/1.4b — the harness moving under the crawl, via three
  observed triggers): the **host lock** removes the concurrent-run trigger, the
  **run-validity gate** VOIDs any run affected by any trigger, and the classifier
  arms are the paired backstop only. The muting is proven narrow in BOTH
  directions by TEST-1 (a `net::ERR_*` on a PRODUCT url still gates; a crash is
  muted only with same-module corroboration), so the "blind to genuine transport
  failures" outcome the invariant warns about is not introduced. **Reported to the
  owner as a disproof rather than papered over** (HUMAN_FEEDBACK FB-1), which is
  what they asked for.

- **INV-2** — fidelity: **AT-RISK — HALF MET, and deliberately so.** The
  invariant has two clauses. The FIRST ("investigate before fixing … establish the
  flake rate") is fully discharged and was decisive: the measurement
  (FLAKE_STUDY.md) shows two runs, both VALID by the new gate (248/248 cells,
  origin alive, **0 transport artifacts**), disagreeing 8 vs 2 gating HIGH — which
  FALSIFIED the working hypothesis that D2 was the same root cause as D1/D3 and
  would be fixed by the lock. The SECOND clause (the mechanism — "require a
  finding to reproduce across runs before it gates") is **NOT implemented**:
  ITEM-7/8/9 are descoped, the lifecycle gate is holding phase 3 RED for want of
  the owner's sign-off, and no `[approved: …]` token was written because that
  would be self-certification. This is recorded as an open item
  (HUMAN_FEEDBACK FB-5), not as a silent cut — the owner can approve the descope
  or ask for the mechanism on this branch.

- **INV-3** — fidelity: UPHELD — ITEM-10 takes the invariant's first named option
  (a host-level lock) rather than the weaker second. The invariant's second
  sentence ("per-worktree `node_modules` isolation does NOT protect against this")
  is honoured by scoping the lock to the HOST (`$TMPDIR`), not to a worktree —
  ITEM-10's lock path is deliberately worktree-independent, which is what makes it
  cover the observed two-worktree case. TEST-6 is a real two-worktree concurrency
  proof, not a unit test of the helper.

- **INV-4** — fidelity: UPHELD — ITEM-13 goes past "detect" to "impossible": the
  prior `RUNTIME_FINDINGS.jsonl` + manifest are DELETED before the crawl, so there
  is nothing to inherit, and the run is additionally required to prove completion
  (manifest present, `complete === true`, matching `runId`,
  `cellsCompleted === cellsPlanned`). On any mismatch the per-surface table is not
  printed AT ALL — the specific artifact that misled a reader ("103/106 PASS") can
  no longer be emitted over stale data. That is "fail loudly, not inherit".

- **INV-5** — fidelity: UPHELD — ITEM-14 replaces the regex with a ts-morph AST
  pass over JSX attributes and object properties named `data-testid`, exactly as
  the invariant prescribes, and adds NO comment-stripper (the invariant's named
  anti-pattern). Comments become unreachable structurally: a comment is trivia, not
  an AST node, so no pattern needs to describe it. Note the plan STRENGTHENS the
  invariant's literal wording — "string-literal values" alone would drop six real
  ids that live in `??`/ternary value positions, so the pass walks value positions.
  That is a superset of the invariant's requirement, not a departure from it, and
  it is the difference between a correct pass and one that silently loses ids.

- **INV-6** — fidelity: UPHELD — ITEM-18 applies every behavioural change to BOTH
  live copies, ITEM-19 deletes the dead third copy that would otherwise drift again,
  and ITEM-20 adds a machine guard so the next fix cannot land in one tree only.
  The highest-risk logic (the classifier) is additionally single-sourced in
  `lib/finding-classify.mjs` that both copies import, so for that core the parity
  is by CONSTRUCTION rather than by discipline. TEST-11 is the executable proof.
