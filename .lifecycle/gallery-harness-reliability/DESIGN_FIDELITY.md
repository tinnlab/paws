# DESIGN_FIDELITY — plan vs DESIGN.md invariants

- **INV-1** — fidelity: UPHELD — ITEM-1 fixes the CAUSE (quiesce the page's
  in-flight requests before `close()`, so the cancellation never happens); ITEM-3/4
  add muting only as the explicitly PAIRED arm the invariant permits, and are
  narrowed to `net::ERR_ABORTED|ERR_NETWORK_CHANGED` on a **dev-asset** URL so a
  `net::ERR_*` on a product `/api` URL still gates — the "blind to genuine
  transport failures" failure mode the invariant names is not introduced. ITEM-2
  keeps a non-quiescing page visible instead of silently absorbed, and ITEM-5 makes
  residual contamination self-reporting rather than something a human must notice.
  The acceptance test (TEST-1) asserts the CAUSE fix directly by driving a real
  lazy-import cell and asserting zero cancellation artifacts with the muting
  classifier DISABLED — so a plan that shipped only the mute would fail it.

- **INV-2** — fidelity: UPHELD — ITEM-6 is measurement-first and blocks by
  construction: it writes `FLAKE_STUDY.md` from N≥5 real runs before any D2 fix is
  designed, and the plan's Non-goals section records that the measurement is
  allowed to contradict the chosen branch. ITEM-7/8 then implement the invariant's
  second named option ("require a finding to reproduce across runs before it
  gates") rather than the first ("make cell mounting deterministic"), which the
  invariant explicitly offers as an either/or. ITEM-9 delivers the invariant's
  closing clause — the gate can now tell "new failure" from "flaky failure".

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
