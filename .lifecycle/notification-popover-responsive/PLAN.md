# PLAN — notification-popover-responsive

Fixes the user-reported defect: "the render of the notification popover is also
broken, not responsive".

## Design source

Realizes `.lifecycle/notification-popover-responsive/DESIGN.md` §"Non-negotiables"
and §"Approach" — the responsive-containment contract for the sidebar
notification bell popover, written for this bugfix because no prior design doc
covered the surface. That design in turn derives its rules 2 and 3 verbatim from
`.claude/skills/feature-lifecycle/SKILL.md` (UI-surface plan checklist, "Device
size / responsive") and `agent-kit/docs/DESIGN_SYSTEM.md` ("Spacing rhythm",
logical-direction rule).

## Invariants

- **INV-1**: the page body must NEVER scroll sideways — wide content scrolls inside its own container
- **INV-2**: A surface that only works at desktop width is a defect.
- **INV-3**: new components use logical direction properties only (`ps/pe`, `ms/me`, `start/end`, `text-start/text-end`), never the physical `pl/pr`, `ml/mr`, `left/right`, `text-left/text-right`
- **INV-4**: Rendered popover content stays inside the popover panel: at every viewport the panel's own `scrollWidth` equals its `clientWidth`, and no interactive control of the popover paints outside the panel's box.

## Items

- **ITEM-1**: Delete the inline `style={{ width: 340, maxHeight: 460, overflowY: 'auto' }}` from `NotificationBellWidget`'s content wrapper and bound the popover PANEL instead, through the kit `Popover`'s existing `className` seam, at `min(21.25rem, viewport − gutters)`. Panel and content become one box, so content can no longer be wider than the panel that draws the background (INV-4), and the width tracks the viewport instead of being a fixed 340px (INV-1, INV-2).
- **ITEM-2**: Move the scroll off the whole wrapper and onto the notification LIST only, using the shared `ScrollArea` from `@ziee/kit` (the existing overlayscrollbars integration — no second integration added), height-bounded by base-ui's `--available-height` custom property with an absolute cap, mirroring `kit/dropdown.tsx`. The "Notifications / Mark all read" header and the "View all" footer stay pinned outside the scroller so both remain reachable at any height.
- **ITEM-3**: Make a long title / body / long unbroken token wrap inside its row instead of forcing the row wider than the panel — the content column gets an explicit wrap rule on top of its existing `min-w-0 flex-1` (INV-4).
- **ITEM-4**: Keep the popover's own controls inside the panel at narrow widths: the header row gets a gap + a non-shrinking action and a truncating title so "Mark all read" is never clipped mid-word, and the per-row action group stays inside the panel box.
- **ITEM-5**: Convert the physical `pl-4` on `NotificationItem`'s kind-actions row to the logical `ps-4` (INV-3) — this file is changed by ITEM-3/ITEM-4, so `npm run lint:logical-direction` applies to it.
- **ITEM-6**: Add a mounted component test that renders the bell popover content with a populated, adversarial notification set (long title, long unbroken token) and asserts the containment + wrap rules on real DOM, run via `npm run test:component`.
- **ITEM-7**: Add a narrow-viewport e2e that opens the bell popover with MANY notifications seeded and asserts the invariants — no horizontal body overflow, panel within the viewport bounds, panel `scrollWidth === clientWidth` — rather than mere visibility.

## Files to touch

- `sdk/packages/notification-ui/src/NotificationBellWidget.tsx` — ITEM-1, ITEM-2, ITEM-4
- `sdk/packages/notification-ui/src/NotificationItem.tsx` — ITEM-3, ITEM-4, ITEM-5
- `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx` (new) — ITEM-6
- `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` (new) — ITEM-7

NOT touched, deliberately: `sdk/packages/kit/src/shadcn/popover.tsx` and
`sdk/packages/kit/src/kit/popover.tsx`. The `w-72` default there is the shared
popover primitive; a concurrent workstream is reworking the assistant /
knowledge-base picker popovers on that same seam, so the panel bound is applied
per-call-site through the `className` prop the kit already exposes.

No desktop mirror to update: `src-app/desktop/ui` consumes the same
`@ziee/notification-ui` package (it only `@source`s it for Tailwind scanning in
`src-app/desktop/ui/src/index.css`); there is no hand-written desktop copy of
this component.

## Patterns to follow

- **Bounded popover panel + list scroller** — mirror `sdk/packages/kit/src/kit/dropdown.tsx:72-106`: hand scrolling to `ScrollArea axis="y" autoHide="leave"` capped with `max-h-(--available-height)`, with the panel sized at the call site.
- **Shared scroll wrapper** — `ScrollArea` from `@ziee/kit` (`sdk/packages/kit/src/kit/scroll-area.tsx`), already the repo's single overlayscrollbars integration and already a peer dep of `@ziee/notification-ui`.
- **Component test harness** — mirror `src-app/ui/src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx` (vitest + jsdom, mounted component, behaviour assertions).
- **Notification e2e** — mirror `src-app/ui/tests/e2e/15-notifications/background-inbox.spec.ts`: notifications are server-emitted (no create endpoint), so seed rows with the harness's `testInfra.sql()` and let the REAL REST endpoint serve them. No `page.route` mocking (CODING_GUIDELINES §14).
- **Design tokens** — `agent-kit/docs/DESIGN_SYSTEM.md`: semantic tokens only, 4px rhythm, logical direction only.

## Plan audit (Phase 2 verdicts)

### Breakage risk

The bell popover is the only consumer of the changed markup;
`NotificationItem` is additionally used by `NotificationsPage` (the full inbox)
and `AgentInboxPage`. The item changes are wrap/containment-only (adding
`min-w-0`/wrap rules and swapping `pl-4`→`ps-4`), which are no-ops on a wide
container, so the inbox page is visually unchanged at desktop and strictly
better at narrow widths. No prop signature changes, so no caller breaks.

### Pattern conformance

`ScrollArea` + `max-h-(--available-height)` is copied from `kit/dropdown.tsx`,
the in-repo precedent for a bounded, scrollable popup. Width is applied via the
kit `Popover`'s documented `className` prop, which is already `cn()`-merged onto
the popup — tailwind-merge lets a `w-[...]` override the primitive's `w-72`
without editing it.

### Migration collisions

None — no migration. `ls src-app/server/src/modules/*/migrations` is untouched
by this diff; the backend is not modified at all.

### OpenAPI regen

Not required. No Rust handler or `JsonSchema` type changes, so neither
`openapi.json` nor `api-client/types.ts` moves in either workspace.

- **ITEM-1** — verdict: PASS — verified `sdk/packages/kit/src/kit/popover.tsx:47` forwards `className` into `PopoverContent`, which `cn()`-merges it onto the popup (`sdk/packages/kit/src/shadcn/popover.tsx:43-46`); tailwind-merge resolves `w-[...]` over `w-72`, so no primitive edit is needed.
- **ITEM-2** — verdict: PASS — `ScrollArea` is exported from `@ziee/kit` (`sdk/packages/kit/src/index.ts:28`) and `@ziee/kit` is already a peer dep of `@ziee/notification-ui`; `kit/dropdown.tsx:77` is the working precedent for `max-h-(--available-height)` on a base-ui positioned popup.
- **ITEM-3** — verdict: PASS — the content column already carries `min-w-0 flex-1` (`NotificationItem.tsx:97,102`), so only the wrap rule is missing; adding it cannot widen the row.
- **ITEM-4** — verdict: CONCERN — the header currently has no `gap` and the title has no truncation, so a future localization with a longer "Mark all read" could still crowd the title. Mitigated by making the action `shrink-0` and the title truncate; accepted as sufficient for this surface (the string is short and the panel is ≥288px at the narrowest supported width).
- **ITEM-5** — verdict: PASS — confirmed `pl-4` at `NotificationItem.tsx:128` is the only physical-direction utility in the two changed files (`grep -nE '\b(pl|pr|ml|mr|text-left|text-right)-' ` over both returns just that line).
- **ITEM-6** — verdict: PASS — `vitest.config.ts` `include` covers `src/**/*.test.tsx` and `npm run test:component` is `vitest run .test.tsx`; jsdom mounts are the established harness.
- **ITEM-7** — verdict: CONCERN — jsdom cannot measure layout, so containment must be proven in a real browser; the e2e is therefore the load-bearing proof and the component test is the fast complement. Resolved by making the e2e assertions geometric (`scrollWidth`/`clientWidth`/`getBoundingClientRect` vs viewport), not visibility-based.
