# HUMAN_FEEDBACK — scheduler-settings-layout

Living ledger of feedback from the owner/orchestrator on THIS feature.

- **FB-1** [status: resolved] — *"the form layout is horrendous and does not look
  like any other settings pages"* (owner, on a live screenshot of
  `/settings/scheduler`; the labels wrapped one word per line — `Max`/`active`/
  `tasks`/`per`/`user` on five lines beside an input holding `20`) → rebuilt the
  Limits card on the canonical settings-form composition (`<Form
  layout="horizontal">` + `<FormField name label description>`, `w-40` numeric
  controls with the unit as a `suffix`, Save/Cancel in the Card `footer` via
  `SettingsFormActions`), mirroring `file-rag/RetrievalLimitsSection` for the
  form and `auth/SessionSettingsPage` for the page shell. Measured result: 5
  starved labels at 1280 and 768 before, **0** at 1280/768/390 after, with
  before/after screenshots at all three widths in both themes.
  [generalizable: yes — a settings form composes `Form`/`FormField`; a
  hand-composed `<Field orientation="horizontal">` with the label inside
  `<FieldContent>` and a `w-full` control beside it INVERTS the kit's
  horizontal-field contract and collapses the label column. Now mechanically
  enforced by `lint:settings-field` rule 2 (`starved-label-column`), inside
  `npm run check`.]

- **FB-2** [status: resolved] — *"Both the static lint AND the label-starvation
  check must fire on the Scheduler page as it was and NOT fire on the canonical
  sibling settings pages. Prove BOTH directions with real runs. A check that
  flags every settings page is worse than none."* (task brief) → proven for both
  checks by swapping only the page file on one tree. Static: 79 settings-scoped
  files inspected — **1 flagged** pre-fix (5 sites, all `SchedulerAdminPage`),
  **0** post-fix, and **0** non-scoped files would trip rule 2 either. Rendered:
  46 gallery page surfaces (35 `settings-*`) × 390/768/1280, 126 labels measured
  / 111 eligible — **5** starved pre-fix on exactly one surface, **0** post-fix.
  The 24/7-rig detector was verified the same way by executing its OWN source
  (sliced verbatim out of `live-ui-audit.mjs`): 5 findings pre-fix with identical
  metrics, 0 on four sibling settings surfaces, 0 post-fix.
  [generalizable: yes — a new gating check ships with BOTH directions proven on
  the real corpus and a stated flag count, never just a green run; the "does not
  fire" half is the half that decides whether people will trust the category.]

- **FB-3** [status: resolved] — *"Gallery registration for the surface … implying
  the page was NOT in the gallery before. CONFIRM that: if true it means the
  surface had zero visual coverage, which is the real test-gap finding."* (task
  brief) → **REFUTED, and the record is corrected.** On the base,
  `dev/gallery/coverage.ts:392` already declares
  `modules/scheduler/pages/SchedulerAdminPage` as a `data-page` with
  `['loaded','empty','error']`, the module cassette already seeds
  `SchedulerAdminSettings.get`, and `settings-scheduler` already appears in the
  committed `RUNTIME_FINDINGS.jsonl`. The WIP's `gallery.config.json` hunk
  registers the new VISUAL SPEC; the `STATE_MATRIX.md` / `stateMatrix.generated.ts`
  hunks are REGENERATED artifacts of the page rewrite. The real gap is different
  and worse: the page WAS rendered by every gate every cycle and none of them
  could SEE the defect, and structurally `tests/e2e/visual/layout.spec.ts` (the
  general Layer-A invariant sweep) iterates `sectionTestIds()` = `gallery-section-*`
  ONLY — so the deterministic layout invariants had never run against ANY of the
  46 real PAGE surfaces. `form-label-starvation.spec.ts` is the first general
  Layer-A invariant that sweeps page surfaces. Recorded as DRIFT-1.4.
  [generalizable: yes — "the surface has a gallery entry" and "a gate can perceive
  what is wrong with it" are different claims; before concluding "no coverage",
  check what the existing sweeps actually ITERATE, not just what is registered.]

- **FB-4** [status: resolved] — *"Report OBSERVED test counts from real runs;
  never summarise a run you did not watch. If something cannot honestly be made
  green, say so plainly rather than weakening a check."* (task brief) → every
  number in `TEST_RESULTS.md` is transcribed from a watched run, and three
  results are recorded WITH their limits instead of rounded up: (a) `gate:ui`'s
  first run failed on `chat-collapse-borders` and was classified as a contention
  flake **by experiment** (7/7 on the base tree, 7/7 on the branch tree
  standalone), not by assertion; (b) TEST-9 also passes against the pre-fix
  guard, so it is labelled a forward regression pin rather than the proof of
  AUD-1, and AUD-1 itself is recorded as hardening with an explicitly FAILED
  reproduction; (c) Layer B (`VISUAL_SNAPSHOTS=1`) is stated as NOT RUN, with
  the reason (no blessed baselines for the rebuilt surface in this worktree),
  rather than silently omitted.
  [generalizable: yes — when a claimed defect does not reproduce under the
  instrument you have, downgrade the claim in the ledger and say so in the code
  comment; keeping a defensible fix is fine, describing it as a fixed live bug
  is not.]

- **FB-5** [status: wontfix] — the phase-6 blind multi-angle audit was run by the
  same agent that finished the implementation, because this session was
  explicitly instructed not to spawn subagents → recorded as the first row of
  `LEDGER.jsonl` (`angle: process`, severity high) rather than presented as a
  blind round. Independence is genuinely weaker than the phase-6 discipline
  intends. Mitigation: every finding is backed by a RUN (a probe, a lint run, a
  measurement) rather than an assertion. **Not fixable within this session's
  constraints** — re-running phase 6 with fresh reviewers is the honest
  follow-up and is listed in the hand-off summary.

## Open items for the owner (not feedback — decisions this branch leaves to you)

1. **GAP-1** — the `!canManage` read-only branch has no automated coverage,
   before or after this branch, and DEC-10 CHANGES its behaviour (the footer now
   renders disabled instead of being omitted). Closing it needs a permission axis
   on page-surface gallery states, or a `read`-without-`manage` user fixture in
   the e2e harness. Out of scope for a layout fix.
2. **ITEM-10 does NOT ship on this branch.** Per DEC-7/DEC-8 the `agent-kit`
   pointer is `origin/main` (`8435b4b`) and the 24/7-rig `label-starvation`
   detector sits on the submodule branch `fix/label-starvation-detector` (one
   additive hunk: `live-ui-audit.mjs` §9b + a SKILL.md section), unpushed,
   because you are editing that file upstream. Carry it onto your working copy.
3. **`sdk` points at an unpushed commit** (`8c5cef7` on
   `fix/settings-field-starved-label`, = `origin/sdk/agent-core-and-perf`
   `a393597` + the lint + the testId regen). Nothing was pushed, per the brief.
4. **testId registry cross-branch collision** — `packages/kit/src/testIds.generated.ts`
   is regenerated from the CONSUMING app tree, so regenerating it here also drops
   the three elicitation ids that only exist on a sibling superproject branch.
   Re-run `npm run gen:testid-registry` on the merged tree at land time.
