# HUMAN_FEEDBACK — visual-gate-red

The task brief carried one framing assumption that measurement contradicted, so it
is recorded here verbatim rather than quietly worked around.

- **FB-1** [status: resolved] — "`npm run gate:ui`'s **visual** leg (Layer B pixel
  regression, `playwright.visual.config.ts` / `tests/e2e/visual/`) fails on main …
  These are `toHaveScreenshot` assertions, so a red spec means 'pixels differ from
  the blessed baseline' — which can mean the UI regressed, OR that the UI
  legitimately changed and nobody re-blessed." → Measured: **none of the 7
  failures is a `toHaveScreenshot` assertion, and no baseline is involved.**
  `chat-collapse-borders.spec.ts:29-33` states it deliberately avoids
  `toHaveScreenshot` because Layer B baselines are gitignored;
  `overlays.spec.ts:85` gates its screenshot behind `SNAPSHOTS_ENABLED`, which is
  off in the gate's default invocation. Both are behavioural assertions on live
  DOM. The regression-vs-stale question the brief asked is still the right one —
  it just resolves as **stale TEST vs regression**, not stale BASELINE. Answered
  per spec in `PLAN.md` §*Measured root causes* and `REPRO.md`. Nothing was
  re-blessed; there was nothing to re-bless. [generalizable: yes — before
  classifying a red visual spec as "stale baseline", confirm the assertion is
  actually `toHaveScreenshot`; a spec living under `tests/e2e/visual/` is not
  evidence that it is a pixel test, and the two failure classes have opposite
  correct responses]

- **FB-2** [status: resolved] — "An earlier note referenced these as 'issue #183' —
  check whether that's a real tracked issue in this repo before relying on it; it
  may just be a comment." → Checked: `#183` appears only as prose inside the
  `chat-collapse-borders.spec.ts` header, the `chat-deep.ts` fixture comment and
  the `f9071cd3f` commit message. There is no issue tracker reference in the repo
  and no `gh` issue was consulted, so it is treated purely as the historical NAME
  of the defect, never as authority. Nothing in this branch depends on it.

- **FB-3** [status: resolved] — "Note `chat-collapse-borders` and `overlays` are
  different surfaces, so this may well be two unrelated causes … But do check
  whether one shared change (a border token, a radius, an overlay z/height rule)
  explains both." → Checked and it does not. The two causes are independent, land
  ~10 days apart, and neither touches a token, radius or z rule: one is the
  activity rail removing a component class, the other is a gallery story rendering
  an overlay panel inline. Reported as two, with two separate responsible commits.

- **FB-4** [status: resolved] — "A disproved finding is a valid result — if a spec
  turns out to be flaky rather than failing, say so with a rate over repeated
  runs, don't guess." → The ORIGINAL 7 failures are deterministic, not flaky
  (reproduced identically here and, per the brief, on two other worktrees). But
  flakiness did appear DURING the repair, and it is reported with rates rather
  than adjectives: see `TEST_RESULTS.md` §*Flake-rate ledger*, which records every
  intermediate rate (5/5 red → 1-in-5 → 2-in-6 → 0-in-6) and what each round
  changed. Two of those rounds were fixing real product defects that the flake
  rate was measuring.
