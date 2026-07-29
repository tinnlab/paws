# mobile-approval-clipped — TESTS

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test.

All tests live in the visual (gallery) Playwright project
(`playwright.visual.config.ts`), which boots ONLY the Vite dev server against the
backend-free gallery — so they RUN rather than self-skip, and they exercise the
REAL `ConversationPage` chat path, meaning the card under test sits in its real
virtualized, `overflow-hidden` container. That container is the whole defect, so a
mocked/unit render could not prove anything here.

## Tests

- **TEST-1** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: at 390x844, in BOTH light and dark, EVERY decision control on the tool-approval card (`tool-approval-deny`, `tool-approval-approve-once`, `tool-approval-approve-conv`) is genuinely REACHABLE rather than merely rendered — its centre point hit-tests back to itself (`document.elementFromPoint` resolves to the control or a descendant) AND Playwright can actually `click()` it. Written against the invariant's promise, not the implementation: it fails for ANY layout in which Deny is present-but-unpressable, including the measured pre-fix one (`visibleW=0 hitsSelf=false`).
- **TEST-2** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: at 390x844, in BOTH themes, no decision control's border-box escapes the intersection of its non-scrolling clipping ancestors (the taxonomy A11 predicate, evaluated over the real ancestor chain via `getComputedStyle().overflow`), and each control's visible width equals its full width. Distinct from TEST-1 — a control can hit-test at its centre while still having an edge clipped.
- **TEST-3** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-1] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: the action row resolves the overflow by WRAPPING rather than clipping — at 390px the footer row computes `flex-wrap: wrap`, its children occupy more than one line (distinct `getBoundingClientRect().top` values), and the row's `scrollWidth` does not exceed its `clientWidth` (no hidden horizontal overflow left over, reachable or not). Fails on a fix that merely moved the overflow to the other edge or added a horizontal scroller.
- **TEST-4** (tier: e2e) [covers: ITEM-2] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: at desktop width (1280x900) the approval card's action row is UNCHANGED by this fix — a single line (all three controls share one `top`), right-aligned, controls in DOM order Deny then Approve once then Approve for this conversation. The no-regression control for the wide case.
- **TEST-5** (tier: e2e) [covers: ITEM-3] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: the elicitation card's footer controls (`elicitation-decline`, `elicitation-submit`) are reachable and unclipped at 390x844 in both themes, and the footer row IS the shared primitive (`[data-slot="card-actions"]`) rather than a hand-rolled row — so the sibling cannot silently drift back onto the broken pattern.
- **TEST-6** (tier: e2e) [covers: ITEM-4] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: the ask-user wizard's footer controls (`elicitation-decline` plus whichever of `elicitation-back`/`elicitation-next`/`elicitation-submit` the current step renders) are reachable and unclipped at 390x844 in both themes; the footer keeps its `justify-between` split after adopting the primitive; and the NESTED navigation group also wraps (`flex-wrap: wrap`) — the nested-group gap raised as a CONCERN on ITEM-4 in PLAN_AUDIT.
- **TEST-7** (tier: e2e) [covers: ITEM-5] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: the pre-existing desktop reachability test (TEST-10b, `y`-bounds at 1280x900) still passes UNCHANGED alongside the new horizontal/hit-test assertions, and the new assertions are driven from one shared measurement helper used by every surface. Guards the failure mode that produced this bug: a reachability spec that only ever checked one axis at one viewport.

- **TEST-8** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-6] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: at 390x844, in BOTH themes, the approval card's TOOL NAME has a non-zero and legible RENDERED width (not merely a non-empty `textContent`) — pre-fix it measured `width=0` against a `scrollWidth` of 98 while the two `whitespace-nowrap` secondary labels took the full 238px row. Deliberately asserts rendered geometry rather than text presence: the pre-existing TEST-11 asserts `toContainText('get_forecast')` and passed for the entire life of the defect, which is exactly how a consent surface shipped unable to say what it was asking consent for.

## Negative control (the red-first requirement)

Each acceptance test is run against the PRE-FIX behavior, with the spec retained,
and must FAIL naming the control it protects. The pre-fix behavior is restored by
reverting the exact CSS the fix introduces — for TEST-1/2/3, `CardActions`'
class list is set back to the hand-rolled `flex w-full justify-end gap-2`; for
TEST-8, the header row's `flex-wrap`/`min-w-0` are removed. That is a stricter
control than stashing the whole diff, because the surrounding structure
(`data-slot="card-actions"`, the spec's selectors) stays intact, so the tests fail
on their ASSERTIONS rather than on a missing element. The observed red output is
recorded verbatim in `TEST_RESULTS.md`. A regression test that has never been seen
red proves nothing.

## Frontend gate

`npm run check (ui)` and `gate:ui (ui)` are required by phase 8 because the diff
touches `src-app/ui/**`. `src-app/desktop/ui/**` is NOT touched (the desktop
workspace imports the same `@ziee/kit` and inherits the primitive without a source
edit), so no `desktop/ui` gate line is claimed.
