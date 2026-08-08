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
- **TEST-3** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-1, ITEM-3, ITEM-4, ITEM-7] file: `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` — asserts: the popover panel (`[data-slot="popover-content"]`) has `scrollWidth === clientWidth` (no content wider than the panel), and NO interactive control inside the popover (mark-all-read, each row's mark-read and delete, view-all) escapes the panel's rect HORIZONTALLY. The check is x-axis-only by design: ITEM-2 makes the list a scroll container, so a row below the fold is legitimately outside the panel's vertical bounds (see DRIFT-1.3). Fails on `origin/main`, which measures panel scrollWidth 350 vs clientWidth 288 with the row buttons painting outside to the right.
- **TEST-4** (tier: e2e) [covers: ITEM-2] file: `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` — asserts: with 12 notifications the "View all" footer button and the "Mark all read" header button are both VISIBLE without scrolling the list (they are pinned outside the scroller), and the list region is independently scrollable — measured on the `[data-overlayscrollbars-viewport]` node, since `ScrollArea` moves the scroll off its host element and the host would report equal heights even for a non-scrolling list (see DRIFT-1.4).
- **TEST-5** (tier: unit) [covers: ITEM-1, ITEM-2] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: the mounted bell content renders NO element carrying an inline fixed `width`/`maxHeight` style (the defect's mechanism), the popover panel class carries a viewport-relative width bound, and the list is wrapped in a height-bounded scroll container while the header and footer are siblings OUTSIDE it.
- **TEST-6** (tier: unit) [covers: ITEM-3, ITEM-4] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: a row whose title is a single 78-char unbroken token renders that title inside a `min-w-0` column carrying an explicit wrap rule, and the row's action group is a sibling that does not carry a fixed width — so a long token cannot widen the row.
- **TEST-7** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-5] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: no element rendered by the bell popover or by `NotificationItem` (including the kind-actions row, exercised via a registered kind renderer that supplies `actions`) carries a physical-direction utility class (`pl-`/`pr-`/`ml-`/`mr-`/`text-left`/`text-right`). This asserts the design's promise (logical direction only) on rendered output, so it fails if the promise is violated anywhere in the subtree — not merely at the one line the fix edited.
- **TEST-8** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` — asserts: the harness itself is load-bearing — the populated fixture actually renders 8 notification rows with their titles and both action buttons present in the DOM, so TEST-5/6/7 cannot pass vacuously against an empty or crashed render.

## Coverage

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2, TEST-3, TEST-5 |
| ITEM-2 | TEST-2, TEST-4, TEST-5 |
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
