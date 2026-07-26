# TEST_RESULTS — live-ui-audit-fixes

## Gate lines

- `npm run check (ui): PASS` — exit 0 (`/data/pbya/ziee/tmp/luif/npm-check-ui5.log`)
- `npm run check (desktop/ui): PASS` — exit 0 (`/data/pbya/ziee/tmp/luif/npm-check-desktop2.log`)
- `gate:ui (ui): PASS` — exit 0; `197/197 surfaces PASS`, 0 gating-HIGH runtime
  findings across 636 gallery cells (`/data/pbya/ziee/tmp/luif/gate-ui.log`).
- `gate:ui (desktop/ui): PASS` — exit 0; `52/52 surfaces PASS`
  (`/data/pbya/ziee/tmp/luif/gate-ui-desktop.log`).
  (Both run `--skip-visual`: the diff changes no layout, and the Layer-B pixel
  baselines are not maintained on this worktree.)

## Per-test results

- **TEST-1**: PASS — `cargo test --lib project::types` → `3 passed; 0 failed`
  (`empty_batch_is_valid`, `batch_at_the_cap_is_valid`,
  `over_cap_batch_is_rejected_as_422`).
- **TEST-2**: PASS — `projects_for_conversations_resolves_many_in_one_call`
- **TEST-3**: PASS — `projects_for_conversations_never_leaks_another_users_conversation`
- **TEST-4**: PASS — `projects_for_conversations_requires_auth_and_projects_read`,
  `projects_for_conversations_over_cap_is_422`,
  `projects_for_conversations_empty_batch_is_an_empty_answer`
  (TEST-2..4: `cargo test --test integration_tests project::conversations_test`
  → **29 passed; 0 failed**, `/data/pbya/ziee/tmp/luif/int-project.log`; re-run
  after the fix round against the amended assertions.)
- **TEST-5**: PASS — `projectLookupBatch.test.ts`, 9 cases incl. the two added in
  the fix round (synchronous-throw, throwing-resolver).
- **TEST-6**: PASS `[acceptance] [invariant: INV-2]` — 12-row list in a `hasTouch`
  context issues **0** `GET /api/projects/by-conversation/{id}` and **exactly 1**
  `POST /api/projects/by-conversations`, with the filed badge AND the unfiled
  "Add to project" both rendering.
- **TEST-7**: PASS — `llmModelCatalogPure.test.ts`, 11 cases incl. the two
  interleave cases added in the fix round (invalidate-with-request-in-flight,
  slow-pre-force-cannot-overwrite).
- **TEST-8**: PASS `[acceptance] [invariant: INV-3]` — one load of
  `/settings/memory-admin` (which alone used to fire two of the three calls)
  issues `GET /api/llm-models` **exactly once**.
- **TEST-9**: PASS — `accentSwatch.test.ts`, 4 cases incl. the mirror-drift guard
  against the shipped `sdk/packages/shell/src/theme/accentPresets.ts`.
- **TEST-10**: PASS `[acceptance] [invariant: INV-4]` — dark: no swatch is
  `rgb(58, 92, 161)`, the SELECTED swatch equals the live `--primary`; light: the
  same identity holds AND every swatch differs from its dark value.
- **TEST-11**: PASS `[acceptance] [invariant: INV-1]` — 8 surfaces at 390×844:
  no horizontal page scroll, no viewport-clipped control.
- **TEST-12**: PASS — `openapi::emit_ts::tests::types_ts_parity` (`cargo check -p
  ziee --tests` clean + `just openapi-regen` exit 0 for BOTH workspaces; the
  parity test is what fails if `types.ts` were hand-edited).
- **TEST-13**: PASS `[acceptance] [invariant: INV-5]` — the before→after audit
  evidence below.

Unit + e2e logs: `/data/pbya/ziee/tmp/luif/e2e-new3.log` (2 passed),
`/data/pbya/ziee/tmp/luif/e2e-new2.log` (TEST-6, TEST-8, TEST-11 + the
pre-existing `projects/trailing-badge` spec passing — no regression on the
surface the batching touches).

---

## TEST-13 — the audit's own before→after (INV-5)

**Method.** Identical battery, identical flags
(`--jtbd=home,compose-send,browse-settings --viewports=390,1280
--themes=light,dark`), the SAME backend (this worktree's `ziee` on `:29285`) and
the SAME seeded data (45 conversations, 1 project with 5 attached, 2 models).
Only the served bundle differs: BEFORE = a build of this branch's base, AFTER =
a build with the fixes. Outputs: `/data/pbya/ziee/tmp/luif/audit-B-before/`,
`/data/pbya/ziee/tmp/luif/audit-E-after/`.

| Signal | BEFORE | AFTER |
|---|---|---|
| `network/n+1` rows (all `GET /api/projects/by-conversation/{id}`) | **16** (19 distinct ids per step) | **0** |
| `duplicate request: GET /api/llm-models fired 3×` | **3 rows × 4 cells** | **0** (the endpoint no longer appears in ANY duplicate row) |
| `palette-drift` on `settingsgen-accent-blue` = `rgb(58, 92, 161)` | **1 row** (mobile/dark + desktop/dark) | **0** |
| `overflow-x` | 0 | 0 |
| `clipped-control` | 0 | 0 |

**Controlled single-page measurement** (desktop 1280, one home load, same
backend, restarted between runs so the SSE registry is clean):

| endpoint | BEFORE | AFTER |
|---|---|---|
| `GET /api/projects/by-conversation/{id}` | **19** | **0** |
| `POST /api/projects/by-conversations` | 0 | **1** |
| `GET /api/llm-models` | **3** | **1** |
| total `/api` requests on one home load | **47** | **25** |

**Red-before-green for the theme fix** (same probe against both bundles):

```
BEFORE  dark --primary=hsl(216 56% 64%)   blue swatch = rgb(58, 92, 161)   ← the audit's exact signal
        swatches IDENTICAL across light/dark: 9 / 9
AFTER   dark --primary=hsl(216 56% 64%)   blue swatch = rgb(112, 153, 215) = the dark --primary
        swatches IDENTICAL across light/dark: 0 / 9
```
Both TEST-10 assertions fail on the BEFORE bundle, so the test proves the
design's promise rather than the code's behaviour.

### `palette-drift` total went 8 → 11, and that is the fix working

The pre-fix picker painted the SAME (light) colour in every theme, so one
finding row covered light+dark cells at once. Post-fix each preset paints a
different colour per theme, so light and dark produce SEPARATE rows. The row that
matters — the named `settingsgen-accent-blue` `rgb(58, 92, 161)` in dark — is
gone, and no swatch paints a light variant while dark.

The remaining rows are the 6-7 NON-selected presets. That is inherent to a colour
PICKER: only the selected accent can equal the live `--primary`, so every other
swatch is by definition "a saturated colour not resolvable to a token". The
repo's own `lint:colors` carves this out with `data-allow-custom-color` (which
the element carries); the runtime detector does not read that marker. Reported as
a detector false-positive class — the audit skill was deliberately NOT edited to
suppress it (`feature-lifecycle` B3).

### Residual: `POST /api/projects/by-conversations fired 2×` (LOW)

In the `sent` step the batch endpoint is called twice (two mount waves ~seconds
apart: the conversation load, then the sidebar re-render after the reply). This
is the audit's `duplicate` rule firing at its ≥2 LOW threshold. It replaces
**16 MEDIUM `n+1` rows carrying 19 requests each**; widening the 20 ms window to
span seconds would starve the badge (DEC-4), so this is accepted and recorded
rather than tuned away.

---

## The coordinator's systemic 390px report — measured, does NOT reproduce

A wider sweep (`/data/pbya/ziee/tmp/live-ui-audit-2026-07-26/`) reported
horizontal overflow at 390px on **27 surfaces** in both themes, with a recurring
`+29px` on `div#root>div>div>main`, plus **98 clipped controls**, and attributed
it to one shared shell container.

**That sweep targeted `http://127.0.0.1:1520`** (its own header says so) — the
stale bundle. Measured on a CORRECT build of this branch, at 390×844, across
**46 routes** covering every surface the sweep flagged (chat, conversations,
projects, all 6 hub tabs, all 12 user-settings pages, all 8 admin-core pages, all
6 admin-LLM pages, all 8 admin-tools pages incl. the four outliers `hub-models`,
`settings-users`, `settings-voice`, `settings-mcp-admin`):

| run | overflowing routes | clipped controls |
|---|---|---|
| my build → my backend (`:1535`→`:29285`), light | **0 / 46** | 1 |
| my build → **the sweep's own backend** (`:1534`→`:29185`, identical data), light | **0 / 46** | 1 |
| my build → the sweep's own backend, dark | **0 / 46** | **0** |

The single "clipped" control is an empty-state filler button 2px past the edge
INSIDE a clipping ancestor (`body.scrollWidth` stays 390 — nothing scrolls,
nothing is visibly cut). TEST-11's 4px edge slack documents that threshold.

**Root cause of the reported 27, measured directly in the live `:1520` page:** its
`index.html` links `assets/index-CszcZvgH.css` — a **27 KB** chunk whose first
bytes are the OverlayScrollbars licence header — and walking
`document.styleSheets` in that page finds **zero** rules for `.sr-only`,
`.fixed`, `.min-w-0`, `.flex-1`, `.overflow-x-clip`. Without them the `sr-only`
skip link becomes a 61px flex ITEM, the sidebar toggle loses `position: fixed`
(another 28px in flow), and `<main>` loses `flex-1 min-w-0` so its min-content
width (330px) wins: 61 + 28 + 330 = **419** — the reported number, on every
surface that shares the shell, with wider pages (hub grid, users table) pushing
`main`'s min-content higher (493 / 578 / 813). A fresh build of the same source
emits `assets/index-VB5WfW6c.css` (214 KB) containing all of them.

So the systemic finding is a **stale/partial dist**, not a source defect — and
"fixing" a shell container to compensate would have been a fabricated fix
(INV-5). What shipped instead is the executable guard: TEST-11 now sweeps 8
surfaces at 390px, so if a shell container ever DOES break, it fails in CI rather
than in the next manual audit.

---

## Triaged, NOT fixed (with evidence)

- **`429 Too Many Requests` on `/api/sync/subscribe` + `/api/chat/stream`** (HIGH
  `console-error`, and the `llm-infra` preflight). Present BEFORE and AFTER, and
  on a rate-limiter-disabled server, so it is not the global limiter: it is the
  per-user SSE cap (`sync/registry.rs`: 512 global / **12 per user**) being hit
  because the battery drives 12 browser contexts as ONE user back-to-back.
  A genuine fix (prompter registry pruning on client disconnect) is a
  sync-module change with its own blast radius — out of scope, DEC-9.
- **`No model selected` → `POST …/messages` 422** (HIGH, compose-send). Present
  BEFORE and AFTER on both backends. The composer lets Enter through before the
  model picker has resolved, and the request then fails schema validation instead
  of being guarded client-side. A real (pre-existing) UX bug, in
  `modules/chat/**` — owned by another agent per the coordinator's split.
- **`control-collision` (21) / `zero-size-control` (5) / `a11y-name` (5-6) /
  `spacing-grid` (3)** — identical counts BEFORE and AFTER; pre-existing and
  outside this feature's four findings.
- **`network/waterfall` (19)** — the boot request chain; explicitly assigned to
  another agent.

## Known gaps

- **Layer-B visual regression** (`VISUAL_SNAPSHOTS=1 npm run gate:ui`) was NOT
  run — the pixel baselines are not maintained on this worktree, and the diff
  changes no layout (the only pixel-visible change is the accent swatch colour in
  dark mode, which is the intended change and would need a re-blessed baseline
  anyway). Criteria 2 (runtime-health) and 4 (tsc+lint) of the UI DONE gate pass.
- **Phase-0 `A1`** fails: the branch's base (`feat/agent-core`) already carries 7
  other features' `.lifecycle/` dirs that were never stripped at their merges.
  Deleting them here would add a large unrelated diff and conflict with the FF
  target, so they are left alone; every PER-PHASE gate (1-8) passes.
