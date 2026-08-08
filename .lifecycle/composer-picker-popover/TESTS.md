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
- **TEST-11** (tier: e2e) [covers: ITEM-3, ITEM-7] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: with **26 seeded assistants**, the assistant panel's measured height stays within the declared cap (the SAME bound TEST-12 holds the KB panel to), its list has a scrolling ancestor whose `scrollHeight > clientHeight`, and the 26th assistant is GEOMETRICALLY outside the scroller's box before scrolling and inside it after. (`toBeVisible()` alone is true for a row clipped inside a scroller, so reachability is asserted with bounding-box containment, not visibility.)
- **TEST-12** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-3, ITEM-8] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: with **26 seeded knowledge bases** the KB popover panel's `boundingBox().height` stays at or under the declared cap (`MAX_PANEL_HEIGHT` = 360px: the 256px list + the search box + panel padding + the popup ring) even though 26 rows exist, the scrolling element carries `data-overlayscrollbars-viewport` (the app's overlayscrollbars, NOT a native scrollbar), and the 26th KB is geometrically outside the scroller's box before scrolling and inside it after. Fails if the list is unbounded (no overflow) or if a native scroller replaced `ScrollArea` (attribute absent).
- **TEST-13** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: after seeding an assistant with a 200-character name alongside short-named ones, the popover panel's `boundingBox().width` is ≤ 320px AND the long row's label element has `scrollWidth > clientWidth` (it is truncated) AND the label's `scrollWidth` is more than TWICE the panel's own width — i.e. the text needed far more room than the panel granted and the panel refused to grow to fit it. A short-name-only control is measured first and asserted to be within the cap too. Fails on the current `main` behaviour, where the panel grows to fit. (The panel legitimately grows WITHIN its 240–320px range; the invariant is the cap, not a fixed width — an earlier draft of this test asserted the stricter, wrong thing and went red at 320 vs 239.)
- **TEST-14** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-4, ITEM-5] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: for BOTH pickers, a search box exists at the TOP of the panel (asserted as DOM order — it precedes the listbox via `compareDocumentPosition`; focus order itself is covered by TEST-15's focus-on-open), typing a seeded substring narrows the visible `role="option"` count, and a nonsense query renders "No matches." with zero options instead of an empty panel. For the KB picker it additionally asserts the box is present with only 3 KBs seeded, proving the old `> 6` threshold is gone.
- **TEST-15** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-6, ITEM-7] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: opening the assistant submenu puts focus in the search box; ArrowDown/ArrowUp move `aria-activedescendant` between seeded assistants; Enter selects the active one and the assistant status chip shows THAT name; Escape then closes the submenu while the parent "+" dropdown remains open (its other items still visible).
- **TEST-16** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-1, ITEM-7, ITEM-8] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: behavioural parity — opened in the same session, the assistant panel and the KB panel each expose a `role="combobox"` search box, a `role="listbox"`, `role="option"` rows, an overlayscrollbars viewport, and the SAME computed `max-width`/`min-width`/list `max-height`. Because equality between the two is true BY CONSTRUCTION once both import the primitive, the caps are ALSO asserted against absolute values (`320px` / `240px` / `256px`), so deleting a cap turns this red even though the two panels would still match each other.
- **TEST-17** (tier: e2e) [covers: ITEM-8] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: KB multi-select still works through the primitive — filter to one KB, activate it, its chip appears in the composer, the "+" dropdown stays OPEN — asserted on a SIBLING item of the parent menu (`assistant-menu-trigger`), not on the KB submenu, since the submenu staying visible says nothing about its parent, a second KB can be toggled on, and detaching removes the chip.
- **TEST-18** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: the assistant and knowledge-base trigger ROWS render with identical shared-row metrics — computed padding, font-size AND leading-icon size (all three measured) — each exposes an accessible name, and their padding matches the file-attach item, which is always present in the "+" menu and already used the shared row. The cross-item comparison is unconditional (an earlier draft hid it behind an `if (isVisible())`, which asserts nothing when false).
- **TEST-19** (tier: unit) [covers: ITEM-10] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: no file under `src-app/ui/src` imports `AssistantSelector`, and the file is gone from disk. (The registry half is enforced independently: `coverage.ts` / `stateCoverage.ts` are `satisfies Record<GallerySurface|RequiredState, …>`, so a stale key is a tsc error — a green `npm run check` is the machine proof that every manifest reference was removed too.)
- **TEST-20** (tier: e2e) [covers: ITEM-11] file: `src-app/ui/src/dev/gallery/stories/shard1.story.tsx` — asserts: all FOUR states — populated (26 items), filtered, no-matches, zero-items — are registered as gallery `OverlayEntry`s in `src-app/ui/src/modules/chat/gallery.tsx`, which is the surface class `runtime-health.mjs` actually enumerates (`enumerateSurfaces()` covers pages/overlays/deep/seeded — **stories are not a surface class**, so a story-only state gets no runtime pass). `npm run gate:ui` reports zero HIGH runtime findings (console error / page error / failed request / AA-contrast) for them at its 1280×900 pass, and the mirrored `shard1.story.tsx` cases are additionally driven by the visual Layer-A `layout.spec.ts` invariants at **390 / 768 / 1280px** and by the desktop axe pass. The ~390px behaviour of the real POPOVER (not just the panel) is asserted separately by TEST-22.

- **TEST-21** (tier: unit) [covers: ITEM-12] file: `src-app/ui/package.json` — asserts: `npm run check` — the 20-gate static chain (incl. `check:testid-registry`, `check:state-matrix`, `check:gallery-coverage`, `check:overlay-registry`) — exits 0 in BOTH frontend workspaces. This is a GATE, not a hand-written spec: the executable artifact is the recorded exit code, and the before/after is measured, not assumed (on a `git stash`ed pristine `origin/main` tree the same command exits **1**, failing `check:testid-registry` and `check:state-matrix`; both runs are recorded in TEST_RESULTS.md).

- **TEST-22** (tier: e2e) [covers: ITEM-2, ITEM-3, ITEM-11] file: `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts` — asserts: at a **390×844** viewport, with 26 KBs seeded, the real popover (not just the panel) stays fully inside the viewport horizontally (`x >= 0` and `x + width <= 390`), keeps its height cap, and does not give the document a horizontal scrollbar. A 240px-min panel opening `side="right"` from a nested popover is exactly the geometry that breaks at mobile width.
- **TEST-23** (tier: unit) [covers: ITEM-1, ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: every `role="option"` is a DIRECT child of the `role="listbox"` and the listbox has no non-option children, so a separator must be a border rather than a node. (Blind-audit finding: a per-item wrapper div broke ARIA's required-children relationship — screen readers stop announcing "item N of M".)
- **TEST-24** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: clicking a row leaves `document.activeElement` on the search input. Rows are non-focusable and the Base UI popup is `tabIndex=-1`, so without a `mousedown` preventDefault the first click strands every later keystroke — the DEFAULT flow for the multi-select KB picker. Corroborated independently by two audit angles.
- **TEST-25** (tier: unit) [covers: ITEM-6, ITEM-9] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: pressing Enter on the REAL `PlusMenuItem` trigger OPENS the picker (an audit predicted the row's own Enter handler would compose with Base UI's button emulation into an open-then-close double-toggle). The spec drives the production trigger, not a stand-in div.
- **TEST-26** (tier: unit) [covers: ITEM-4, ITEM-5] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: a `pinned` row survives a filter that excludes everything else (the assistant "No assistant" clear row must stay reachable while a query is active), and the no-matches state is NOT shown while a pinned row is visible.
- **TEST-27** (tier: unit) [covers: ITEM-1, ITEM-6] file: `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` — asserts: in the no-matches state the combobox reports `aria-expanded="false"` and emits NO `aria-controls` (a dangling idref is an axe `aria-valid-attr-value` violation at critical impact), and an Enter keydown carrying `isComposing` selects nothing (IME commit is not a picker action).

## Coverage map (bipartite check)

| ITEM | covering tests |
|---|---|
| ITEM-1 | TEST-1, TEST-8, TEST-9, TEST-16, TEST-23, TEST-27 |
| ITEM-2 | TEST-10, TEST-13, TEST-22 |
| ITEM-3 | TEST-11, TEST-12, TEST-22 |
| ITEM-4 | TEST-1, TEST-14, TEST-26 |
| ITEM-5 | TEST-2, TEST-3, TEST-14, TEST-26 |
| ITEM-6 | TEST-4, TEST-5, TEST-6, TEST-7, TEST-8, TEST-15, TEST-23, TEST-24, TEST-25, TEST-27 |
| ITEM-7 | TEST-11, TEST-15, TEST-16 |
| ITEM-8 | TEST-12, TEST-16, TEST-17 |
| ITEM-9 | TEST-9, TEST-18, TEST-25 |
| ITEM-10 | TEST-19 |
| ITEM-11 | TEST-20, TEST-22 |
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
