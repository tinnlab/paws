# mobile-approval-clipped — TEST RESULTS

Frontend-only diff (`src-app/ui/**` + the `@ziee/kit` submodule), so the backend
integration chain does not apply and no backend gate line is claimed. Every result
below was observed in a run I performed and read; nothing is inferred.

Full logs: `/data/pbya/ziee/tmp/lifecycle-logs/denyclip-*.log`.

## Enumerated tests

Run: `cd src-app/ui && CHOKIDAR_USEPOLLING=1 npx playwright test -c playwright.visual.config.ts approval-actions-reachable --workers=1`
→ **22 passed, 0 failed**, twice consecutively (`final-stab-1.log`,
`final-stab-2.log`) after the phase-7 abort + re-scope. Run repeatedly on purpose:
round 5 proved a ~50% flake had been hiding behind a single green run. The 20 executions are the 9
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

- `npm run check (ui): PASS` — exit 0 (`npm-check9.log`, after the re-scope). Chains tsc +
  biome guardrails + lint:colors + settings-field + adjacent-inline + icon-action +
  hooks + logical-direction + tooltip-placement + kit-manifest + testid-registry +
  design-spec + gallery-coverage + gallery-crawl + fixtures + state-matrix +
  overlay/override/seed registries + store-actions.
- `gate:ui (ui): FAIL` — I have TWO paired branch/base runs on this box and they
  give OPPOSITE verdicts, so I do not have a measurement I can stand behind.
  Recorded as FAIL rather than reporting the flattering half.

  | pair | branch (gatingHIGH + visual) | base | verdict |
  |---|---|---|---|
  | A (`A7-branch2.log` / `A7-base.log`) | 0 + 3 = **3** (189/189 clean) | 8 + 2 = **10** | branch better |
  | B (`A7-branch-final.log` / `A7-base-final.log`) | 12 + 2 = **14** (156/168) | 7 + 3 = **10** | branch worse |

  What I did to resolve it, rather than pick:

  - The dominant signal in pair B is **2142 `ERR_NETWORK_CHANGED`** plus failed
    `@fs/` and dynamic-module fetches — the EMFILE/inotify cascade
    (`fs.inotify.max_user_instances` = 128 against ~65 Vite watchers). Those are
    network/loader failures; a CSS layout change cannot produce them.
  - Pair B's branch run implicated surfaces that DO render code I touched
    (`deep-chat-collapsed-tool-boxes`, `deep-chat-tool-group`,
    `deep-chat-mcp-toolcall-error`), so I checked the most-loaded one directly
    instead of assuming: scoped `runtime-health --only-match=collapsed-tool-boxes`
    gives **0 gating HIGH on the base AND 0 on the branch** (`rh2-base.log`,
    `rh2-branch.log`).
  - Across every run in this record, the five surfaces this diff actually changes
    carry **only LOW `spacing-grid`** findings — zero HIGH, zero MEDIUM.

  So the evidence says the branch is not worse, but the measurement is dominated
  by an environmental cascade that varies run to run, and one of two paired
  samples came out against it. **The orchestrator should re-run this gate on a
  quiet box** (`CHOKIDAR_USEPOLLING=1`, after killing any stale Vite for this
  worktree) and record the comparative line from that. `tsc` and `lint` were
  clean in all four runs.

`src-app/desktop/ui/**` is not touched by this diff (it consumes the same
`@ziee/kit` and `../../ui/src` via its Vite/`@source` config, verified by a
reviewer), so no `desktop/ui` gate line is claimed.

## Negative control — the red-first requirement

Each acceptance claim was run against the pre-fix behaviour with the spec
retained. Restoring the pre-fix CSS is a STRICTER control than stashing the diff:
the structure and selectors stay intact, so the tests fail on their ASSERTIONS.

**Control A — `CardActions` reverted to the hand-rolled `flex w-full justify-end
gap-2`** (`denyclip-NEGCTRL-final.log`): **13 failed / 7 passed**, e.g.

```
Error: tool-approval-deny: 81px of its 81px width is cut off by a non-scrolling clipping ancestor (taxonomy A11)
Error: the action row must be allowed to wrap
Error: tool-approval-deny is clipped in a 260px-wide card at a 1280px viewport (0px of 81px) — a viewport-driven rule would have missed this
Error: under an over-wide label, elicitation-decline is clipped (0px visible of 74px)
  - element is outside of the viewport          (TEST-1's trial click on Deny)
```

TEST-4 (the desktop no-regression control) correctly stayed GREEN — the defect is
narrow-width only.

**Control B — `wrap-anywhere` reverted to `break-words`** (`negctrl-wrapanywhere.log`):
2 failed, `an unbounded token must WRAP inside the control`. `break-words` is
excluded from min-content sizing; measured on a real button, 236/312 vs 236/236.

**Control C — the header row reverted to non-wrapping** (the ITEM-6 defect):
TEST-8 and TEST-10 both red —
`"get_forecast" is rendered 0px wide of the 98px it needs — a sibling starved it
out of the row`.

Note on TEST-10: its FIRST version asserted only "the server label renders", which
passed on the broken markup too (there the label wins the competition and the NAME
is starved). That is the vacuous-guard shape this spec keeps catching, so it was
rewritten to assert the JOINT property across all three identity labels, and
re-controlled.

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
