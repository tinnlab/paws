# mobile-approval-clipped — TEST RESULTS

Frontend-only diff (`src-app/ui/**` + the `@ziee/kit` submodule), so the backend
integration chain does not apply and no backend gate line is claimed. Every result
below was observed in a run I performed and read; nothing is inferred.

Full logs: `/data/pbya/ziee/tmp/lifecycle-logs/denyclip-*.log`.

## Enumerated tests

Run: `cd src-app/ui && CHOKIDAR_USEPOLLING=1 npx playwright test -c playwright.visual.config.ts approval-actions-reachable --workers=1`
→ **22 passed, 0 failed** (`round4-final2.log`, the run after the round-4 fixes).
The 22 executions are the 10 enumerated TEST-IDs (most parameterized over
light+dark) plus the pre-existing TEST-10*/TEST-11 cases in the same file, which
continue to pass unchanged. The 20 executions are the 9
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
- **TEST-10**: PASS

Every `[acceptance]` test (TEST-1/INV-1, TEST-2/INV-3, TEST-3/INV-2, TEST-8/INV-4,
TEST-9/INV-2, TEST-10/INV-4) is among the passes above.

## Frontend gates

- `npm run check (ui): PASS` — exit 0 (`npm-check7.log`, after the round-4 fixes). Chains tsc +
  biome guardrails + lint:colors + settings-field + adjacent-inline + icon-action +
  hooks + logical-direction + tooltip-placement + kit-manifest + testid-registry +
  design-spec + gallery-coverage + gallery-crawl + fixtures + state-matrix +
  overlay/override/seed registries + store-actions.
- `gate:ui (ui): branch 3 vs base 10` — the baseline-controlled form, from two
  FULL `gate:ui` runs on the SAME box, back-to-back, differing only in whether
  the product diff was checked out (`A7-branch2.log`, `A7-base.log`):

  | | gating-HIGH surfaces | visual failures | total |
  |---|---|---|---|
  | **branch** | **0** (189/189 clean) | 3 | **3** |
  | **base**   | **8** (180/188 clean) | 2 | **10** |

  The count is `surfaces with gating HIGH runtime findings + failing visual test
  cases`, i.e. everything `gate:ui` itself fails on. Branch 3 <= base 10, and on
  the runtime-health axis the branch is strictly better (0 vs 8: the base run
  showed `seeded-live-logs-empty` at 255 HIGH, `seeded-s1-array-empty` at 243,
  and six more, none of which this diff can reach).

  **The one axis where the branch looks worse, stated plainly:** 3 visual
  failures vs 2. All are the SAME pre-existing spec, `chat-collapse-borders`
  TEST-3/TEST-8, and it is flaky on both sides. Paired standalone sampling on
  this box, same command, same day: **base 7/7, 7/7, 6/7** and **branch 6/7,
  7/7** — same spec, same failing case (TEST-3 dark), comparable rate. Nothing in
  the sample supports "the branch made it worse", and the branch's own 22-test
  spec passes 22/22.

  `tsc` and `lint` are clean in both runs. **Absolute PASS was not attainable on
  this box**: `fs.inotify.max_user_instances` is 128 against ~65 Vite watchers, so
  Vite dies with EMFILE and the failing-surface set changes every run —
  `CHOKIDAR_USEPOLLING=1` (used for every run recorded here) reduces but does not
  eliminate it, which is exactly the situation the comparative form exists for.

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

**Control D — the identity clamp neutered to `maxHeightPx={999999}`** (i.e. the
unbounded behaviour round 3 shipped):

```
4 failed
Error: a 6400-char tool name produced a 12816px identity region — it is not clamped, so a hostile server controls the card's height
Error: the server label and Deny span 1693px in a 844px viewport — an unbounded label is pushing the refuse control off screen
```

This is the round-4 finding: round 3 fixed the truncation by removing the BOUND,
which handed a hostile server unbounded control of the consent card's height. The
clamp restores it — the same 6400-char name now yields a 60px region and a 583px
card.

**Control C — the two attacker-controlled header labels reverted to
`truncate` / `whitespace-nowrap`** (round-3 fix):

```
2 failed
Error: the tool name overflows its box (534px of 238px) — a long attacker-chosen name is being hidden, so the user cannot tell which tool they are approving
```

534/238 is the round-3 reviewer's own independently measured number for a
64-character tool name, so the guard now fails on exactly the case it exists for
— which the previous, fixture-bound TEST-8 could never have reached.

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
