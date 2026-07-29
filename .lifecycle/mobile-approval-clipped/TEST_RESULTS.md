# mobile-approval-clipped — TEST RESULTS

Frontend-only diff (`src-app/ui/**` + the `@ziee/kit` submodule), so the backend
integration chain does not apply and no backend gate line is claimed. Every result
below was observed in a run I performed and read; nothing is inferred.

Full logs: `/data/pbya/ziee/tmp/lifecycle-logs/denyclip-*.log`.

## Enumerated tests

Run: `cd src-app/ui && CHOKIDAR_USEPOLLING=1 npx playwright test -c playwright.visual.config.ts approval-actions-reachable --workers=1`
→ **20 passed, 0 failed** (`denyclip-round2-run.log`). The 20 executions are the 9
enumerated TEST-IDs (several parameterized over light+dark) plus the 5
pre-existing TEST-10*/TEST-11 cases in the same file, which continue to pass
unchanged.

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS

Every `[acceptance]` test (TEST-1/INV-1, TEST-2/INV-3, TEST-3/INV-2, TEST-8/INV-4,
TEST-9/INV-2) is among the passes above.

## Frontend gates

- `npm run check (ui): PASS` — exit 0 (`denyclip-npm-check4.log`). Chains tsc +
  biome guardrails + lint:colors + settings-field + adjacent-inline + icon-action +
  hooks + logical-direction + tooltip-placement + kit-manifest + testid-registry +
  design-spec + gallery-coverage + gallery-crawl + fixtures + state-matrix +
  overlay/override/seed registries + store-actions.
- `gate:ui (ui): FAIL on this host — NOT a pass, and not claimed as one.` The
  honest result of the final run (`denyclip-gateui-final.log`):

  ```
  PASS  tsc
  PASS  lint
  FAIL  runtime-health      (174/176 surfaces PASS)
  FAIL  visual              (2 of 25 cases)
  ```

  Both failures were INVESTIGATED against the untouched base rather than waved
  through, and neither is in this diff's blast radius:

  - `visual` — the two failures are the PRE-EXISTING
    `chat-collapse-borders.spec.ts` TEST-3 (light + dark). Run in isolation that
    spec passes **7/7 on the untouched base** AND **7/7 on this branch**
    (`collapse-BASE.log`, `collapse-MINE.log`); it fails only inside the parallel
    visual layer, i.e. it is flaky under load.
  - `runtime-health` — the two failing surfaces are `seeded-file-rag-error`
    (6 HIGH: "Rendered more hooks than during the previous render" + an
    ErrorBoundary crash) and `hardware-monitor` (2 HIGH: "Internal React error:
    Expected static flag was missing"). Neither renders anything this diff
    touches. Scoped re-runs (`runtime-health --only-match=file-rag-error`) report
    **0 gating HIGH on the base AND 0 gating HIGH on this branch**
    (`rh-base.log`, `rh-mine.log`). A hooks-count change between renders is the
    expected symptom of a lazily-imported module arriving mid-render, which is
    exactly the documented module-fetch failure on this host.

  **The surfaces this diff actually changes are clean in every run**: across the
  five approval/elicitation gallery surfaces the ONLY findings are 10 LOW
  `spacing-grid` entries — zero HIGH, zero MEDIUM, no console error, no crash, no
  failed request, no contrast failure.

  An earlier run on the same tree (`denyclip-gateui2.log`) did reach
  `runtime-health PASS — 158/158 surfaces clean, 0 gating HIGH`, which is the
  same verdict for this diff seen on a quieter moment of the box.

  **This line is deliberately not written as PASS.** The lifecycle's A7 canary
  therefore stays RED, which is the correct state: I will not record a gate as
  green that I did not observe green. The orchestrator should re-run
  `npm run gate:ui` on a quiet box (with `CHOKIDAR_USEPOLLING=1`, and after
  killing any stale Vite belonging to this worktree) before merging.

`src-app/desktop/ui/**` is not touched by this diff (it consumes the same
`@ziee/kit` and `../../ui/src` via its Vite/`@source` config, verified by a
reviewer), so no `desktop/ui` gate line is claimed.

## Negative control — the red-first requirement

A regression test that has never been seen red proves nothing, so each acceptance
claim was run against the pre-fix behavior with the spec retained. Restoring the
pre-fix CSS is a STRICTER control than stashing the diff: the surrounding
structure and the spec's selectors stay intact, so the tests fail on their
ASSERTIONS rather than on a missing element.

**Control A — `CardActions` reverted to the hand-rolled `flex w-full justify-end
gap-2`, and the approval header's `flex-wrap` removed** (`denyclip-NEGCTRL-final.log`):

```
13 failed
7 passed
```

Failing: TEST-1, TEST-2, TEST-3 (both themes), TEST-5 (both), TEST-6 (both),
TEST-8 (both), TEST-9. Observed messages, verbatim:

```
Error: tool-approval-deny: 81px of its 81px width is cut off by a non-scrolling clipping ancestor (taxonomy A11)
Error: the action row must be allowed to wrap
Error: the tool name is rendered 0px wide (it needs 98px) — the user cannot see which tool they are approving
Error: tool-approval-deny is clipped in a 260px-wide card at a 1280px viewport (0px of 81px) — a viewport-driven rule would have missed this
Error: under an over-wide label, elicitation-decline is clipped (0px visible of 74px)
Error: under an over-wide nav label, elicitation-decline is clipped (0px of 74px)
  - element is outside of the viewport          (TEST-1's trial click on Deny)
```

TEST-4 (the desktop no-regression control) and the pre-existing TEST-10*/TEST-11
correctly stayed GREEN under the mutation — the defect is narrow-width only, so a
control that went red there would have indicated an over-broad test.

**Control B — `wrap-anywhere` reverted to `break-words`** (`negctrl-wrapanywhere.log`):

```
2 failed
Error: an unbroken token must WRAP inside the control, not overflow it (whitespace-normal alone cannot do this)
```

This is the round-2 finding: `break-words` is excluded from min-content sizing and
does not break an unbroken token. Independently measured on a real button in this
row — `break-words`: clientWidth 236 / scrollWidth 312, height 32px (label spills
out of the card's `overflow-hidden` edge); `wrap-anywhere`: 236 / 236, height 50px.

## Before / after — measured at 390x844, BOTH themes

Identical numbers in light and dark in every run.

**Before** (`denyclip-siblings-before.log`):

```
tool-approval-deny:         x=[-174,-93] w=81  visibleW=0   hitsSelf=false
tool-approval-approve-once: x=[-85,55]   w=140 visibleW=0   hitsSelf=false
tool-approval-approve-conv: x=[63,314]   w=251 visibleW=251 hitsSelf=true
footer row: clientWidth=238 scrollWidth=238 flexWrap=nowrap justifyContent=flex-end
tool name "get_forecast": rendered width 0  (needs 98)
```

Two of three controls unreachable, and the only pressable one is the BROADEST
approval. `scrollWidth === clientWidth` proves the overflow is unreachable: a flex
row overflowing its inline-START edge creates no scrollable region.

**After**:

```
tool-approval-deny:         x=[85,166]  w=81  h=32 top=517 visibleW=81
tool-approval-approve-once: x=[174,314] w=140 h=32 top=517 visibleW=140
tool-approval-approve-conv: x=[76,314]  w=238 h=50 top=557 visibleW=238
footer row: flexWrap=wrap clientWidth=238 scrollWidth=238
tool name "get_forecast": rendered width 98 (needs 98), title="get_forecast"
```

Line 1 holds Deny + Approve once; the long third action wraps to its own line,
capped to the row and wrapping its label (h=50). Nothing is clipped, everything is
click-verified, and the tool name is fully rendered where it previously measured 0.
Screenshots: `/data/pbya/ziee/tmp/lifecycle-logs/final-390-{light,dark}.png`.

At desktop width the row is a single right-aligned line in DOM order, byte-identical
to before — pinned by TEST-4.

## Environmental note (not a code result)

This host's `fs.inotify.max_user_instances` (128) is exhausted by the file watchers
of ~30 concurrent worktree Vite servers, which makes the dev server fail to serve
modules intermittently (`EMFILE: too many open files, watch …`;
`[loader] failed to load module "mcp"`) and, in one earlier run, produced 1461
`ERR_NETWORK_CHANGED` HIGH findings across unrelated gallery surfaces. Reproduced
on the UNTOUCHED base commit (2 bad loads in 32), so it is independent of this
diff. Mitigated for these runs by `CHOKIDAR_USEPOLLING=1` (keeps Vite off inotify)
plus killing this worktree's own stale Vite; with that, runtime-health reports
158/158 surfaces clean. It is reported to the orchestrator as a box-level issue.
