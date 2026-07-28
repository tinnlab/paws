# DRIFT-1 — implementation vs PLAN + the named design

Reconciled every ITEM against PLAN.md, DECISIONS.md and the design source
(`agent-kit/docs/DESIGN_SYSTEM.md` → "Form & settings layout", "Spacing rhythm",
"Semantic color tokens", "Component variant selection").

**Continuity note (honest provenance).** The implementation was authored by a
prior session that died to a session limit with everything uncommitted; its work
survives only as the protective WIP commit `058f0206`, and its transcript is
gone. This round is therefore a *reconstruction* of the drift walk against the
surviving code, run item-by-item with real measurements — not a live
item-by-item walk as each item landed (the discipline FB-18 asks for). Every
verdict below cites a run, never a reading.

## Per-item reconciliation

- **ITEM-1** (rebuild on `Form`/`FormField`) — verdict: none — `SchedulerAdminPage.tsx:162-238`
  is `<Form layout="horizontal">` + five `<FormField name label description>`;
  the hand-composed `Field`/`FieldContent`/`FieldTitle` rows are gone (the import
  of `@ziee/kit/shadcn/field` is gone with them). Measured: 0 starved labels at
  1280/768/390 (was 5 at 1280 and 768).
- **ITEM-2** (`w-40` + unit `suffix`) — verdict: none — all five controls carry
  `className="w-40"`; `suffix` is `seconds`/`days`/`failures`/`days` and the
  units left the label text. Measured control width ≤ 260px asserted by TEST-5a.
  *(DEC-3 enumerated only `seconds`/`days`; `suffix="failures"` on
  `max_consecutive_failures` is the same convention applied to the fourth field
  — it also removes the "N" from the label. Not a divergence, an application.)*
- **ITEM-3** (`SettingsFormActions` in the Card `footer`) — verdict: none —
  `SchedulerAdminPage.tsx:131-144`, dirty-gated + permission-gated, Cancel
  present. Verified in the AFTER screenshot and by TEST-5b (Save geometrically
  below the form).
- **ITEM-4** (shell parity with `SessionSettingsPage`) — verdict: none — `Spin`
  (94-102), retryable `ErrorState variant="page"` (107-120), read-only `Alert`
  (146-154), intro `Paragraph type="secondary" className="!mb-3 text-sm"` (156)
  — the last is byte-identical to `RetrievalLimitsSection.tsx:113`, i.e. the
  `!` modifier is the sibling's own convention, not a new hack.
- **ITEM-5** (responsive 390/768/1280 POPULATED) — verdict: none — screenshots at
  all three widths in both themes; the 390 render stacks label-above-control
  with no starved label and no horizontal overflow.
- **ITEM-6** (DESIGN_SYSTEM conformance) — verdict: none — `npm run check` (ui)
  EXIT=0, which chains `lint:colors` + `lint:logical-direction` +
  `lint:settings-field` + `check:design-spec`.
- **ITEM-7** (repo-wide sweep) — verdict: none — run BOTH ways. AST: 79
  settings-scoped files, 1 flagged pre-fix (5 sites, all `SchedulerAdminPage`),
  0 post-fix, and 0 non-scoped files would trip rule 2 either. Rendered: 46
  gallery page surfaces (35 of them `settings-*`) × 3 viewports, 126 labels
  measured / 111 eligible ⇒ 5 starved pre-fix on exactly one surface, 0 post-fix.
- **ITEM-8** (static lint) — verdict: none — `sdk` `c9bf67f`; 10/10 unit tests;
  both directions proven on the real tree. The PLAN_AUDIT **CONCERN** on
  `McpToolApprovalsTab` is CLOSED by measurement: it composes `Select` (root is a
  content-sized `<div className="relative">`), the lint does not flag it, and it
  renders 0 starved labels at all three viewports.
- **ITEM-9** (gating visual spec) — verdict: none — registered in
  `gallery.config.json → visualSpecs`; the PLAN_AUDIT **CONCERN** ("does it turn
  the gate red for a pre-existing offender?") is CLOSED: the post-fix sweep is
  clean at 390/768/1280, so no baseline or allowlist entry was added or needed.
- **ITEM-10** (live-ui-audit rig detector) — verdict: none — one additive hunk
  (`live-ui-audit.mjs` §9b + a SKILL.md section) on the agent-kit branch
  `fix/label-starvation-detector`; see DRIFT-1.3 for its disposition and
  DRIFT-1.2 for its verification.
- **ITEM-11** (real-backend e2e) — verdict: none — `tests/e2e/14-scheduler/admin-settings-layout.spec.ts`,
  four legs, real `GET/PUT /api/scheduler/admin-settings`, no `page.route()`.

## Drifts

- **DRIFT-1.1** — verdict: impl-wins — PLAN's *Files to touch* put the reusable
  probe in `tests/e2e/helpers/layout.ts`; it landed as a new sibling module
  `tests/e2e/helpers/label-starvation.ts`. `layout.ts` is the overflow/collision
  invariant set and carries no measurement vocabulary, while this probe needs
  ~60 lines of definition + calibration doc-comment; a separate module keeps
  `layout.ts` single-purpose and gives the rig detector exactly one file to
  mirror. **PLAN.md amended** (Files to touch) with this rationale.
- **DRIFT-1.2** — verdict: impl-wins — TESTS.md TEST-2 named a file that does not
  exist (`src-app/ui/scripts/lib/label-starvation.test.mjs`) and described the
  predicate as "the SHARED predicate the gating visual spec and the rig detector
  both use". Neither is accurate. The predicate legs live in
  `tests/e2e/visual/form-label-starvation.spec.ts` (`describe('isStarvedLabel —
  predicate')`, 5 pure tests, no browser), and the rig detector is a **second
  copy** of the four clauses — a skill in another repo cannot import an app test
  helper. **TESTS.md amended** to the real path and the accurate claim. The
  equivalence is not asserted, it is PROVEN: the rig's own detector source,
  sliced verbatim out of `live-ui-audit.mjs` and evaluated in-page, produces 5
  findings on the pre-fix `settings-scheduler` with the identical metrics the
  test-helper reports (`43px/162px squeeze 0.26`, `68/186 → 0.37`,
  `52/199 → 0.26`, `84/264`, `80/272`) and 0 on `settings-sessions`,
  `settings-file-rag-admin`, `settings-general`, `settings-voice`, and 0 on the
  post-fix Scheduler page.
- **DRIFT-1.3** — verdict: plan-wins — the WIP tree had the superproject
  `agent-kit` pointer at `8375ef9`, i.e. it dragged the UNPUSHED rig-detector
  commit into the branch. DEC-8 fixes the pointer at `origin/main` (`8435b4b`)
  and DEC-7 keeps the detector on a local submodule branch precisely because the
  orchestrator is editing that file upstream. **Re-implemented to match the
  plan**: the submodule is back on `main` @ `8435b4b`, the detector branch is
  renamed to the name DEC-7 records (`fix/label-starvation-detector`), and the
  hunk is flagged for the orchestrator to carry onto their working copy.
- **DRIFT-1.4** — verdict: resolved — the WIP commit message advertised "gallery
  registration for the surface", implying `/settings/scheduler` had no gallery
  coverage. **That is false and the record is corrected here**: on the base,
  `dev/gallery/coverage.ts:392` already declares
  `modules/scheduler/pages/SchedulerAdminPage` as a `data-page` with
  `['loaded','empty','error']`, the module cassette already seeds
  `SchedulerAdminSettings.get`, and the runtime manifest already enumerates
  `settings-scheduler` (it appears in the committed `RUNTIME_FINDINGS.jsonl`).
  The `gallery.config.json` hunk registers the new **visual spec**, and the
  `STATE_MATRIX.md` / `stateMatrix.generated.ts` hunks are REGENERATED artifacts
  of the page rewrite (6 render forks → 3). The real gap is different and is
  recorded as the test-gap finding: the page WAS rendered by every gate and none
  of them could SEE the defect — and, structurally, `tests/e2e/visual/layout.spec.ts`
  (the general Layer-A invariant sweep) iterates `sectionTestIds()` =
  `gallery-section-*` ONLY, so the deterministic layout invariants had never run
  against ANY of the 46 real page surfaces. `form-label-starvation.spec.ts` is
  the first general Layer-A invariant that sweeps page surfaces.
- **DRIFT-1.5** — verdict: resolved — a limitation of the check, found by running
  it and worth stating rather than burying: at 390px the PRE-FIX page reports
  **0** starved labels (clause 3 — "the row had room" — correctly refuses to
  blame a 340px row for an unavoidable wrap). The mobile leg of TEST-3 is
  therefore a regression guard, not the leg that would have caught this defect;
  the desktop and tablet legs are. No code change — the alternative (dropping
  clause 3) is exactly the "flag every page" failure mode the check exists to
  avoid.
- **DRIFT-1.6** — verdict: resolved — GAP-1 (`INFRA_INTEGRATION.md`): the
  `!canManage` read-only branch, whose behaviour DEC-10 changes, has no
  automated coverage before or after this branch, and closing it needs either a
  permission axis on gallery page states or a `read`-without-`manage` user
  fixture. Recorded as a gap for the owner, not silently claimed as covered and
  not papered over with a test that does not actually reach the branch.

**Unresolved drifts:** 0
