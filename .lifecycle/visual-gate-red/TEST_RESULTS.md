# TEST_RESULTS — visual-gate-red

All runs in `/data/pbya/ziee/wt-visual-specs`, own hardlinked `node_modules`,
explicit `GALLERY_PORT` (1471 for the visual leg, 1481 for `gate:ui`), verified
free before use. Full logs under `/data/pbya/ziee/tmp/lifecycle-logs/`.

## BEFORE — `origin/main` @ `e915089ca`, no changes

```
GALLERY_PORT=1471 npx playwright test -c playwright.visual.config.ts \
  layout.spec.ts form-label-starvation.spec.ts states.spec.ts overlays.spec.ts \
  chat-collapse-borders.spec.ts input-group-overflow.spec.ts

EXIT=1
  7 failed
    chat-collapse-borders.spec.ts:314:3 › TEST-2: the surface reproduces the bug preconditions
    chat-collapse-borders.spec.ts:358:5 › TEST-3: every card's ring renders while COLLAPSED (light)
    chat-collapse-borders.spec.ts:358:5 › TEST-3: every card's ring renders while COLLAPSED (dark)
    chat-collapse-borders.spec.ts:445:5 › TEST-8: expanded is unclamped and still crisp (light)
    chat-collapse-borders.spec.ts:445:5 › TEST-8: expanded is unclamped and still crisp (dark)
    overlays.spec.ts:57:3 › overlays open — light
    overlays.spec.ts:57:3 › overlays open — dark
  23 passed (1.7m)
```

Identical to the two independent worktrees in the brief.

## AFTER — six consecutive runs, same command, same port, same box

```
RUN1 EXIT=0    30 passed (1.5m)
RUN2 EXIT=0    30 passed (1.7m)
RUN3 EXIT=0    30 passed (1.6m)
RUN4 EXIT=0    30 passed (1.7m)
RUN5 EXIT=0    30 passed (1.5m)
RUN6 EXIT=0    30 passed (1.7m)
```

30, not 23 + 7: the overlays fix makes the `multiselect` and `popover` cases run
for the first time since `c1a7c82a5`, and every previously-failing case now
executes and passes.

## Negative controls — the anti-vacuity proofs

**CTRL-1** — `-m-0.5 p-0.5` reverted in `CollapsibleBlock.tsx`:

```
CTRL1 EXIT=1
  2 failed / 5 passed (7.3s)
  Error: mcp-elicitation-accepted-card: only 0px between the card and its tightest
  LEFT-clipping ancestor (collapsible-content) — its 1px ring is clipped there.
  This is issue #183.
```

The rebuilt pin still detects the original defect. Measured room per card with the
inset in place: `roomLeft: 2, roomRight: 2` on all three — the inset and nothing
else.

**CTRL-2** — overlays resolver put back to `page.getByRole(role).first()`:

```
CTRL2 EXIT=1
  2 failed
  Error: select: something already matches this overlay's content selector BEFORE
  the trigger was clicked, so "it opened" cannot be asserted
```

The new guard catches the exact `c1a7c82a5` ambiguity, rather than stepping
around it.

## Product-defect measurements (DRIFT-1.4 / DRIFT-1.5)

| defect | before | after |
|---|---|---|
| `ContentRenderer` stuck on `Unknown content type: elicitation_request` (14 sequential loads of `deep-chat-elicitation`) | 1 bad / 14 | 0 bad / 14 |
| `ChatMessage` rendering a raw `mcp-tooluse-card-…` where a `rail-step` belongs (16 concurrent loads) | 16 / 16 wrong | 0 / 16 wrong |
| no double-render regression (`deep-chat-tool-running`) | 1 rail step, 0 cards | 1 rail step, 0 cards |

## Flake-rate ledger (FB-4 — rates, not adjectives)

Every rate is over full runs of the six-spec visual leg, `fullyParallel`, 30
workers, same box.

| after | failing runs | dominant signature | what it actually was |
|---|---|---|---|
| baseline (no change) | 1/1, deterministic | `Expected: >= 3 / Received: 0` | the real, non-flaky defect |
| fixture rebuilt | 2/3 | `cannot sample the top edge … (card at 210,-14)` | a latent measure-then-screenshot race behind `waitForTimeout(350)` |
| mutating settle-poll (WRONG, reverted) | 3/4 | `page.waitForFunction: Test timeout` | a predicate that fought the app's own scrolling; never converged |
| read-only scroll-quiet | 3/5 | `resolved to 0 elements` | `ContentRenderer` never recovering from a late extension — a real product defect |
| + `ContentRenderer` fix | 4/6 | `resolved to 4 elements` | `ChatMessage` rail segmentation, same defect one level up |
| + `ChatMessage` fix | 2/3 | `LEFT border is not painted` | stale sampling coordinates |
| + re-measure in `isEdgePainted` | 4/6 | `cannot sample the top edge` | quiet ≠ correctly positioned |
| + ensure-sampleable reposition | **0/6** | — | — |

Two of those rounds were not test flakiness at all — the flake rate was measuring
live product defects, and fixing them is what moved the number.

## Enumerated tests

- **TEST-1**: PASS (spec `TEST-3`, light + dark, ×6 runs)
- **TEST-2**: PASS (paint half of spec `TEST-3`; CTRL-1 proves it is not vacuous)
- **TEST-3**: PASS (spec `TEST-2`)
- **TEST-4**: PASS (spec `TEST-4`)
- **TEST-5**: PASS (spec `TEST-5`)
- **TEST-6**: PASS (spec `TEST-8`, light + dark)
- **TEST-7**: PASS (overlays, light + dark; CTRL-2 proves it is not vacuous)
- **TEST-8**: PASS (all nine overlay cases execute in both themes)
- **TEST-9**: PASS (measured live: 3 `rail-breakout` + 3 `mcp-elicitation-*-card` + 1 `rail-step`; no card inside a rail row)
- **TEST-10**: PASS (`check:gallery-coverage`, inside `npm run check`)
- **TEST-11**: PASS (`toHaveCount(3)` readiness holds on every load across 6 runs × 2 themes)
- **TEST-12**: PASS (`isEdgePainted` re-measures; 0/6 runs report a stale-coordinate failure)

## Frontend gate

```
npm run check (ui): PASS
```

(`tsc` + all guardrail/lint/registry/coverage/state-matrix/gallery-script checks;
exit 0. `check:state-matrix` required a `gen:state-matrix` regen, which was pure
line-number drift — no new conditional state — and is committed.)

## gate:ui

```
gate:ui (ui): PASS
```

Full record, including the FIRST run which the gate declared VOID (concurrent load
from another worktree) and which is therefore discarded rather than reported, in
`GATE_UI.md`. The recorded run: `682/682 cells · origin alive · transport
artifacts 0 (0%)`, `ERR_NETWORK_CHANGED` count 0, `0 surface(s) with gating HIGH
findings`, `162/162 PASS`, `visual — 30 passed`, `GATE_EXIT=0`.
