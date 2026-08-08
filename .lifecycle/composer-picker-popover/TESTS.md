# TESTS — composer-picker-popover

Tiers mirror the workspace's real runners:

- `unit` → **vitest + jsdom component harness**, `cd src-app/ui && npm run test:component`
  (`vitest run .test.tsx`). The workspace's vitest `include` is
  `['src/**/*.store.test.ts', 'src/**/*.test.tsx']` — a plain `*.test.ts` would run
  **nothing**, so every spec below is `.test.tsx`. There is no `@testing-library/*` in
  this repo: mounting is React's own `createRoot` + `act`, interaction is
  `dispatchEvent`, exactly as
  `src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx` does.
  Popover content is portalled to `document.body`, so queries are scoped there.
- `e2e` → Playwright against the real stack,
  `cd src-app/ui && npm run test:e2e -- tests/e2e/chat/composer-picker-popover.spec.ts --workers=1`.

**Data is SEEDED, never assumed.** Every scale assertion creates its own 26 assistants /
26 knowledge bases over the REST API before navigating (both stores load once at shell
mount, so seeding must precede `page.goto`). No test asserts against whatever happens to
exist in the fixture DB.

## Tests

- **TEST-1** (tier: unit) [covers: ITEM-1, ITEM-4] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: typing into the search box filters the rendered options to case-insensitive substring matches (12 mounted items → exactly the 1 expected `role="option"`), and clearing the query restores all 12.
- **TEST-2** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: a query matching nothing renders the explicit "No matches." row AND zero `role="option"` elements — i.e. the no-result state is a real state, never a blank panel.
- **TEST-3** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: with zero items the caller-supplied `emptyContent` node renders and NO search box is present (nothing to search), distinguishing "nothing configured" from "no matches".
- **TEST-4** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: after the popover opens, `document.activeElement` IS the search input (`role="combobox"`) — the focus-on-open promise proven by mounting, not by reading the code.
- **TEST-5** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: ArrowDown/ArrowUp move `aria-activedescendant` across the FILTERED set (not the full set) and wrap at both ends; Home/End jump to the first/last filtered option.
- **TEST-6** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: Enter activates the option named by `aria-activedescendant` — `onSelect` receives THAT item's id after two ArrowDowns, not the first item's (a test that would still pass on a hardcoded "select the first match" is explicitly ruled out).
- **TEST-7** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: Escape closes the picker (its listbox leaves the DOM) and the keydown does NOT reach an outer listener installed on `document` — the parent "+" dropdown must survive.
- **TEST-8** (tier: unit) [covers: ITEM-1, ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: the ARIA contract — the search input is `role="combobox"` with a non-empty accessible name, `aria-expanded="true"` and an `aria-controls` resolving to the `role="listbox"` element; every row is `role="option"` with `aria-selected` reflecting the caller's selection set.
- **TEST-9** (tier: unit) [covers: ITEM-1, ITEM-9] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: import-graph — `AssistantMenuItem.tsx` and `KbMenuItem.tsx` each import `ComposerPickerPopover` and `PlusMenuItem`, and neither imports `Popover` or `ScrollArea` from `@ziee/kit` any more (mirrors the `railIsolation.test.ts` import-graph guard; it walks resolved imports, it does not pattern-match arbitrary source text).
- **TEST-10** (tier: unit) [covers: ITEM-2] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: an item whose label is 300 characters renders that label in a dedicated node carrying the full text in `title`, so the truncated text stays recoverable by the user (jsdom does no layout; the visual cap itself is proven by TEST-13).
- **TEST-11** (tier: e2e) [covers: ITEM-3, ITEM-7] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: with **26 seeded assistants**, the assistant submenu's list has a scrolling ancestor whose `scrollHeight > clientHeight`, and scrolling it to the bottom brings the LAST seeded assistant into view — proving the list is capped and genuinely scrollable rather than rendered full-length.
- **TEST-12** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-3, ITEM-8] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: with **26 seeded knowledge bases** the KB popover panel's `boundingBox().height` stays at or under the declared cap (≤ 340px: 256px list + search + padding) even though 26 rows exist, the scrolling element carries `data-overlayscrollbars-viewport` (the app's overlayscrollbars, NOT a native scrollbar), and the 26th KB is reachable only after scrolling. Fails if the list is unbounded (no overflow) or if a native scroller replaced `ScrollArea` (attribute absent).
- **TEST-13** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: after seeding an assistant with a 200-character name alongside short-named ones, the popover panel's `boundingBox().width` is ≤ 320px AND the long row's label element has `scrollWidth > clientWidth` (it is truncated) AND the label's `scrollWidth` is more than TWICE the panel's own width — i.e. the text needed far more room than the panel granted and the panel refused to grow to fit it. A short-name-only control is measured first and asserted to be within the cap too. Fails on the current `main` behaviour, where the panel grows to fit. (The panel legitimately grows WITHIN its 240–320px range; the invariant is the cap, not a fixed width — an earlier draft of this test asserted the stricter, wrong thing and went red at 320 vs 239.)
- **TEST-14** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-4, ITEM-5] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: for BOTH pickers, a search box exists at the TOP of the panel (it precedes the listbox in DOM order and is the first focusable element inside the panel), typing a seeded substring narrows the visible `role="option"` count, and a nonsense query renders "No matches." with zero options instead of an empty panel. For the KB picker it additionally asserts the box is present with only 3 KBs seeded, proving the old `> 6` threshold is gone.
- **TEST-15** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-6, ITEM-7] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: opening the assistant submenu puts focus in the search box; ArrowDown/ArrowUp move `aria-activedescendant` between seeded assistants; Enter selects the active one and the assistant status chip shows THAT name; Escape then closes the submenu while the parent "+" dropdown remains open (its other items still visible).
- **TEST-16** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-1, ITEM-7, ITEM-8] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: behavioural parity — opened in the same session, the assistant panel and the KB panel each expose a `role="combobox"` search box, a `role="listbox"`, `role="option"` rows, an overlayscrollbars viewport, and the SAME computed `max-width`/`max-height` on their panels. Fails if either picker still carries a bespoke shell (differing caps, a missing search box, or no listbox).
- **TEST-17** (tier: e2e) [covers: ITEM-8] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: KB multi-select still works through the primitive — filter to one KB, activate it, its chip appears in the composer, the "+" dropdown stays OPEN (KB is multi-select and must not close it), a second KB can be toggled on, and detaching removes the chip.
- **TEST-18** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: the assistant and knowledge-base trigger ROWS render with identical shared-row metrics (same computed padding, font-size and icon size as the MCP item, which already uses `PlusMenuItem`) and each exposes an accessible name — proving the two hand-rolled trigger copies were replaced by the shared row.
- **TEST-19** (tier: unit) [covers: ITEM-10] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: no file under `src-app/ui/src` imports `AssistantSelector`, and the file is gone from disk. (The registry half is enforced independently: `coverage.ts` / `stateCoverage.ts` are `satisfies Record<GallerySurface|RequiredState, …>`, so a stale key is a tsc error — a green `npm run check` is the machine proof that every manifest reference was removed too.)
- **TEST-20** (tier: e2e) [covers: ITEM-11] file: `src-app/ui/src/dev/gallery/stories/shard1.story.tsx` — asserts: the gallery story renders the picker panel in its populated (26-item), filtered, no-matches and zero-item cases, and `npm run gate:ui` reports zero HIGH runtime findings (console error / page error / failed request / AA-contrast) for that section, including at a narrow ~390px viewport. This is the populated-render + responsive coverage the UI build gate requires for a new surface.

- **TEST-21** (tier: unit) [covers: ITEM-12] file: `src-app/ui/package.json` — asserts: `npm run check` (the 20-gate static chain, incl. `check:testid-registry`, `check:state-matrix`, `check:gallery-coverage`, `check:overlay-registry`) exits 0 in this workspace. It exits **1** on a pristine `origin/main` worktree, so this is a measured before/after, not an assumption: the gate itself is the executable check that every registry is consistent with the source tree.

## Coverage map (bipartite check)

| ITEM | covering tests |
|---|---|
| ITEM-1 | TEST-1, TEST-8, TEST-9, TEST-16 |
| ITEM-2 | TEST-10, TEST-13 |
| ITEM-3 | TEST-11, TEST-12 |
| ITEM-4 | TEST-1, TEST-14 |
| ITEM-5 | TEST-2, TEST-3, TEST-14 |
| ITEM-6 | TEST-4, TEST-5, TEST-6, TEST-7, TEST-8, TEST-15 |
| ITEM-7 | TEST-11, TEST-15, TEST-16 |
| ITEM-8 | TEST-12, TEST-16, TEST-17 |
| ITEM-9 | TEST-9, TEST-18 |
| ITEM-10 | TEST-19 |
| ITEM-11 | TEST-20 |
| ITEM-12 | TEST-21 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-13 |
| INV-2 | TEST-12 |
| INV-3 | TEST-14 |
| INV-4 | TEST-16 |
| INV-5 | TEST-15 |

## Regression specs re-run (not new, must stay green)

These already drive the two pickers and are the blast-radius check for ITEM-7/ITEM-8:

- `src-app/ui/tests/e2e/chat/chat-input-slots.spec.ts` (`assistant-menu-trigger`)
- `src-app/ui/tests/e2e/14-knowledge-base/kb-attach-chat.spec.ts` (`kb-menu-trigger`, `kb-option-*`)
- `src-app/ui/tests/e2e/14-split-chat/kb-grounding-per-pane.spec.ts` (per-pane KB selection)

## No permission gate in this diff

The feature introduces **no** permission. It reuses the existing `assistants::read` and
`knowledge_base::use` gates unchanged (both `usePermission(...)` early-returns are
preserved verbatim by ITEM-7/ITEM-8), so no `[negative-perm]` restricted-user e2e is
required by A10 — and none is invented for appearance.
