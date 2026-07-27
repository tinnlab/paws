# PLAN — perf-ux-round2

Measured performance + UI/UX round on top of `origin/feat/agent-core`. Every
item traces to a number in the design source; nothing here is a guess, and
nothing here is a re-fix of work that already landed.

## Design source

- Realizes `.lifecycle/perf-ux-round2/MEASUREMENT.md` — the measurement report
  produced for this round against a production build of this branch. Specifically:
  - **§1 FINDING B-1** (the kit barrel defeats `LazyDatePicker`; −76,659 B raw /
    −23 KB gzip off the critical path, proven by direct experiment) → ITEM-1, ITEM-2.
  - **§1 FINDING B-2** (2,040 chunks, median 650 B) + the disproven grouping fix
    → ITEM-8 (recorded as characterised-and-rejected, not implemented).
  - **§2 FINDING B-3** (composer interactive 5.6 s at 100 ms RTT; FCP σ 75 ms vs
    composer σ 700 ms) → ITEM-2's choice of a deterministic proof metric, and
    ITEM-8.
  - **§5 Attempt 2** (the SSE-slot "defect" that was really the test proxy) →
    ITEM-4, ITEM-5.
  - **§5 Status** (7-dimension inventory outstanding) → ITEM-9.
- Realizes `agent-kit/skills/live-ui-audit/SKILL.md` §"Tuning / false-positive
  discipline" — the rule that a saturated-instance signal must be proved to be an
  app bug before it is reported → ITEM-5 extends that section with the third
  cause this round found.
- Realizes `agent-kit/docs/CODING_GUIDELINES.md` §17 ("Docs reference only
  verified paths/symbols … code is the source of truth, not status prose") →
  ITEM-6, ITEM-7.
- Realizes the `feature-lifecycle` skill's **Merge hygiene** contract
  (".lifecycle artifacts … are stripped when merging to main; the branch history
  preserves them for audit") → ITEM-3, which makes gate A1 consistent with that
  contract on a stacked branch instead of forcing the artifacts to be deleted.

## Invariants

Lifted VERBATIM from `MEASUREMENT.md` §"Non-negotiables".

- **INV-1**: "Every change in this round must be justified by a number in this
  document, and proven by re-running the same probe that produced that number."
- **INV-2**: "A lazily-imported dependency must not appear in `index.html`'s
  `modulepreload` set."
- **INV-3**: "A change must be proven by a metric whose run-to-run noise is
  smaller than the effect claimed."
- **INV-4**: "A finding is not reported against the app until the measurement rig
  has been excluded as its cause."
- **INV-5**: "No fix may regress the `gate:ui` runtime-health baseline of 205/205
  surfaces clean."
- **INV-6**: "A finding already fixed in a previous round is verified against
  current code and recorded as 'already fixed', never re-fixed."

## Items

- **ITEM-1**: Stop the kit barrel from dragging `react-day-picker` + `date-fns` +
  `@date-fns/tz` (82,022 B raw / 24,586 B gzip) into the eager critical path.
  **Make the barrel's `DatePicker` itself lazy** rather than deleting the export:
  add `sdk/packages/kit/src/kit/date-picker-lazy.tsx` — a `forwardRef` +
  `React.lazy(() => import('./date-picker'))` + `Suspense`/`Skeleton` wrapper
  (the exact shape `src-app/ui/src/components/common/LazyDatePicker.tsx` already
  proves correct for the `FormField` `cloneElement` ref/prop injection) — and
  point `index.ts`'s VALUE export at it. `export type { DatePickerProps }` keeps
  pointing at the eager module (type exports are erased, so they cannot pull a
  runtime edge). Chosen over simply deleting the barrel export because it keeps
  the public kit API, the `KIT_MANIFEST.md` contract entry, the gallery story, and
  every existing consumer working unchanged — while moving the dependency behind a
  dynamic import. Benefits BOTH UI workspaces: the desktop build preloads the same
  chunk today.
- **ITEM-2**: Make the leak un-reintroducible. Add
  `src-app/ui/scripts/check-eager-graph.mjs` + a `check:eager-graph` step in
  `npm run check`, driven by a committed, documented list of dependencies that
  MUST stay lazy. It enforces two rules: (a) statically — the kit barrel must not
  re-export from a lazy-only module, and no `src/**` file may import that symbol
  from the barrel; (b) when a production build is present, the lazy chunk must not
  appear in `index.html`'s `modulepreload` set. The list lives in the product tree
  (NOT in `.lifecycle/`, which is stripped at merge).
- **ITEM-3**: Make lifecycle gate **A1** count only the `.lifecycle/` feature dirs
  a branch ADDS relative to its `--base`, instead of every dir present. On a
  branch stacked on a long-lived integration branch, A1 is otherwise
  unsatisfiable, and the only way to go green is `git rm -r` on other features'
  audit trails — which this repo has already suffered (the base branch carries a
  commit literally titled "restore sibling feature audit trails stripped for the
  A1 gate"). A1's real target — a SECOND feature dir introduced by this branch,
  which makes the pre-push `--all` gate validate the wrong feature — is preserved
  exactly. `agent-kit` submodule.
- **ITEM-4**: Fix the SSE teardown bug in the dist-serving test proxy so it stops
  manufacturing false `/api/sync/subscribe` + `/api/chat/stream` 429s: on
  downstream `res` close, destroy BOTH `proxyRes` and `proxyReq` (and on
  pre-header `req` abort, destroy `proxyReq`). Verified 12-then-429 → 20/20 × 200.
  The proxy is a machine-local scratch helper, so the durable deliverable is
  ITEM-5; this item is the rig fix plus the hand-off note naming
  `/data/pbya/ziee/tmp/serve-dist.mjs` as the shared original every rig on this
  box was copied from.
- **ITEM-5**: Fold the lesson into `agent-kit/skills/live-ui-audit/SKILL.md`. Its
  §"Tuning / false-positive discipline" already tells the auditor to distinguish a
  self-induced per-user SSE 429 from a real one via a sequential zero-concurrency
  probe and a fresh user. This round found a THIRD cause those two probes alone
  mis-attribute — a reverse proxy in front of the app that never tears down the
  upstream SSE request — and the exact four-probe matrix that separates it. Add
  that matrix, and add the rate-limiter contamination (attempt 1) as a named
  prerequisite of any multi-shard run.
- **ITEM-6**: Delete the stale `console.log("Using cargo from PATH
  (cross-platform)")` at `src-app/ui/tests/fixtures/test-context.ts:419`. It is
  emitted unconditionally, once per spawned test server (~105× per full run),
  before the code decides how to start the server — and the normal path spawns the
  PREBUILT binary and never invokes cargo. The very next `console.log` already
  reports the real choice ("Spawning prebuilt binary" / "Prebuilt binary absent —
  falling back to cargo run"), so the line is pure misinformation for anyone
  reading a run log. `cargoPath` itself stays; only the log line goes.
- **ITEM-7**: Refresh the committed
  `src-app/ui/src/dev/gallery/RUNTIME_FINDINGS.md`. The copy on the base reports
  **917 gating HIGH** findings; a real `npm run gallery:runtime` on this branch
  reports **0**. It is generated output whose whole purpose is to be a truthful
  record, and a 917-HIGH file is actively misleading about the health of the UI.
- **ITEM-8**: [DESCOPED] Reducing the 2,040-chunk / median-650 B code-splitting
  granularity (FINDING B-2) and the 5.6 s throttled composer-interactive
  (FINDING B-3). Measured, characterised, and the obvious fix DISPROVEN this
  round (per-store action grouping: chunks 2,040 → 833 but boot 198 → 229 chunks,
  1,593 → 2,110 KiB, throttled composer 5,041 → 7,227 ms). Any real fix is an
  architectural change to the lazy-store/module-loader design and needs its own
  round. See DEC-6.
- **ITEM-9**: [DESCOPED] The UI/UX half of the round — the ranked, deduped
  inventory from the 7-dimension `live-ui-audit` (functional bugs · UI/visual
  correctness · responsive 390/768/1280 · colour/theme incl. light↔dark parity ·
  design-system consistency · network hygiene · RBAC scoping). Two baseline runs
  were completed and BOTH had to be discarded for rig defects (MEASUREMENT §5);
  the third was stopped by a concurrent full-suite e2e run on the same box. With
  no valid inventory there are no evidence-backed UI findings to fix, and
  inventing them would violate INV-1 and INV-4. See DEC-7.

## Files to touch

- ITEM-1: `sdk/packages/kit/src/kit/date-picker-lazy.tsx` (new),
  `sdk/packages/kit/src/index.ts`, `sdk/packages/kit/src/KIT_MANIFEST.md`
  (regenerated if the generator's output moves). No app-side file changes —
  `controls.story.tsx`, `WorkflowElicitForm.tsx`, `elicitationFields.tsx` and
  `components/common/LazyDatePicker.tsx` (plus its passing contract test) all
  keep working untouched.
- ITEM-2: `src-app/ui/scripts/check-eager-graph.mjs` (new),
  `src-app/ui/scripts/check-eager-graph.test.mjs` (new),
  `src-app/ui/package.json` (`check:eager-graph` in the `check` chain),
  `src-app/ui/scripts/lazy-deps.json` (new — the committed list).
- ITEM-3: `agent-kit/lifecycle/lifecycle-check.mjs` (submodule).
- ITEM-4: `/data/pbya/ziee/tmp/perf-ux-serve.mjs` (machine-local rig; not a repo
  file — the committed deliverable is ITEM-5).
- ITEM-5: `agent-kit/skills/live-ui-audit/SKILL.md` (submodule).
- ITEM-6: `src-app/ui/tests/fixtures/test-context.ts`.
- ITEM-7: `src-app/ui/src/dev/gallery/RUNTIME_FINDINGS.md` (regenerated).
- Artifacts: `.lifecycle/perf-ux-round2/*` incl. the committed, re-runnable
  `perf-probe.mjs`.

## Patterns to follow

- **ITEM-1** mirrors the EXISTING lazy-boundary pattern in the same tree:
  `src-app/ui/src/components/common/LazyDatePicker.tsx` (and its sibling
  `LazyStreamdown`) — a `forwardRef` + `lazy(() => import('<deep path>'))` +
  `Suspense`/`Skeleton` wrapper that is the single entry point for a heavy
  dependency. ITEM-1 copies that wrapper INTO the kit so the barrel export itself
  becomes the lazy boundary, closing the hole that bypassed it. No new pattern is
  introduced; the `forwardRef` + `{...props}` + `ref={ref}` shape is load-bearing
  for `FormField`'s `cloneElement` injection and is preserved verbatim.
- **ITEM-2** mirrors the existing `src-app/ui/scripts/lint-*.mjs` /
  `check-*.mjs` family (`lint-hooks.mjs`, `check-gallery-fixtures.mjs`) — a plain
  Node script, a `check:*` npm script chained into `npm run check`, its own
  `*.test.mjs` run by `npm run test:unit`, and an explicit committed
  allowlist/config file rather than logic embedded in the script. It follows
  **B6**: its source of truth is a product-tree file, never a `.lifecycle/`
  artifact.
- **ITEM-3** mirrors the sibling hardening checks in the same file (`checkA3`,
  `checkA10Enumeration`): a small pure function returning a gap-string array,
  reading the already-resolved module-level `baseRef` and using the existing
  `git()` helper.
- **ITEM-5** mirrors the existing paragraph it extends in the same SKILL section
  (the "Prove whether a saturated shared instance is env noise or an app bug"
  block) — same voice, same probe-then-report structure.
- **ITEM-6** mirrors the logging convention already used two statements later in
  the same function: report the decision that was actually taken, in the branch
  that takes it.

## UI-surface checklist

**No new UI surface is added by this round.** ITEM-1 removes a barrel export;
ITEM-2/3/5/6/7 are build tooling, lifecycle tooling, docs, a test-harness log
line, and regenerated generated output. Therefore precedent, scale/cardinality,
responsive behaviour, populated-render review, user-visible progress, input
economy, JTBD design, multi-instance behaviour, and URL-as-view-into-focus have
**no surface to apply to**. The relevant UI obligation is the negative one, and
it is covered by INV-5 + ITEM-2's e2e: the rendered app must be byte-identical in
behaviour after ITEM-1 (the DatePicker still renders wherever it rendered
before — the MCP/workflow elicitation date fields), and `gate:ui` must stay
205/205.
