# FIX_ROUND-1

Round 1 over the blind two-angle audit (`correctness` + `design-conformance` /
`tests-quality`) recorded in `LEDGER.jsonl`. Tier is **LIGHT** (575 changed
lines; no permission, migration, module, or public API change), so this is the
single required round.

## The finding that mattered

**`wrap-anywhere` — the one genuinely NEW containment mechanism — had zero
behavioural coverage.** Both existing geometric assertions were structurally
blind to it:

- `panelScrollWidth <= panelClientWidth` cannot see a row overflowing, because
  the list is a `ScrollArea axis="y"` whose viewport is `overflow-x: hidden` — a
  clipping scroll container, so sideways row overflow never propagates out to the
  panel.
- the `hOutside` control sweep only measures `button`/`[role=button]` rects, and
  those are held in place by `min-w-0` + `shrink-0`, **both of which predate this
  fix**.

Verified by MUTATION, twice, rather than argued:

| | token box width | token right edge | panel right | `panel.scrollWidth`/`clientWidth` |
|---|---|---|---|---|
| with `wrap-anywhere` | **208.0** | 473.0 | 575.0 | 340 / 340 |
| class removed | **635.5** | 900.5 | 575.0 | **340 / 340 (unchanged!)** |

The panel-level numbers are identical in both states — proof the old assertions
could not fail. A full e2e run with the class deleted from source now fails with:

```
Error: the long unbroken token must WRAP inside the panel, not overflow it at 320x700
       (token box 622.1px wide, right edge 661.8 vs panel right 292.3)
Expected: false   Received: true
1 failed
```

## Fixes applied

**Source (`sdk/packages/notification-ui/`)**

1. Removed the inert `max-w-[calc(100vw-1rem)]` (dead: always looser than the
   `w-[min(…,100vw-2rem)]` beside it, and the popup is absolutely positioned so
   nothing could stretch it). It was also what made TEST-5's width check pass
   vacuously.
2. **Replaced the magic `-7rem` chrome allowance with a real layout bound.** The
   popup now carries `max-h-(--available-height)` and the list is
   `min-h-0 flex-1` inside the popup's flex column, so it takes whatever is left
   after the pinned header + footer — whatever heights those happen to be. This
   removes the 112px-budget-vs-108px-actual coupling (LEDGER medium), the
   negative-calc zero-height collapse (LEDGER low), AND the design drift where
   DESIGN.md claimed `--available-height` "exactly as `kit/dropdown.tsx`" while
   the code used two undeclared constants. Verified live on a 360×480 viewport:
   `--available-height` 382px → panel 382px, list auto-shrunk to 282px, fits.
   `max-h-[26rem]` remains, now solely as an aesthetic ceiling on tall screens.
3. Documented the `100vw`-includes-scrollbar margin at the width bound.
4. Dropped the unwired `data-testid="notification-bell-panel"` (§15).
5. Corrected the false claim in the `ps-4` comment: `lint:logical-direction`
   does **not** reach the sdk (it diffs the parent repo and filters to
   `src-app/{ui,desktop/ui}/src/`); the real enforcement is TEST-7's rendered-DOM
   sweep, and the comment now says so.

**Tests**

6. **e2e: added the row-level containment assertion** (the headline fix) —
   measures the long token's own text box against the panel. Mutation-proven
   above.
7. **e2e: fixed a seed bug the new assertion immediately exposed.** The seed used
   the `created_at` DEFAULT, so the two adversarial rows were the OLDEST of 12 and
   fell outside the bell's `items.slice(0, 8)`. The long-token row was never
   rendered — the spec had been green while exercising nothing of the sort. Seeds
   now carry explicit newest-first timestamps.
8. **TEST-5(b): fixed a regex that could not fail as claimed.** `/\bw-\[…vw…\]/`
   matches `max-w-[…]` (a `\b` sits between `-` and `w`), so a fixed `w-[340px]`
   plus any `max-w` viewport bound passed. Now tokenises the class list, requires
   exactly ONE `w-*` token, requires it to be viewport-relative, and asserts the
   primitive's `w-72` was **merged away** rather than merely followed.
9. **TEST-7: broadened + de-blinded.** Added `border-l/r`, `rounded-l/r`,
   `space-x-*`, `left-/right-`, `scroll-pl/pr`, `float`/`clear`; read the `class`
   ATTRIBUTE instead of `el.className` (which is an `SVGAnimatedString` on every
   lucide icon and silently exempted the whole icon subtree); added a
   population control local to this test; and gave 15 positive + 16 negative
   control cases. The kit primitive's `data-[side=…]:slide-in-from-*` animation
   classes are exempted **narrowly and explicitly** (they belong to
   `shadcn/popover.tsx`, which this change does not own), with a control proving
   a physical utility cannot hide behind the exemption.
10. **TEST-6: relabelled honestly.** It is a structural check that localises a
    regression, not a proof of INV-4; its docblock now says so and points at the
    e2e assertion that is the proof. Same for TEST-2's four panel-rect checks,
    now labelled a regression guard (they pass on `origin/main`) with the note
    that TEST-1/TEST-3 re-run at 320/390 are what make TEST-2 mean anything.
11. **Added TEST-9: the empty (0-notification) branch**, which takes a different
    code path (`<Empty>`, no scroller, no list testid) and had no coverage.
12. Corrected a wrong comment about zero-size rects in the `hOutside` filter.

## Not fixed — accepted open, with reasons

- **`gate:ui` cannot see this surface** (LEDGER, medium). The bell is
  `{ kind: 'via' }` in `coverage.ts` and the `<Popover>` itself lives in the sdk
  submodule, so the overlay registry has no entry and the open popover gets no
  runtime-health cell, axe pass, or visual baseline. Closing it means adding a
  gallery surface for an SDK slot widget plus an overlay-registry entry — a
  structural gallery change that would touch shared registries a concurrent
  workstream is also editing. Recorded for the orchestrator; the geometric e2e
  covers the reported defect in the meantime.
- **`npm run check` is RED on `origin/main`** — see TEST_RESULTS.md. Not this
  branch's debt and deliberately not laundered into this diff.
- The kit's `--spacing()` idiom and `gap-*`-over-`pb/pt` preferences (LEDGER
  low): cosmetic, in a file the concurrent popover workstream may restyle.

**New confirmed findings:** 0
