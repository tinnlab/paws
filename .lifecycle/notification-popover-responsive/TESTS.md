# TESTS — notification-popover-responsive

Two tiers. jsdom cannot compute layout, so every GEOMETRIC claim is proven in a
real browser (`tier: e2e`); the mounted component tests (`tier: unit`, vitest +
jsdom via `npm run test:component`) prove the DOM structure and class contract
that produces that geometry, and are the fast regression net.

The e2e adds **no** `page.route` API mocking: notifications are server-emitted
(there is no create endpoint), so rows are seeded straight into the per-test
database with the harness's `testInfra.sql()` and the REAL REST endpoint then
serves them — the pattern `tests/e2e/15-notifications/background-inbox.spec.ts`
already uses, and the one the coding guidelines require ("No `page.route()` API
mocking — drive the real backend through the UI"). R2-5 (every diff-added
`/api/` route-mock must match a live route) is therefore vacuously satisfied:
the diff adds zero route mocks.

## Tests

- **TEST-1** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-7] file: `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` — asserts: with 12 notifications seeded (including a 96-char title and a 78-char unbroken token) and the sidebar open at a 320×700 viewport, `document.documentElement.scrollWidth === document.documentElement.clientWidth` while the bell popover is OPEN — i.e. the page body does not scroll sideways. Fails on `origin/main`, which measures 358 vs 320.
- **TEST-2** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-2, ITEM-7] file: `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` — asserts: the SAME open popover satisfies the containment + in-viewport bounds at 320×700 AND at 390×844 AND at 1440×900 — the panel rect is fully inside `[0, innerWidth] × [0, innerHeight]` at every one of the three viewports, so the surface is not desktop-only.
- **TEST-3** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-1, ITEM-3, ITEM-4, ITEM-7] file: `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` — asserts: THREE things, the third of which is the only one sensitive to the row-level wrap rule — (i) the long unbroken token's own rendered text box stays inside the panel (mutation-proven: deleting `wrap-anywhere` makes it 622px wide against a 292px panel and this assertion fails, while the two panel-level checks stay green because the list's `overflow-x: hidden` clips row overflow before it reaches the panel); (ii) the popover panel (`[data-slot="popover-content"]`) has `scrollWidth === clientWidth` (no content wider than the panel), and NO interactive control inside the popover (mark-all-read, each row's mark-read and delete, view-all) escapes the panel's rect HORIZONTALLY. The check is x-axis-only by design: ITEM-2 makes the list a scroll container, so a row below the fold is legitimately outside the panel's vertical bounds (see DRIFT-1.3). Fails on `origin/main`, which measures panel scrollWidth 350 vs clientWidth 288 with the row buttons painting outside to the right.
- **TEST-4** (tier: e2e) [covers: ITEM-2] file: `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` — asserts: with 12 notifications the "View all" footer button and the "Mark all read" header button are both VISIBLE without scrolling the list (they are pinned outside the scroller), and the list region is independently scrollable — measured on the `[data-overlayscrollbars-viewport]` node, since `ScrollArea` moves the scroll off its host element and the host would report equal heights even for a non-scrolling list (see DRIFT-1.4).
- **TEST-5** (tier: unit) [covers: ITEM-1, ITEM-2] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: the mounted bell content renders NO element carrying an inline fixed `width`/`maxHeight`/`height` style anywhere in the popup subtree (the defect's literal mechanism); the popup declares exactly ONE `w-*` token, that token is viewport-relative, and the primitive's `w-72` has been MERGED AWAY (not merely followed, which would leave the override dependent on stylesheet source order); the panel is height-bounded by `--available-height`; the list derives its height via `min-h-0 flex-1` rather than a hardcoded chrome subtraction; and the header + footer are siblings OUTSIDE the scroller while the rows are inside it.
- **TEST-6** (tier: unit) [covers: ITEM-3, ITEM-4] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: the wrap rule sits on the CONTENT COLUMN (where an app-registered kind renderer's output inherits it) rather than on the SDK's fallback block, and the row's action group is a non-shrinking sibling with no width of its own. HONEST SCOPE: this is STRUCTURAL and close to tautological — it restates the classes the diff added. It localises a regression fast; it is NOT the proof of INV-4. That proof is TEST-3's row-level measurement, because only a real browser lays text out.
- **TEST-7** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-5] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: no element rendered by the bell popover or by `NotificationItem` (including the kind-actions row, exercised via a registered kind renderer that supplies `actions`) carries a physical-direction LAYOUT utility — `pl/pr`, `ml/mr`, `scroll-pl/pr`, `border-l/r`, `rounded-l/r`, `space-x-*`, `left-/right-`, `text-left/right`, `float`/`clear`. Reads the `class` ATTRIBUTE, not `el.className`, which is an `SVGAnimatedString` on every lucide icon and would silently exempt the whole icon subtree. Carries a population control, 15 positive + 16 negative matcher controls, and a NARROW documented exemption for the kit primitive's `data-[side=…]:slide-in-from-*` enter animations (with its own control proving a physical utility cannot hide behind it). This asserts the design's promise (logical direction only) on rendered output, and it is the ONLY enforcement of INV-3 for this code: `npm run lint:logical-direction` diffs the PARENT repo and filters to `src-app/{ui,desktop/ui}/src/`, so an `sdk` submodule change is invisible to it.
- **TEST-9** (tier: unit) [covers: ITEM-1, ITEM-2] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: the EMPTY (0-notification) branch — a genuinely different code path (`<Empty>` instead of the `ScrollArea`, so the list and its testid do not exist) — is bounded the same way: exactly one viewport-relative `w-*` token, no `w-72`, an `--available-height` height bound, and no inline pixel sizing.
- **TEST-8** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: the harness itself is load-bearing — the populated fixture actually renders 8 notification rows with their titles and both action buttons present in the DOM, so TEST-5/6/7 cannot pass vacuously against an empty or crashed render.

## Coverage

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2, TEST-3, TEST-5, TEST-9 |
| ITEM-2 | TEST-2, TEST-4, TEST-5, TEST-9 |
| ITEM-3 | TEST-3, TEST-6 |
| ITEM-4 | TEST-3, TEST-6 |
| ITEM-5 | TEST-7 |
| ITEM-6 | TEST-8 |
| ITEM-7 | TEST-1, TEST-2, TEST-3 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-1 |
| INV-2 | TEST-2 |
| INV-3 | TEST-7 |
| INV-4 | TEST-3 |

No permission is introduced by this diff, so A9/A10 (backend deny test +
restricted-user `[negative-perm]` e2e) do not apply.
