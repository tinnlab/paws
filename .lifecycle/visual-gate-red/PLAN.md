# PLAN — visual-gate-red

`npm run gate:ui`'s **visual** step is RED on `origin/main` (`e915089ca`):
**7 failed / 23 passed, exit 1**. Reproduced verbatim in this worktree before any
change (see `REPRO.md`).

The seven failures are **two unrelated causes** on two unrelated surfaces, and
**neither is a `toHaveScreenshot` failure** — the brief's "Layer B pixel
regression / stale baseline" framing does not apply. `chat-collapse-borders.spec.ts`
states in its own header that it deliberately does not use `toHaveScreenshot`
(Layer B baselines are gitignored), and `overlays.spec.ts` gates its
`toHaveScreenshot` call behind `SNAPSHOTS_ENABLED`, which is OFF in the gate's
default (non-`VISUAL_SNAPSHOTS`) invocation. Both failures are behavioural
assertions on live DOM. There is no baseline to bless, and nothing here can be
made green by re-blessing.

## Design source

- **Cause A** realizes `f9071cd3f:.lifecycle/collapse-border-overlay/PLAN.md`
  (issue #183 — "collapse-border-overlay") §*Root cause (two mechanisms)* +
  §ITEM-1, and the design restated verbatim in the header of
  `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts:1-33`.
- **Cause B** realizes the contract stated in the header + inline design comments
  of `src-app/ui/tests/e2e/visual/overlays.spec.ts:1-14` and `:72-79`
  ("Wait for it to settle — if the trigger failed to open, this times out and
  FAILS (no catch), so 'opened' is genuinely asserted").
- Context for why Cause A's subject disappeared: the activity-rail design, as
  recorded in `CLAUDE.md` §*Chat activity rail* ("Replaces the collapsible
  tool-group card with a thin timeline beside the answer") and in
  `src-app/ui/src/modules/chat/components/rail/RailStepDetail.tsx:20-27`
  (INV-7, "No nested disclosure").

## Invariants

- **INV-1**: "for every card inside the clamp, its border box must sit at least
  1px inside the clipping edge, which is exactly the condition under which a
  1px-spread ring survives" (`chat-collapse-borders.spec.ts:19-21`, verbatim).
- **INV-2**: "Asserting the inset's classes instead (`padding === '2px'`) would
  freeze the technique — any equivalent re-implementation (a wrapper element, a
  `mask-clip` override) would fail spuriously while the surface stayed correct,
  and such a test would not have caught the original bug at all"
  (`chat-collapse-borders.spec.ts:21-24`, verbatim). The pin must stay a
  fixture-driven EFFECT assertion, never an assertion on the fix's CSS.
- **INV-3**: "Wait for it to settle — if the trigger failed to open, this times
  out and FAILS (no catch), so 'opened' is genuinely asserted"
  (`overlays.spec.ts:72-74`, verbatim). The handle the spec waits on and asserts
  against must be the overlay that the click OPENED.
- **INV-4**: "No nested disclosure. The rail row already carries the tool name,
  the status glyph, the timing and the expander, so this renders ONLY what the
  row cannot. Delegating to the extension's full tool CARD instead would put a
  second bordered box with a second chevron inside the very rail that exists to
  remove boxes" (`RailStepDetail.tsx:20-25`, verbatim). The repair to Cause A may
  NOT put a Card back into the rail to give the old spec its subject.

## Measured root causes

### Cause A — `chat-collapse-borders.spec.ts` (5 of the 7): stale test, deliberate design change

Measured on the live surface (`REPRO.md` §A): the assistant turn on
`deep-chat-collapsed-tool-boxes` contains **zero `[data-slot="card"]` elements —
in the whole document**. Every assertion that fails is a variant of
`cards.filter(insideClamp).length >= 3` receiving `0`.

The clamp itself is intact and the #183 fix is still live and still doing its job
— measured on that container today: `padding: 2px`, `margin: -2px`,
`overflow: hidden`, `mask-image: linear-gradient(rgb(0,0,0) 75%, rgba(0,0,0,0))`.
The subject vanished, not the protection.

**Responsible change: the activity rail**, which landed on `main` at
`cf5ef5fe2` ("Merge feat/agent-core into main", 2026-07-29). The rail segments
every content block not in `RAIL_EXCLUDED_TYPES` into a timeline ROW instead of an
inline card. `tool_use` became a rail step when the rail landed; `thinking` — the
last inline card on this fixture — was moved into the rail by
`3dba5f735` ("feat(rail): reasoning becomes a rail step (DEC-13)"), which removed
`'thinking'` from `RAIL_EXCLUDED_TYPES` (verified by `git show` on both sides of
that commit). The fixture's three cards were exactly one `thinking` + two
`tool_use` blocks.

This is a **deliberate** change, not an accidental one wearing a costume: it is
the rail's stated purpose in `CLAUDE.md`, and `RailStepDetail.tsx` refuses to
render the extension's card *by design* (INV-4). The spec has therefore been red
on main since 2026-07-29 — ~11 days — with nobody owning it.

The bordered elements inside the clamp today are rail-step buttons using a real
CSS `border: 1px` (painted INSIDE the border box), so the #183 mechanism cannot
touch them; retargeting the spec at rail steps would produce a pin that passes
with the fix reverted (a vacuous test).

### Cause B — `overlays.spec.ts` (2 of the 7): a real regression, and a silent one

Measured (`REPRO.md` §B): the browse-all gallery canvas now renders **two
permanently-visible `role="listbox"` elements** inside `[data-testid="gallery-root"]`
— the composer-picker PANEL, rendered inline (not through its Popover) by the
gallery cases `overlay-composer-picker-populated` / `-filtered`, added by
`c1a7c82a5` ("feat(chat): one bounded, searchable composer picker popover",
2026-08-08).

The spec resolves the overlays that expose no content testid with
`page.getByRole('listbox').first()`. That now matches the composer picker, not
the overlay under test. Consequences, in order of severity:

1. **The `select` and `combobox` cases went VACUOUS.** `waitFor({state:'visible'})`
   resolved in 0.12s against an element that was already visible (trace timings in
   `REPRO.md`), so "the overlay opened" stopped being asserted, and
   `assertLayoutSane` ran against the composer picker instead of the opened
   listbox. This is a direct violation of INV-3, and it would have persisted
   silently.
2. **Then it hangs.** After `Escape`, `content.waitFor({state:'hidden'})` waits on
   the composer picker, which is never hidden. `locator.waitFor` has no default
   timeout, so the `.catch(() => undefined)` can never fire; the test burns the
   full 60s budget and dies at `Test timeout of 60000ms exceeded`. The `multiselect`
   and `popover` cases, which come after `select` in the list, **never run at all**.

## Items

- **ITEM-1**: Restore a real subject for the #183 pin without violating INV-4:
  rebuild the `deep-chat-collapsed-tool-boxes` fixture's three in-clamp cards out
  of resolved `elicitation_request` blocks. A BLOCKING step is a rail BREAKOUT, not
  a row (`ChatMessage.tsx` — "It renders through the ORDINARY content path"), so it
  still renders the extension's full kit `<Card size="sm">` whose border is the same
  `ring-1 ring-foreground/10` the #183 defect erased
  (`sdk/packages/kit/src/shadcn/card.tsx:15`) — the identical mechanism, on a
  content type the rail does not swallow, in a state the product genuinely
  produces. Keep the tuned geometry: card at the clamp top, one card wholly above
  the 75% mask ramp, one straddling it, interleaved `card,text,card,text,card,text`,
  turn > 1200 chars so it clamps.
  *(Amended during phase 5 — see DRIFT-1.1. The first draft said `observation`
  blocks; measurement showed those ride a USER-role message, so an assistant turn
  carrying them is a shape the product cannot produce.)*
- **ITEM-2**: Keep the rail present on that surface (append a `tool_use` block
  after the cards) so the fixture represents a REAL modern clamped turn — rail
  steps and inline cards together — rather than a museum piece built only to
  satisfy the spec.
- **ITEM-3**: Update the surface's title/note and the two now-false `coverage.ts`
  `via` reasons that claim this surface pins `ThinkingContent`'s clamped state. It
  no longer does (the rail renders `thinking`), and a coverage reason that asserts
  a protection which does not exist is the same class of decay as the red spec.
- **ITEM-4**: Fix `overlays.spec.ts` to resolve role-addressed overlay content in
  the PORTAL LAYER — `[role="…"]:not([data-testid="gallery-root"] *)` — so it can
  only ever match content portaled outside the gallery canvas. Measured: 0 matches
  before opening, exactly 1 visible match while open, 0 after `Escape`, for
  `select`, `combobox`, `multiselect` and `popover`.
- **ITEM-5**: Make the vacuity that hid this impossible to recur: require the
  resolved handle to be **absent before the click and present after**, and assert
  exactly ONE visible match rather than silently taking `.first()`. This is what
  turns INV-3 from a comment into an executed assertion.
- **ITEM-7**: Make `ContentRenderer` re-render when a chat extension registers.
  It reads a MUTABLE registry and is `memo`'d on props that do not change when an
  extension arrives, so a block rendered first fell through to the
  `Unknown content type: …` branch and stayed there for the life of the message.
  *(Added during phase 5 — see DRIFT-1.4. A live, user-facing defect found by the
  repair: an elicitation — a blocking request for user input — rendering as debug
  text, measured at ~1 load in 10.)*
- **ITEM-8**: The same fix one level up in `ChatMessage`, whose rail segmentation
  reads the registry unsubscribed, so a message segmented before the rail
  contributions registered rendered raw tool cards and never showed the activity
  rail. *(Added during phase 5 — see DRIFT-1.5.)*
- **ITEM-9**: Remove the measure-then-screenshot race in `chat-collapse-borders`:
  wait for the turn's position to stop changing, position it once with a bounded
  retry, and RE-MEASURE each card immediately before sampling it, so a scroll
  between measurement and screenshot can no longer be reported as a missing border.
  *(Added during phase 5 — see DRIFT-1.6.)*
- **ITEM-6**: Bound the close wait (`waitFor({state:'hidden'}, {timeout})`) so the
  existing `.catch(() => undefined)` can actually fire. Today an overlay that fails
  to close consumes the whole 60s test budget and reports a misleading
  `scrollIntoViewIfNeeded ... browser has been closed` on the NEXT case.

## Files to touch

- `src-app/ui/src/dev/gallery/fixtures/chat-deep.ts` (ITEM-1, ITEM-2)
- `src-app/ui/src/modules/chat/gallery.tsx` (ITEM-3 — title/note)
- `src-app/ui/src/dev/gallery/coverage.ts` (ITEM-3 — the two `via` reasons)
- `src-app/ui/tests/e2e/visual/overlays.spec.ts` (ITEM-4, ITEM-5, ITEM-6)
- `src-app/ui/tests/e2e/visual/chat-collapse-borders.spec.ts` (comment only, if
  the header's account of the subject needs to match the new fixture)

No backend, no migration, no permission, no schema, no `sdk` change is expected.

## Patterns to follow

- The fixture change mirrors the sibling bundles already in `chat-deep.ts`
  (`toolGroup`, `toolRunning`) — same `message()` / `conversation()` helpers, same
  `as MessageContentData` casts, same style of comment explaining WHY each block's
  length is what it is (the existing `collapsedToolBoxes` comments are the model).
- The `observation` block shape is taken from the type the renderer reads,
  `ObservationContent.tsx:22` (`content.content as { text?: string }`).
- The overlays fix mirrors the resolution style already used in the same file for
  the testid path (`page.getByTestId(o.content)`) — one resolver helper, both
  branches, no per-case special-casing.
- The negative-control pattern (prove the pin still goes RED when the fix is
  reverted) mirrors `input-group-overflow.spec.ts:258`
  ("TEST-7 control: the probe fails when the reverted rule is re-injected"),
  which is the in-repo precedent for proving a visual pin is not vacuous.

## Items — plan audit (phase 2)

- **ITEM-1** — verdict: PASS — `observation` is in `RAIL_EXCLUDED_TYPES`
  (`railSegmentation.ts:49`) and `ObservationContent` renders `<Card size="sm">`
  (`ObservationContent.tsx:33`), whose kit base carries `ring-1 ring-foreground/10`.
  Both verified in the tree, not assumed. Geometry must be re-measured after the
  edit, not calculated — recorded as a drift risk.
- **ITEM-2** — verdict: PASS — additive; the rail already renders on this surface
  today (measured: 3 `rail-step` rows), so keeping one changes nothing structural.
- **ITEM-3** — verdict: CONCERN — `coverage.ts` is an input to
  `npm run check:gallery-coverage`. Editing a `reason` string is safe (the gate
  keys on the surface path), but the run must confirm it. Slug is deliberately NOT
  renamed: it is referenced by `coverage.ts`, `gallery.tsx`, the spec and the
  generated registries, and a rename buys accuracy at the cost of a
  regen/gate blast radius disproportionate to this fix. Recorded in DECISIONS.
- **ITEM-4** — verdict: PASS — the portal-scope selector is verified against the
  live DOM for all four role-addressed cases (`REPRO.md` §B2), not reasoned about.
- **ITEM-5** — verdict: PASS — strictly strengthens; no existing passing case
  relies on ambiguous resolution (dialog/sheet/confirm/dropdown use content
  testids and are untouched).
- **ITEM-6** — verdict: PASS — restores the author's stated intent
  (`.catch(() => undefined)`), which is unreachable without a timeout.
- **ITEM-7** — verdict: PASS — uses the registry's OWN published signal, already
  consumed the same way by `useChatExtensionList`
  (`core/extensions/contributions.tsx:36`); no new mechanism invented.
- **ITEM-8** — verdict: CONCERN — a re-render on registry change could in principle
  double-render a block the rail already consumed. Checked by running:
  `deep-chat-tool-running` still reports 1 rail step / 0 cards after the change, and
  `deep-chat-tool-group` is unchanged. Concern closed by measurement, not argument.
- **ITEM-9** — verdict: PASS — confined to the spec's own helpers; it strengthens
  the fail-closed guard (fresh coordinates) rather than relaxing it.

## Breakage risk

`overlays.spec.ts` currently never reaches `multiselect` and `popover`; the fix
makes them run for the first time since `c1a7c82a5`. Measured pre-emptively
(`REPRO.md` §B2): both resolve to exactly one visible portal dialog and close on
`Escape`. If either had a real layout defect, this fix would surface it — that is
the gate working, and it will be reported as such rather than worked around.

The fixture edit changes what `runtime-health` crawls on that surface (one fewer
`thinking` block, three `observation` blocks). `observation` already renders on
other seeded surfaces, so no new component enters the crawl.

## Pattern conformance

Both edits stay inside the existing file conventions listed under *Patterns to
follow*. No new helper module, no new gallery surface, no change to
`gallery.config.json`'s `visualSpecs`.

## Migration collisions

None — no `.sql` in this diff. Highest server migration prefix in the tree is
unchanged by this branch.

## OpenAPI regen

Not implied — no Rust type, handler, or schema is touched, so neither
`openapi.json` nor `api-client/types.ts` changes in either workspace.
