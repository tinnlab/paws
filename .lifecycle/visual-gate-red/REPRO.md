# REPRO — measured, before any change

Worktree: `/data/pbya/ziee/wt-visual-specs` @ `origin/main` = `e915089ca`.
Own hardlinked `node_modules` (not shared, `.vite` cleared). Explicit
`GALLERY_PORT=1471`, verified free before the run.

## 0. Baseline run (verbatim)

```
cd src-app/ui && GALLERY_PORT=1471 npx playwright test -c playwright.visual.config.ts \
  layout.spec.ts form-label-starvation.spec.ts states.spec.ts overlays.spec.ts \
  chat-collapse-borders.spec.ts input-group-overflow.spec.ts
```

(the six specs are `gallery.config.json` → `visualSpecs`, i.e. exactly what
`gate:ui` runs without `VISUAL_SNAPSHOTS`.)

```
EXIT=1

  7 failed
    [gallery] › tests/e2e/visual/chat-collapse-borders.spec.ts:314:3 › chat collapse — card borders (issue #183) › TEST-2: the surface reproduces the bug preconditions
    [gallery] › tests/e2e/visual/chat-collapse-borders.spec.ts:358:5 › chat collapse — card borders (issue #183) › TEST-3: every card's ring renders while COLLAPSED (light)
    [gallery] › tests/e2e/visual/chat-collapse-borders.spec.ts:358:5 › chat collapse — card borders (issue #183) › TEST-3: every card's ring renders while COLLAPSED (dark)
    [gallery] › tests/e2e/visual/chat-collapse-borders.spec.ts:445:5 › chat collapse — card borders (issue #183) › TEST-8: expanded is unclamped and still crisp (light)
    [gallery] › tests/e2e/visual/chat-collapse-borders.spec.ts:445:5 › chat collapse — card borders (issue #183) › TEST-8: expanded is unclamped and still crisp (dark)
    [gallery] › tests/e2e/visual/overlays.spec.ts:57:3 › overlays open — light
    [gallery] › tests/e2e/visual/overlays.spec.ts:57:3 › overlays open — dark
  23 passed (1.7m)
```

Identical spec+line set to the two independent worktrees in the brief. The
reported line numbers are the `test(...)` declaration lines, not the failing
assertions.

**Neither spec is a `toHaveScreenshot` failure.** `chat-collapse-borders.spec.ts:29-33`
says so explicitly ("`toHaveScreenshot` is not used because Layer B baselines are
gitignored"), and `overlays.spec.ts:85` gates its screenshot behind
`SNAPSHOTS_ENABLED`, which is false without `VISUAL_SNAPSHOTS`. There is no
baseline involved in any of the 7, so "stale baseline vs regression" is not the
axis; "stale TEST vs regression" is.

## A. `chat-collapse-borders` — verbatim failures

All five reduce to the same measurement:

```
  1) chat-collapse-borders.spec.ts:314:3 › TEST-2: the surface reproduces the bug preconditions
    Error: expect(received).toBeGreaterThanOrEqual(expected)
    Expected: >= 3
    Received:    0
    > 329 |     expect(inside.length).toBeGreaterThanOrEqual(3)

  2/3) chat-collapse-borders.spec.ts:358:5 › TEST-3 (light / dark)
    Error: no cards inside the clamp to check
    Expected: >= 3
    Received:    0
    > 246 |   expect(inside.length, 'no cards inside the clamp to check').toBeGreaterThanOrEqual(3)

  4/5) chat-collapse-borders.spec.ts:445:5 › TEST-8 (light / dark)
    Error: expect(received).toBeGreaterThanOrEqual(expected)
    Expected: >= 3
    Received:    0
    > 461 |       expect(inside.length).toBeGreaterThanOrEqual(3)
```

Note TEST-2 got PAST `collapsed === 'true'`, `overflow === 'hidden'`,
`maskImage !== 'none'` and `clampHeight <= 400` before failing at line 329 — the
clamp is intact; only its card contents are gone.

### A1. Live DOM probe of the surface (`gallery.html?surface=deep-chat-collapsed-tool-boxes`)

```
{ "cardsInMsg": 0, "cardsInDoc": 0, "cardTestids": [],
  "clampKids": [ { "tag": "div", "cls": "w-full flex flex-col gap-2" } ],
  "deepSample": [ {"testid":"activity-rail"}, {"testid":"rail-step"},
                  {"testid":"rail-step-toggle"}, {"testid":"rail-step-label"},
                  {"testid":"activity-rail"}, {"testid":"rail-step"}, ... ] }
```

Zero `[data-slot="card"]` in the entire document. The three blocks that used to be
cards are now three `activity-rail` / `rail-step` rows.

### A2. The #183 fix is still live and still working

Computed style of the clamped container, measured on the same load:

```
"clamp": { "h": 388, "pad": "2px", "margin": "-2px",
           "overflow": "hidden",
           "mask": "linear-gradient(rgb(0, 0, 0) 75%, rgba(0, 0, 0, 0))" }
```

The 2px self-cancelling inset from `f9071cd3f` is present, and `TEST-4` (the inset
self-cancels) and `TEST-5` (collapse still bounds the height) both **PASS** in the
baseline run. Nothing about the fix regressed.

### A3. What IS bordered inside the clamp now — and why it cannot serve as the subject

```
rail-step-toggle   boxShadow:none  borders:1px/1px/1px/1px  leftGap:26  rightGap:818
rail-step-record-btn boxShadow:none borders:1px/1px/1px/1px leftGap:838 rightGap:2
```

Rail buttons use a real CSS `border`, painted INSIDE the border box, so a border-box
clip cannot erase it. Retargeting the spec at these would produce a pin that stays
green with the #183 fix reverted — a vacuous test. (`rightGap: 2` also shows the
inset is what is currently keeping that button off the clip edge.)

### A4. Responsible change

- `RAIL_EXCLUDED_TYPES` across commits (`git show <c>:…/railSegmentation.ts`):
  - `cf5ef5fe2^1` — file does not exist (no rail)
  - `cf5ef5fe2` — `text, observation, file_attachment, image` (no `thinking`)
  - `3dba5f735^1` — `text, thinking, observation, file_attachment, image`
  - `3dba5f735` / `origin/main` — `text, observation, file_attachment, image`
- Fixture blocks (`chat-deep.ts` `collapsedToolBoxes`): `thinking`, `text`,
  `tool_use`, `text`, `tool_use`, `text` — i.e. all three cards were exactly the
  types the rail took over.
- `cf5ef5fe2` = "Merge feat/agent-core into main", 2026-07-29 → the spec has been
  red on `main` since that date.
- `f9071cd3f` (the #183 fix + this spec) is an ancestor of the rail merge
  (`git merge-base --is-ancestor` → true), so the spec predates the rail.
- The removal is DELIBERATE: `CLAUDE.md` §*Chat activity rail* ("Replaces the
  collapsible tool-group card with a thin timeline beside the answer") and
  `RailStepDetail.tsx:20-25` ("No nested disclosure … Delegating to the
  extension's full tool CARD instead would put a second bordered box … inside the
  very rail that exists to remove boxes").

**Classification: STALE TEST caused by a deliberate design change.** Not a
regression in disguise — the protection it guards is measurably still in place
(A2), and the thing it measured was removed on purpose.

## B. `overlays` — verbatim failure

```
  6/7) overlays.spec.ts:57:3 › overlays open — light / dark
    Test timeout of 60000ms exceeded.
    Error: locator.scrollIntoViewIfNeeded: Target page, context or browser has been closed
    > 64 |         await trigger.scrollIntoViewIfNeeded()
```

The reported line (64) is misleading — it is where the NEXT case was when the
budget ran out.

### B1. Trace timeline (`test-results/overlays-…-light-gallery/trace.zip`), seconds from test start

```
 6.47  step: dialog          →  10.55 OK
10.55  step: sheet           →  11.49 OK
11.49  step: sheet-loading   →  12.52 OK
12.52  step: confirm         →  16.88 OK
16.88  step: dropdown        →  17.94 OK
17.94  step: select
18.10    Click getByTestId('g-sel-filled')
18.64    Wait for selector getByRole('listbox').first()   → 18.76  (0.12s — already visible)
18.86    Evaluate  (assertLayoutSane)                     → 19.00
19.00    Press "Escape"                                   → 19.13
19.13    Wait for selector getByRole('listbox').first()  [state: hidden]
60.35  ── After Hooks (test timeout) ──
       step: combobox / multiselect / popover  NEVER RAN
```

The hang is the post-`Escape` hidden-wait on the `select` case.

### B2. Live DOM probe — the ambiguity

`role="listbox"` elements on the browse-all canvas, with ancestry:

```
--- before any overlay is opened
{"role":"listbox","inGalleryRoot":true,"visible":true,"w":304,
 "chain":"div < div < div < div#s1-picker-populated < div < div#gallery-case-s1-composer-picker-populated < div < section#gallery-section-s1-composer-picker"}
{"role":"listbox","inGalleryRoot":true,"visible":true,"w":224,
 "chain":"div < div < div < div#s1-picker-filtered < div < div#gallery-case-s1-composer-picker-filtered < div < section#gallery-section-s1-composer-picker"}

--- select open  (the genuine overlay, portaled OUTSIDE gallery-root)
{"role":"listbox","inGalleryRoot":false,"visible":true,"w":216,
 "chain":"div < div#g-sel-filled-popup < div < div < body < html"}
```

Two **permanently visible** listboxes live INSIDE `[data-testid="gallery-root"]`;
every genuine overlay portals OUTSIDE it. So `getByRole('listbox').first()` in DOM
order returns the composer picker, forever.

Portal-scoped selector `[role="…"]:not([data-testid="gallery-root"] *)`, measured
live:

```
listbox portal matches before open: 0   (visible: 0)
after select open   — portal visible listboxes: 1
after escape        — portal visible listboxes: 0
after combobox open — portal visible listboxes: 1
after escape        — portal visible listboxes: 0
g-ms-empty      portal visible dialogs: 1 → after escape: 0
g-popover-open  portal visible dialogs: 1 → after escape: 0
```

Exactly one visible match while open, zero otherwise, for all four role-addressed
cases — including the two (`multiselect`, `popover`) that have not run since
`c1a7c82a5`.

### B3. Responsible change

`c1a7c82a5` "feat(chat): one bounded, searchable composer picker popover"
(2026-08-08) added `overlay-composer-picker-populated` / `-filtered` /
`-no-matches` to `src-app/ui/src/modules/chat/gallery.tsx:141-200`. Its own
comment states the panel "is prop-driven … so it is rendered directly rather than
through its Popover" — i.e. deliberately inline and always open, which is
reasonable for the gallery and is exactly what makes a page-wide role query
ambiguous.

**Classification: REGRESSION.** A landed change broke a gate. Its worse half is
that before it started hanging it made two overlay cases assert against the wrong
element (INV-3 violated silently), and it stopped two more from running at all.

## C. Validity of the baseline run

Not applicable to the standalone visual invocation (`RUNTIME_FINDINGS.jsonl` is
produced by the runtime-health pass, not by `playwright.visual.config.ts`). The
full `gate:ui` validity check — `ERR_NETWORK_CHANGED` count in
`src/dev/gallery/RUNTIME_FINDINGS.jsonl` — is recorded in `TEST_RESULTS.md` for
the before/after `gate:ui` runs.
