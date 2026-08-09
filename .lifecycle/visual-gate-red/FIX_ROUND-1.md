# FIX_ROUND-1

Tier is LIGHT (diff well under 800 lines; no permission, migration, module or
public API/schema change), so one audit round applies. Two angles were run over
the diff: **correctness** and **tests-quality**, plus **design-conformance** (the
required angle) against the two named designs and their invariants.

## Disposition

Every confirmed finding in `LEDGER.jsonl` is FIXED in this branch, and each has an
executed proof rather than an argument:

| finding | fix | proof |
|---|---|---|
| overlays resolve to an inline gallery panel | portal-scoped selector + absent-before / exactly-one-after | CTRL-2: restoring `.first()` turns TEST-7 RED with `select: something already matches … BEFORE the trigger was clicked` |
| multiselect + popover never ran | same fix; the loop now reaches them | both open and close cleanly, measured, and the spec passes in both themes |
| unreachable `.catch()` on the close wait | bounded `timeout: CLOSE_TIMEOUT_MS` | a stuck overlay now fails its own case in 5s instead of the next case's first action at 60s |
| the #183 pin has no subject | fixture rebuilt on elicitation breakouts | CTRL-1: reverting `-m-0.5 p-0.5` turns the spec RED with `only 0px between the card and its tightest LEFT-clipping ancestor (collapsible-content) … This is issue #183` |
| stale `coverage.ts` reason | reason corrected, and states plainly what is NOT pinned | `npm run check:gallery-coverage` green inside `npm run check` |
| `ContentRenderer` never recovers from a late extension | subscribe to the registry's published version | 1/14 bad loads before → 0/14 after |
| `ChatMessage` rail segmentation, same defect | same subscription | 16/16 wrong-card under concurrency before → 0 after; `deep-chat-tool-running` unchanged (1 rail step / 0 cards), so no double-render |
| measure-then-screenshot race | re-measure inside `isEdgePainted` after quiet, bounded reposition | 6 consecutive full visual runs, 30/30 each |
| readiness waited on the clamp, not the cards | explicit `toHaveCount(3)` readiness wait | same 6 runs |
| flush-at-top precondition unmeetable | bound raised to the MEASURED 12px, with the lost coverage named in the code | left/right room measured at exactly 2px, so CTRL-1 still fires |

## Two things this round is deliberately NOT doing

- **`ThinkingContent` may now be dead code.** The rail renders `thinking`, and
  `RailStepDetail` refuses to delegate to the extension's card, so the component
  may have no live render path. The stale coverage reason that asserted otherwise
  is corrected to say so; the *component's* fate is a separate question and is not
  decided here. Flagged, not silently deleted.
- **The `my-2` vs `mb-2` inconsistency** between the elicitation wrapper and the
  other inline message blocks (each already sits in a `gap-2` column, so `my-2`
  double-spaces above) is real but is production spacing. Changing it to make a
  test's precondition hold would be the tail wagging the dog; recorded instead.

## Guard-substitution check

Round-1 findings are spread across 5 files (2 specs, 2 components, 1 fixture) with
no single file above 40% of the round, so the GUARD-SUB tripwire (≥60% on one
test/guard file) does not fire. The one case that came close — three successive
edits inside `chat-collapse-borders`'s positioning helpers — is recorded honestly:
the second attempt was WRONG (a mutating poll) and was replaced rather than
patched, and the third change removed the whole class by re-measuring at the point
of use instead of adding another predicate.

**New confirmed findings:** 0
