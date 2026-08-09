# TESTS — visual-gate-red

Every test here already EXISTS as a spec; this branch makes the existing specs
measure the right thing again. The `[acceptance]` rows are the ones that would
fail if the invariant they name were violated, and each is paired with an
explicitly executed negative control (§Controls) so it cannot pass vacuously.

- **TEST-1** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: with the fixture rebuilt, ≥3 ring-bordered kit Cards sit INSIDE the clamped container and each has ≥1px of room against every clipping ancestor on left/right/top, in light AND dark (TEST-3 in the spec)
- **TEST-2** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-1] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: the pin proves the EFFECT, not the technique — the same spec additionally screenshots the 1px strip straddling each card edge against bare background and requires them to differ, so a `ring-0` regression fails even though the geometry is untouched (spec TEST-3 paint half); no assertion anywhere reads the inset's CSS values
- **TEST-3** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: the preconditions are genuinely reproduced — collapsed, `overflow:hidden`, a mask, clampHeight ≤ 400, one card wholly above the 75% ramp, one past it, one within 12px of the clamp top, and the rendered order is `card,text,card,text,card,text` (spec TEST-2)
- **TEST-4** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: the inset self-cancels — the clamp's content width equals its parent's collapsed AND expanded, and card widths are identical in both states (spec TEST-4)
- **TEST-5** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: collapse still bounds the message height (spec TEST-5)
- **TEST-6** (tier: e2e) [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: the expanded control is unclamped, unmasked, and every card's left edge is still painted, light AND dark (spec TEST-8)
- **TEST-7** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-4, ITEM-5] file: `src-app/ui/tests/e2e/visual/overlays.spec.ts` — asserts: for every role-addressed overlay (select, combobox, multiselect, popover) the handle the spec waits on and lays out was ABSENT before the click and is the single visible portal match after it — so "the overlay opened" is genuinely asserted and cannot resolve to an unrelated always-visible element
- **TEST-8** (tier: e2e) [covers: ITEM-4, ITEM-6] file: `src-app/ui/tests/e2e/visual/overlays.spec.ts` — asserts: all nine overlay cases RUN and pass Layer-A layout invariants in light and dark — including `multiselect` and `popover`, which have not executed since `c1a7c82a5` — and a failure to close is reported as a bounded, named failure instead of consuming the 60s test budget
- **TEST-9** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-2, ITEM-3] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: the restored subject does NOT come from putting a Card back inside the rail — the surface still renders `activity-rail` / `rail-step` rows for its tool block, and every card counted by the pin is an inline elicitation BREAKOUT (`rail-breakout` > `mcp-elicitation-*-card`), i.e. rendered through the ordinary content path rather than nested inside a rail row
- **TEST-11** (tier: e2e) [covers: ITEM-7, ITEM-8] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: every one of the fixture's bordered cards is present (`toHaveCount(3)`) on every load of the surface, in both themes, across repeated runs — the observable consequence of `ContentRenderer`/`ChatMessage` re-rendering when their extension registers. Before the fix this count was intermittently 0 (block stuck on `Unknown content type`) or 4 (a rail step stuck as a raw tool card)
- **TEST-12** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` — asserts: the paint probes sample the card's CURRENT position — `isEdgePainted` re-measures after the surface stops moving, so a scroll between measurement and screenshot can no longer be reported as a missing border
- **TEST-10** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/dev/gallery/coverage.ts` — asserts: `npm run check:gallery-coverage` still passes with the edited `via` reasons (the coverage generator is the executable check on this file)

## Controls (the anti-vacuity proofs, run and recorded in TEST_RESULTS.md)

- **CTRL-1** — revert the `-m-0.5 p-0.5` inset in `CollapsibleBlock.tsx` and re-run
  the chat-collapse specs: TEST-1 (spec TEST-3) MUST go RED with the `only 0px …
  on LEFT … This is issue #183` message. If it stays green, the retargeted fixture
  is a vacuous pin and ITEM-1 is wrong. Mirrors `input-group-overflow.spec.ts:258`.
- **CTRL-2** — re-point the overlays resolver back at `page.getByRole(role).first()`
  and re-run: TEST-7 MUST go RED on the "absent before the click" assertion,
  proving the new guard actually catches the `c1a7c82a5` ambiguity rather than
  merely stepping around it.

## Frontend gate

- `npm run check (ui)` — the static contract for the touched workspace, including
  `check:gallery-coverage` and `check:state-matrix`.
- `npm run gate:ui` — the runtime + visual gate, before and after, on the same
  box, with the `ERR_NETWORK_CHANGED` validity count recorded for each.
