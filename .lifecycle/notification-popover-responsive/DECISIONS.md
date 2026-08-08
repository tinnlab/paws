# DECISIONS — notification-popover-responsive

### DEC-1: Fix the shared kit popover primitive (`w-72`), or bound the panel at the call site?
**Resolution:** Bound it at the call site, via the kit `Popover`'s existing `className` prop. `sdk/packages/kit/src/{kit,shadcn}/popover.tsx` is NOT edited.
**Basis:** convention — the kit deliberately ships an opinionated default width and exposes `className` as the per-call-site escape hatch, exactly as `kit/dropdown.tsx` overrides it with `w-fit`. Operationally this is also the correct call: a concurrent workstream is reworking the assistant / knowledge-base picker popovers (bounded width/height + search) on that same primitive, and a unilateral edit there would collide. Reported to the orchestrator rather than taken.

### DEC-2: What width should the panel be?
**Resolution:** `w-[min(21.25rem,calc(100vw-2rem))]`, i.e. `min(340px, viewport − 32px)`.
**Basis:** convention — 340px preserves the surface's existing desktop density (it is the width the author already chose, and the 4px rhythm holds: 340 = 85 × 4px); the `calc(100vw-2rem)` arm is the responsive bound and 2rem = 8 × 4px matches the spacing scale. base-ui's positioner already shifts the panel to stay on screen, so the only thing missing was a width that cannot exceed the viewport.

### DEC-3: What bounds the height, and which element scrolls?
**Resolution:** The LIST scrolls, inside `ScrollArea axis="y" autoHide="leave"`, capped at `max-h-[min(26rem,calc(var(--available-height,100vh)-7rem))]`. The header and the "View all" footer are siblings outside the scroller.
**Basis:** convention — copied from `sdk/packages/kit/src/kit/dropdown.tsx:72-106`, the in-repo precedent for a bounded scrollable base-ui popup; `--available-height` is the custom property base-ui's positioner publishes, so the cap tracks the real space between the anchor and the viewport edge instead of a fixed 460px. The `-7rem` subtrahend reserves the pinned header + footer. Pinning the footer additionally fixes a latent defect: on `origin/main` "View all" sits inside the 460px scroll box and is unreachable without scrolling past 8 items.

### DEC-4: Add a second scrollbar integration, or reuse the existing one?
**Resolution:** Reuse — `ScrollArea` from `@ziee/kit`, which wraps `overlayscrollbars-react`.
**Basis:** codebase — `overlayscrollbars` ^2.16.0 / `overlayscrollbars-react` ^0.5.6 are already dependencies and `sdk/packages/kit/src/kit/scroll-area.tsx` is the repo's single integration; `@ziee/kit` is already a peer dependency of `@ziee/notification-ui`, so no dependency changes at all.

### DEC-5: How many notifications does the bell show, and should that change?
**Resolution:** Unchanged at 8 (`items.slice(0, 8)`), with "View all" now always reachable as the overflow affordance.
**Basis:** convention — the cap is pre-existing and is not implicated in the reported defect; changing it would be scope creep. This is a bounded list already, so the scale/cardinality checklist item is satisfied without server-side paging on this surface (the full inbox at `/notifications` is the paged surface).

### DEC-6: Where does narrow-viewport coverage live — a new gallery state, or the e2e?
**Resolution:** The e2e (`tier: e2e`, run at 320 / 390 / 1440). No new gallery state entry is added.
**Basis:** codebase — the bell is classified `{ kind: 'via', reason: 'slot-widget in notification (sidebarBottom)' }` in `src-app/ui/src/dev/gallery/coverage.ts:364`, i.e. it is covered through the sidebar rather than owning a gallery page, and the fix introduces NO new conditional render state (populated and empty both already exist), so `check:state-matrix` requires no new cell. Geometry is the thing under test and only a real browser can measure it, so the e2e is the honest home for it. `npm run gate:ui` still runs over the touched surfaces as the runtime-health canary.

### DEC-7: Is any operational tunable introduced (max width, max height, item cap)?
**Resolution:** No admin-configurable settings row. The width/height caps stay as CSS bounds in the component.
**Basis:** convention — these are layout constants of a single UI surface, not operator-facing policy (they cannot be footgunned, cost nothing, and have no security or resource dimension). Every comparable in-repo popup bound (`kit/dropdown.tsx`'s `max-h-(--available-height)`, the kit popover's `w-72`) is likewise a CSS constant, not a settings row. Promoting a popover's width to a database-backed admin setting would have no precedent and no consumer.

### DEC-8: The bell trigger's `data-testid="notification-bell-badge"` is absent from the production DOM — fix it here?
**Resolution:** No. Out of scope for this defect; the e2e selects the trigger by its accessible name / the popover panel by `[data-slot="popover-content"]`, both of which are present in every build.
**Basis:** codebase — `sdk/packages/kit/src/kit/badge.tsx` does forward `data-testid` through `wrapperProps`, and it IS present in a dev build; its absence on the live rig is a production-build testid strip, not a component defect. Recorded here so the observation is not lost, but it changes no behaviour the user reported.
