# Design — responsive containment contract for the sidebar notification popover

There was no prior design doc for this surface, so this file IS the named design
the plan is derived from (per the feature-lifecycle Phase-1 rule: "If there is
genuinely no prior design doc, WRITE one first and name it"). It is a bugfix
design: it states the contract the surface must satisfy, derived from the user
report plus two pre-existing, already-binding sources in this repo.

## The report (user, verbatim)

> the render of the notification popover is also broken, not responsive

## Reproduction (live rig, http://127.0.0.1:1520, 11 seeded notifications)

Measured on `origin/main` @ `35d18519f`, sdk @ `70576db`:

| viewport | popup client width | popup **scroll** width | doc clientWidth | doc **scrollWidth** |
|---|---|---|---|---|
| 1440×900 | 288 | **350** | 1440 | 1440 |
| 390×844  | 288 | **350** | 390  | 390 |
| 320×700  | 288 | **350** | 320  | **358** |

- The kit popover panel (`sdk/packages/kit/src/shadcn/popover.tsx`) is a fixed
  `w-72` = **288px**. The bell's content wrapper sets an inline
  `style={{ width: 340 }}`. Content (340px + the panel's `p-2.5`) is **62px
  wider than the panel that is supposed to contain it**, so the per-row
  mark-read / delete buttons and the "Mark all read" control render OUTSIDE the
  popover's background, floating over the page (see `BEFORE-desktop.png`,
  `BEFORE-mobile390.png`).
- At 320px that same fixed 340px pushes `document.scrollWidth` to 358 > 320 —
  **the page body scrolls sideways**, and the row action buttons are pushed
  entirely off-screen (`BEFORE-w320.png`).
- `maxHeight: 460` + `overflowY: 'auto'` sit on the wrapper that also contains
  the "View all" footer, so the footer is scrolled out of reach and the height
  cap is a fixed pixel value that ignores the viewport.

## Non-negotiables (these are lifted VERBATIM into PLAN.md `## Invariants`)

1. the page body must NEVER scroll sideways — wide content scrolls inside its own container
2. A surface that only works at desktop width is a defect.
   *(source: `.claude/skills/feature-lifecycle/SKILL.md`, UI-surface plan checklist, "Device size / responsive")*
3. new components use logical direction properties only (`ps/pe`, `ms/me`, `start/end`, `text-start/text-end`), never the physical `pl/pr`, `ml/mr`, `left/right`, `text-left/text-right`
   *(source: `agent-kit/docs/DESIGN_SYSTEM.md`, "Spacing rhythm")*
4. Rendered popover content stays inside the popover panel: at every viewport the
   panel's own `scrollWidth` equals its `clientWidth`, and no interactive control
   of the popover paints outside the panel's box.

## Approach (and what it deliberately does NOT touch)

The panel width belongs to the **panel**, not to a child. The kit `Popover`
already exposes a `className` seam that `cn()`-merges onto the popup, so the
call site can bound the panel responsively **without editing the shared
primitive**. `w-72` in `sdk/packages/kit/src/shadcn/popover.tsx` stays exactly
as it is — a concurrent workstream is reworking the assistant / knowledge-base
picker popovers and that file is the seam both would collide on.

Scrolling moves off the whole wrapper and onto the LIST only, via the shared
`ScrollArea` (`@ziee/kit`, overlayscrollbars — the existing integration; no
second one is added), bounded by base-ui's `--available-height` custom property
exactly as `sdk/packages/kit/src/kit/dropdown.tsx` already does. That keeps the
header and the "View all" footer pinned and reachable.
