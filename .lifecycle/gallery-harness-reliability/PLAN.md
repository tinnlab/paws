# PLAN — gallery-harness-reliability

Five confirmed defects in the shared gallery / testid tooling that collectively
made `npm run gate:ui` unable to adjudicate any branch.

## Design source

Realizes `.lifecycle/gallery-harness-reliability/DESIGN.md` §D1–§D5 plus its
§"Cross-cutting non-negotiables". That document transcribes the owner's diagnosed
defects verbatim; there was no prior design doc for this tooling, so it was written
first (per the phase-1 rule) and is the authority this plan is derived from.

Secondary sources the implementation must conform to:
- `CLAUDE.md` §"UI Build Gate — the visual-testing exit condition" (what `gate:ui`
  and `runtime-health` are contractually required to report).
- `agent-kit/docs/CODING_GUIDELINES.md` §6 (never silently swallow), §15 (dead code
  = unfinished work), §17 (docs reference only verified paths).

## Invariants

Lifted VERBATIM from DESIGN.md.

- **INV-1**: "Fix the cause, not the symptom. Await network-idle (or explicitly await the cell's pending module requests) before `close()`, so the cancellation never happens. Muting the `net::ERR_*` console string is the reachable layer — it would leave the gate blind to genuine transport failures and still load-fragile. If you add muting at all, it must be *paired with* the cancellation fix, never instead of it."
- **INV-2**: "Mechanism is unknown — investigate before fixing. First establish the flake rate: run the same commit N times and record failing-set membership. That alone distinguishes timing from ordering. Then either make cell mounting deterministic, or require a finding to reproduce across runs before it gates."
- **INV-3**: "Take a host-level lock, or detect a live instance and refuse to run." — and: "Per-worktree `node_modules` isolation does NOT protect against this."
- **INV-4**: "A run whose crawl did not complete must fail loudly, not inherit stale data."
- **INV-5**: "replace the regex in `collectTestIds` with a ts-morph AST pass … collecting JSX attributes and object properties named `data-testid` with string-literal values. Comments stop being harvestable structurally rather than by pattern-matching — a hand-rolled comment-stripper is itself a text scan with its own evasion space."
- **INV-6**: "Check whether the ziee copies are synced from the sdk or independently maintained and handle both, or the fix lands in one place and not the others."

## Items

### D1 — cancelled-import contamination

- **ITEM-1**: [DESCOPED] quiesce the page's in-flight requests before `close()`.
  The mechanism it targets is DISPROVED — see DRIFT-1.1: `page.close()` emits no
  `requestfailed` and no console mirror in Playwright 1.60 (four probe variants,
  0 events each). Replaced by ITEM-1b.
- **ITEM-2**: [DESCOPED] a `quiesce-timeout` diagnostic finding. Falls with ITEM-1.
  Replaced by ITEM-2b.
- **ITEM-1b**: Add an **origin-liveness validity gate** to `runtime-health.mjs`.
  The PROVEN mechanism (DRIFT-1.2, probe F) is that the gallery origin becomes
  unreachable mid-crawl — a concurrent run stealing/killing the Vite server, a
  `pkill -f vite` (which CLAUDE.md itself recommends as a troubleshooting step),
  or a server crash. Probe the origin before the crawl, periodically during it,
  and after it; count per-cell transport failures. If the origin was ever
  unreachable, or transport failures exceed a threshold, the run is declared
  **VOID** — it exits non-zero with an explicit reason and its findings are NOT
  presented as product verdicts. This is the D1 analogue of INV-4: a run that
  could not observe the product must fail loudly, not report noise as defects.
- **ITEM-2b**: Report the validity state in the rollup + the JSONL run manifest
  (`originAlive`, `transportFailures`, `void`, `voidReason`), so a contaminated
  run is self-labelling rather than requiring a human to notice.

- **ITEM-3**: Add the **paired** (per INV-1, never instead-of) classifier arm: a
  `console-error` whose text is the console MIRROR of an already-classified
  dev-asset transport failure (`Failed to load resource: net::ERR_*` for a Vite dev
  asset) is harness noise. Scoped narrowly to `net::ERR_ABORTED` /
  `net::ERR_NETWORK_CHANGED` on a dev-asset URL — a `net::ERR_*` on a product
  `/api` URL still gates, so the gate keeps its sight of genuine transport failure.
- **ITEM-4**: Stop the fabricated crashes: a `crash` (ErrorBoundary) whose text is
  `Failed to fetch dynamically imported module` for a **dev-asset** URL is the same
  cancellation artifact reaching the ErrorBoundary. Classify it as harness noise
  ONLY when the run also observed the corresponding cancelled dev-asset request in
  that same cell — never blanket-mute a crash.
- **ITEM-5**: Report `ERR_NETWORK_CHANGED`/cancellation contamination as a
  first-class **validity** line in the runtime-health rollup + `gate-ui` output
  (`contamination: N cancelled-import artifacts (X% of findings)`), so a
  contaminated run is self-labelling rather than requiring a human to notice.

### D2 — unstable failing set

- **ITEM-6**: Investigate first (INV-2). Run the same commit N≥5 times on a
  quiet box, record per-run failing-surface membership + the contamination line,
  and write `.lifecycle/gallery-harness-reliability/FLAKE_STUDY.md` with the
  measured flake rate and the per-surface stability classification. No fix is
  designed before this data exists.
- **ITEM-7**: [DESCOPED] Add `--repeat=N` to `runtime-health.mjs`: run the full crawl N times
  in one invocation and annotate every finding with `runs_seen` / `runs_total`.
  This is the measurement instrument ITEM-6 uses and the mechanism ITEM-8 gates on.
- **ITEM-8**: [DESCOPED] Add reproduce-to-gate: with `--repeat=N` (N>1), a HIGH finding gates
  only when it reproduced in **every** run (`runs_seen === runs_total`); one that
  did not is emitted with `flaky: true` and a `stability` annotation, subtracted
  from the gating total exactly like `baselined`/`harness`, and listed in its own
  rollup section. At N=1 (the default) behaviour is unchanged — a single run cannot
  distinguish stable from flaky and must not silently downgrade findings.
- **ITEM-9**: [DESCOPED] Teach `gate-ui.mjs`'s `readRuntimeSurfaceVerdicts()` about the new
  `flaky` flag (mirroring how it already handles `baselined`/`harness`), and print
  flaky surfaces in a separate line of the per-surface table so "new failure" and
  "flaky failure" are visibly different verdicts.

### D3 — no machine-wide lock

- **ITEM-10**: Add a host-level advisory lock helper
  (`sdk/packages/gallery/scripts/lib/host-lock.mjs`): an exclusive lock on a
  well-known host path (`$TMPDIR/ziee-gate-ui.lock`) taken with `O_EXCL` + a
  liveness-checked holder record (pid + worktree root + start time), a stale-lock
  reclaim when the recorded pid is gone, and release on every exit path
  (`finally` + `process.on('exit'|'SIGINT'|'SIGTERM')`).
- **ITEM-11**: Wire the lock into `gate-ui.mjs` and standalone `runtime-health.mjs`
  around the crawl. Default behaviour on contention is to **wait** with a visible
  message naming the holding worktree + pid; `--no-wait` refuses immediately with a
  non-zero exit; `GATE_UI_LOCK=0` opts out for a deliberate concurrency experiment.
  Silence on contention — the current behaviour — must be impossible.

### D4 — stale roll-up

- **ITEM-12**: `runtime-health.mjs` writes a run manifest
  (`RUNTIME_RUN.json`: `runId`, `startedAt`, `finishedAt`, `cellsPlanned`,
  `cellsCompleted`, `complete: true`, `repeat`) atomically, only after the crawl
  drains, and stamps the same `runId` into the JSONL path's sibling. A killed run
  leaves no manifest.
- **ITEM-13**: `gate-ui.mjs` generates a `runId`, passes it to the child, and
  **deletes** the previous `RUNTIME_FINDINGS.jsonl` + manifest before the crawl.
  After the child returns it requires: manifest exists, `complete === true`,
  `runId` matches, `cellsCompleted === cellsPlanned`. Any mismatch → a hard `FAIL`
  step naming the reason, **no per-surface table printed at all**, non-zero exit.
  Inheriting a prior run's data becomes structurally impossible, not merely
  detected.

### D5 — phantom testids

- **ITEM-14**: Replace `collectTestIds`'s `LITERAL` regex with a **ts-morph AST
  pass** that collects, from JSX attributes and object properties named
  `data-testid`, the string literals in **value positions** of the initializer:
  the literal itself, both arms of a ternary, both operands of `??`/`||`, and
  through parenthesized / `as` / non-null wrappers. A `TemplateExpression` (an
  interpolated id) yields nothing; a ternary CONDITION, a call argument, and a
  template span are NOT value positions and yield nothing; comments are not nodes
  and are structurally unreachable.
- **ITEM-15**: Add id-shape validation at render time (`/^[a-zA-Z0-9_-]+$/`): an
  id failing the shape is a hard error naming the id + its file:line, so a future
  scanner regression cannot land silently. Defense-in-depth per DESIGN §D5.
- **ITEM-16**: Regenerate the committed `sdk/packages/kit/src/testIds.generated.ts`
  and record, in `DECISIONS.md`, the exact delta with each id's source: 3 phantoms
  REMOVED (all template-interpolation artifacts) and 6 real ids ADDED that the text
  scan was silently MISSING (ternary / `??` value positions).
- **ITEM-17**: Add `ts-morph` to `@ziee/gallery`'s `devDependencies` — the script
  now imports it directly and currently resolves only by root-hoist accident.

### INV-6 — the three-copy problem

- **ITEM-18**: Apply ITEM-1..5, ITEM-7..9, ITEM-11..13 to **both** live copies:
  `sdk/packages/gallery/scripts/*` (used by `src-app/ui`) and
  `src-app/desktop/ui/scripts/*` (used by `src-app/desktop/ui`).
- **ITEM-19**: Delete the **dead** `src-app/ui/scripts/runtime-health.mjs` — it has
  zero invokers (`src-app/ui`'s `gallery:runtime` and `gate:ui` both point at the
  sdk copy) and is a divergent third copy of the exact file being fixed, i.e. the
  drift trap that caused this defect class. CODING_GUIDELINES §15.
- **ITEM-21**: Wire the gallery script unit tests into a runnable npm script
  (`test:gallery-scripts`) and into `npm run check`. `gen-testid-registry.test.mjs`
  and `lib/run-key.test.mjs` are currently invoked by **nothing** — a test nothing
  runs is not coverage (CODING_GUIDELINES §15), and `gen-testid-registry.test.mjs`
  specifically exercises the `collectTestIds` this feature rewrites, so leaving it
  unrun would let ITEM-14 break it silently.

- **ITEM-22**: Update the docs that name the paths this feature changes —
  `CLAUDE.md` §"UI Build Gate" (the `scripts/runtime-health.mjs` /
  `scripts/gate-ui.mjs` references, the new lock / manifest / `--repeat` semantics)
  and `agent-kit/skills/live-ui-audit/SKILL.md`'s two references to the deleted
  `src-app/ui/scripts/runtime-health.mjs`. CODING_GUIDELINES §17.

- **ITEM-20**: Add a **copy-drift guard** (`check:harness-parity`, wired into
  `npm run check`) asserting that the behavioural cores this feature fixes are
  present in every live copy — so the next fix cannot land in one tree and not the
  others. Reads its expectations from a committed product-tree file, never from
  `.lifecycle/` (rule B6).

## Files to touch

- `sdk/packages/gallery/scripts/runtime-health.mjs` — ITEM-1..5, 7, 8, 12
- `sdk/packages/gallery/scripts/gate-ui.mjs` — ITEM-5, 9, 11, 13
- `sdk/packages/gallery/scripts/gen-testid-registry.mjs` — ITEM-14, 15
- `sdk/packages/gallery/scripts/gen-testid-registry.test.mjs` — D5 tests
- `sdk/packages/gallery/scripts/lib/host-lock.mjs` (NEW) — ITEM-10
- `sdk/packages/gallery/scripts/lib/host-lock.test.mjs` (NEW) — D3 tests
- `sdk/packages/gallery/scripts/lib/finding-classify.mjs` (NEW) — the shared,
  unit-testable classifier core (ITEM-3/4/8) both copies import, so ITEM-18's
  parity is by CONSTRUCTION for the classifier rather than by duplication
- `sdk/packages/gallery/scripts/lib/finding-classify.test.mjs` (NEW)
- `sdk/packages/gallery/scripts/check-harness-parity.mjs` (NEW) — ITEM-20
- `sdk/packages/gallery/package.json` — ITEM-17
- `sdk/packages/kit/src/testIds.generated.ts` — ITEM-16 (regenerated)
- `src-app/desktop/ui/scripts/runtime-health.mjs` — ITEM-18
- `src-app/desktop/ui/scripts/gate-ui.mjs` — ITEM-18
- `src-app/ui/scripts/runtime-health.mjs` — DELETED (ITEM-19)
- `src-app/ui/package.json`, `src-app/desktop/ui/package.json` — wire
  `check:harness-parity` + the new node tests
- `CLAUDE.md` — update the UI Build Gate section for the new lock / manifest /
  `--repeat` semantics (CODING_GUIDELINES §17: docs must reference verified paths)

## Patterns to follow

| area | closest existing module to mirror |
|---|---|
| a new `scripts/lib/*.mjs` pure helper + its `node --test` sibling | `sdk/packages/gallery/scripts/lib/run-key.mjs` + `run-key.test.mjs` (pure exported fns, in-source-adjacent unit test, no side effects at import) |
| a ts-morph AST pass over the source trees | `sdk/packages/gallery/scripts/gen-state-matrix.mjs` (`Project` + `getDescendantsOfKind` + `Node.is*` guards) |
| a generator with a `--check` drift mode wired into `npm run check` | `gen-testid-registry.mjs` / `gen-overlay-registry.mjs` (`--check` compares rendered body, exits 1 with a "run `npm run gen:…`" message) |
| a bind-verified, worktree-keyed shared resource | `scripts/lib/run-key.mjs`'s `pickBindablePort` / `fetchSentinelRoot` / `serverIsThisWorktree` — the same "prove it's OURS before reusing" discipline the host lock needs |
| a gating-subtraction flag on a finding (`baselined` / `harness`) | `runtime-health.mjs`'s `isRuntimeBaselined` + `isHarnessNoise` and the mirrored formula in `gate-ui.mjs`'s `readRuntimeSurfaceVerdicts` — `flaky` follows the identical shape in BOTH files |

## UI-surface plan checklist

**Not applicable — this feature adds no UI surface.** The diff is entirely
build/test tooling (`scripts/`, a generated registry, package manifests, docs). No
page, drawer, card, panel, route, permission, migration, or API is added or
changed. `sdk/packages/kit/src/testIds.generated.ts` is a mechanically-generated
registry, and its only behavioural effect is that six previously-missing REAL ids
become typed and three never-rendered phantoms stop being offered — no rendered
output changes.

## Non-goals

- Making cell mounting itself deterministic (the D2 alternative). ITEM-6's
  measurement decides; the plan commits to the reproduce-to-gate branch of INV-2
  because it is the one that works regardless of the underlying mechanism, and
  ITEM-6 will record whether the measurement contradicts that choice.
- Any change to which surfaces the gallery enumerates, or to the cassette.

---

# PLAN AUDIT (phase 2) — verdicts against the codebase

Every verdict below was checked against the tree at `705e5015f` + sdk `c3ad1bf51`,
not reasoned from the plan.

## Breakage risk

- `runtime-health.mjs` and `gate-ui.mjs` have **no importers** — they are CLI
  entrypoints (`node --test` sees only `*.test.mjs`; nothing does
  `import … from 'runtime-health.mjs'`). `gen-testid-registry.mjs` DOES export
  `collectSourceFiles` / `collectTestIds` / `renderRegistry`, imported by
  `gen-testid-registry.test.mjs` — the only importer, and it is unrun (see
  Pattern conformance). So the blast radius of the script rewrites is the CLI
  contract (`npm run gate:ui` / `gallery:runtime` / `check:testid-registry`), not
  a module API.
- The one genuinely shared artifact is `sdk/packages/kit/src/testIds.generated.ts`,
  imported app-side as `@ziee/kit/testIds.generated`. Its exported types are
  `KnownTestId` (a union) and `TestIdLike = KnownTestId | (string & {})`. Because
  `TestIdLike` widens to `string`, REMOVING an id cannot break a `tsc` consumer —
  verified by reading the generated file's own type definitions. The three removed
  ids are never-rendered template artifacts, so no runtime selector can regress.
- `--repeat=N` defaults to 1, and at N=1 no finding is annotated `flaky`, so every
  existing caller (`gate:ui`, `gallery:runtime`, `prove-worktree-isolation.sh`)
  keeps byte-identical gating semantics unless it opts in.
- The host lock is the one change that can make a previously-succeeding command
  BLOCK. Mitigated by: default = wait-with-visible-message (not refuse),
  `GATE_UI_LOCK=0` opt-out, and stale-lock reclaim keyed on pid liveness so a
  SIGKILLed holder cannot wedge the host permanently.

## Pattern conformance

- **CONCERN (resolved into ITEM-21):** `sdk/packages/gallery/scripts/gen-testid-registry.test.mjs`
  and `scripts/lib/run-key.test.mjs` are referenced by **no** npm script in either
  workspace (`grep -rn "run-key.test"` → 0 hits outside the file itself; the ui
  workspace's `test:gallery-seed-registry` names only the seed-registry + overlay
  tests). They are dead tests. Since ITEM-14 rewrites the very function
  `gen-testid-registry.test.mjs` covers, shipping without wiring them would let the
  rewrite break its own existing test silently.
- The new `scripts/lib/*.mjs` + `*.test.mjs` pair mirrors `lib/run-key.mjs` exactly:
  pure exported functions, no side effects at import, a `node --test` sibling.
  Verified `run-key.mjs` has no top-level side effects, so the pattern holds.
- The ts-morph usage mirrors `gen-state-matrix.mjs`, which already does
  `import { Project, SyntaxKind, Node } from 'ts-morph'` from this same directory
  — so the resolution path is proven to work in situ (ITEM-17 makes it declared
  rather than accidental).
- `flaky` mirrors the existing `baselined` / `harness` gating-subtraction flag
  shape in BOTH `runtime-health.mjs` (the `HIGH − baselined − harness` formula)
  and `gate-ui.mjs` (`readRuntimeSurfaceVerdicts`'s mirrored branch), which is the
  established two-file convention.

## Migration collisions

- **None.** `find src-app/server -path '*/migrations/*.sql'` max prefix is
  `202607200400`; this branch adds no `.sql` file, no permission, no settings row.

## OpenAPI regen

- **Not required.** No Rust handler, `JsonSchema` type, or route is touched, so
  neither `openapi.json` nor `api-client/types.ts` changes in either workspace.
  Confirmed by the Files-to-touch list containing no `src-app/server/**` path.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — `runJob` (sdk `runtime-health.mjs:527-596`) is a
  self-contained per-page function; inserting a quiesce between
  `waitForTimeout(settle)` and `p.close()` is local. Playwright is 1.60.0, so
  `waitForLoadState('networkidle')` is available; a self-counted pending-request
  tally via the existing `request`/`requestfinished`/`requestfailed` listeners is
  the deterministic backstop for a page that never reaches networkidle.
- **ITEM-2** — verdict: PASS — the `record()` helper already accepts an arbitrary
  `{category, severity, selector, detail}`, so a `quiesce-timeout` category needs
  no schema change; MEDIUM keeps it non-gating while visible.
- **ITEM-3** — verdict: PASS — `isHarnessNoise` already receives the whole finding,
  so the console arm can test the URL embedded in the detail string with the
  existing `isViteDevAsset`. Narrowing to `net::ERR_ABORTED|ERR_NETWORK_CHANGED` +
  dev-asset URL keeps a product `/api` transport failure gating, which is exactly
  the blindness INV-1 warns about.
- **ITEM-4** — verdict: CONCERN — the "only when the corresponding cancelled
  dev-asset request was observed in that same cell" correlation requires
  classification to run AFTER the cell completes, but `record()` classifies
  eagerly at emit time (`runtime-health.mjs:505-517`). Resolution: move the
  `baselined`/`harness`/`flaky` stamping to a single post-crawl pass over
  `findings`, which is also what ITEM-8 needs (`runs_seen` is only knowable after
  all repeats). This is a real restructure, not a one-liner — budgeted.
- **ITEM-5** — verdict: PASS — the rollup already computes `byCat` / `bySev` /
  `harnessByCat`; a contamination percentage is one more derived counter, and the
  markdown rollup already has a dedicated harness section to model it on.
- **ITEM-6** — verdict: PASS — this is measurement, not code. Requires a quiet box;
  the owner offered to pause the explorer fleet, so the dependency is named, not
  assumed.
- **ITEM-7** — verdict: CONCERN — `main()` currently builds `cells`, drains one job
  pool, then writes. Repeating needs the crawl extracted into a `crawlOnce()` that
  returns findings, with the browser reused across repeats. Straightforward but it
  touches the function's whole shape, so it must land before ITEM-8/12.
- **ITEM-8** — verdict: PASS — depends on ITEM-4's post-crawl classification pass;
  finding identity across runs is `(surface, state, theme, category, detail)` with
  `detail` already normalized by the existing `normalizeDetail` (it strips
  `localhost:PORT` and `?t=<ts>`), so cross-run keys are already stable. Verified
  by reading `normalizeDetail` at `runtime-health.mjs:501-504`.
- **ITEM-9** — verdict: PASS — `readRuntimeSurfaceVerdicts` already has the exact
  `if (f.baselined || f.harness) s.baselined++` branch to extend.
- **ITEM-10** — verdict: PASS — no lock helper exists anywhere in
  `scripts/lib/` (`grep -n "flock\|lock" lib/run-key.mjs` → 0 hits), so this is
  additive. `run-key.mjs` already establishes the "identify the holder and prove
  it's ours" idiom (`fetchSentinelRoot` / `serverIsThisWorktree`) that the holder
  record mirrors.
- **ITEM-11** — verdict: CONCERN — `gate-ui.mjs` spawns `runtime-health.mjs` as a
  CHILD, so a naive lock in both deadlocks the parent against its own child.
  Resolution: the child must inherit the parent's ownership via an env token
  (`GATE_UI_LOCK_TOKEN`) and skip re-acquiring. Explicitly designed, not discovered
  at runtime.
- **ITEM-12** — verdict: PASS — the JSONL is written only after `browser.close()`
  (`runtime-health.mjs:611-617`), so a killed crawl already writes nothing; the
  manifest simply makes "nothing was written" distinguishable from "a previous run
  wrote this". Confirmed empirically: this fresh worktree has no
  `RUNTIME_FINDINGS.jsonl` while a crawl is mid-flight.
- **ITEM-13** — verdict: PASS — `gate-ui.mjs` already passes env to the child
  (`GALLERY_PORT`), so threading a `runId` uses the established channel. Deleting
  the prior artifacts pre-run is what makes staleness structurally impossible.
- **ITEM-14** — verdict: PASS — measured against the real tree: the current regex
  yields 1775 ids; a value-position AST pass yields 1778 = 1775 − 3 phantoms + 6
  real ids the regex was MISSING. The `??`/ternary forms are load-bearing in
  production code (`Drawer.tsx:261 data-testid={testid ?? 'layout-drawer-content'}`,
  `AuthGuard.desktop.tsx:83`, `CoreMemoryBlocksEditor.tsx:215`,
  `SettingsPageContainer.tsx:44`), which is why a naive "StringLiteral initializer
  only" AST pass would DROP real ids — a false-negative worse than the phantoms.
- **ITEM-15** — verdict: PASS — with ITEM-14 in place the shape check is expected
  to be permanently silent; it is a tripwire for a future scanner regression, and
  all 1778 current ids satisfy `/^[a-zA-Z0-9_-]+$/` (verified — the only violators
  were the 3 phantoms ITEM-14 removes).
- **ITEM-16** — verdict: CONCERN — `testIds.generated.ts` is the known
  concurrent-branch collision file. Not a blocker, but the merge rule (regenerate
  on top of main, never hand-merge) is recorded in BASE.md, and the sdk commit must
  land before the ziee pointer bump.
- **ITEM-17** — verdict: PASS — `sdk/packages/gallery/package.json` currently
  declares no `ts-morph`; `gen-state-matrix.mjs` already imports it and works only
  because the root workspace hoists `src-app/ui`'s copy. Declaring it removes an
  undeclared-dependency footgun (CODING_GUIDELINES §17).
- **ITEM-18** — verdict: CONCERN — the two live copies have genuinely DIVERGED
  (sdk `runtime-health.mjs` 32462 B vs desktop 31254 B; sdk `gate-ui.mjs` 10117 B
  vs desktop 8921 B; the desktop `gate-ui.mjs` hardcodes `src/dev/gallery` where
  the sdk one reads `CFG.galleryDir`). A copy-paste port is therefore wrong; each
  change must be re-applied in the desktop copy's own idiom. Mitigated by ITEM-20's
  parity guard and by putting the classifier core in a SHARED
  `lib/finding-classify.mjs` both import, so the highest-risk logic is
  single-sourced rather than duplicated.
- **ITEM-19** — verdict: PASS — verified dead: `src-app/ui/package.json` routes
  BOTH `gallery:runtime` and `gate:ui` to `../../sdk/packages/gallery/scripts/…`,
  and a tree-wide grep finds no executor of `src-app/ui/scripts/runtime-health.mjs`
  (only prose mentions in `CLAUDE.md` and two agent-kit skill docs, which ITEM-22
  updates).
- **ITEM-20** — verdict: PASS — B6-safe by construction: the guard and its
  expectations live in `sdk/packages/gallery/scripts/`, a permanent committed
  product path, never in `.lifecycle/`.
- **ITEM-21** — verdict: PASS — additive npm scripts; `node --test` is already the
  established runner for `*.test.mjs` in this repo (`test:seam-codemod`,
  `test:lint-hooks`, `test:gallery-seed-registry`).
- **ITEM-22** — verdict: PASS — doc-only. `CLAUDE.md:1850/1859` and
  `agent-kit/skills/live-ui-audit/SKILL.md:24/344` name
  `scripts/runtime-health.mjs` / `scripts/gate-ui.mjs` paths that ITEM-19 changes;
  CODING_GUIDELINES §17 requires docs to reference only verified paths.
