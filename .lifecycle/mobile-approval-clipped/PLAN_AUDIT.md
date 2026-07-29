# mobile-approval-clipped — PLAN AUDIT

Audited against the codebase at `origin/feat/agent-core` @ `9363976a2`, before
writing any code.

## Breakage risk

- **ITEM-1 (`CardActions`) is purely ADDITIVE to the kit.** No existing export
  changes. Considered and REJECTED the wider alternative of changing
  `CardFooter` (`sdk/packages/kit/src/shadcn/card.tsx:82`) itself: `grep -rn
  "footer=" --include=*.tsx src-app/ui/src src-app/desktop/ui/src | wc -l` = **101**
  call sites, many of which pass non-action content (text, a `justify-between`
  row) that a footer-level `justify-end` would silently re-align. That blast
  radius is disproportionate to a focused layout fix and would need a full visual
  re-bless of 101 surfaces. An additive primitive lets those adopt it later.
- **The kit `Card` root's `overflow-hidden` is NOT removed.** It is load-bearing:
  it is what clips the card's own children to the `rounded-xl` corners
  (`shadcn/card.tsx:15`, with `*:[img:first-child]:rounded-t-xl`). Removing it to
  "un-clip" Deny would be fixing the reachable layer, not the cause — the cause is
  a row that overflows at all. Verified the fix keeps the row inside the content
  box so the clip never engages.
- **Desktop-width rendering must be unchanged.** `flex-wrap` is inert when the
  content fits, and the child constraints (`max-w-full`, `min-h-8`, `h-auto`) are
  no-ops for a button that is narrower than the line and 32px tall. Risk: the
  child selector's specificity (`.parent > *` = 0,2,0) beats a child's own
  utility (0,1,0), so a `size="lg"` child would be pinned to `min-h-8` (32px)
  instead of 36px. No current or planned `CardActions` child uses `size="lg"`
  (all four call sites use `size="default"`); documented in the JSDoc so a future
  caller is not surprised. Recorded as **DEC-4**.
- **ITEM-4 (`AskUserWizardContent`)** overrides justification to `justify-between`
  via `className`. `cn()` is `twMerge(clsx(...))` (`sdk/packages/kit/src/lib/utils.ts`),
  and `className` is merged LAST in the planned `CardActions`, so `justify-between`
  correctly displaces the primitive's `justify-end`. Verified against the same
  merge order already used by `kit/card.tsx:33`.
- **ITEM-5 appends to an existing spec file.** No existing test is modified or
  removed, so the A5 shrink-guard cannot trip.

## Pattern conformance

- `CardActions` mirrors `kit/card.tsx`'s own `Card`: a `data-slot`-tagged div,
  props derived from `React.ComponentProps<'div'>` with the style-gated props
  omitted, `className` merged last. Conforms.
- The kit precedent for a non-overflowing footer action row already exists twice
  (`shadcn/dialog.tsx:136`, `shadcn/alert-dialog.tsx:91`). `CardActions` is the
  card-shaped sibling. Conforms — and NOT re-deriving that idiom at 4 call sites
  is exactly the `affordance-parity / reuse` rule.
- **Deliberate divergence from the dialog precedent, with rationale.** The dialog
  footers switch on the VIEWPORT (`sm:flex-row`). `CardActions` is instead
  content-driven (`flex-wrap` + a per-child width cap) because an approval card's
  container width is independent of the viewport: the measured gallery card is
  **270px wide inside a 390px viewport**, and the same card renders in split panes
  and side panels at desktop viewport widths. A viewport breakpoint would report
  "wide" while the container is narrow — re-introducing the bug. Recorded as
  **DEC-1**.
- Design system: no color is introduced (`lint:colors` unaffected); spacing stays
  on the 4px grid (`gap-2`); no physical-direction utility is used
  (`lint:logical-direction` unaffected) — which matters here because the defect is
  itself direction-dependent (inline-start = right under RTL).
- Kit style-guard: `CardActions` takes no `style` prop, so it needs no
  `KitStyleProps`/`allowStyle` escape hatch.

## Migration collisions

None. This branch adds no migration; see `BASE.md` for the per-crate migration
tails on the base. Frontend-only diff.

## OpenAPI regen

Not required. No Rust type, handler, route or schema changes, so
`openapi.json` and `api-client/types.ts` are untouched in BOTH `src-app/ui` and
`src-app/desktop/ui`. `KIT_MANIFEST.md` IS generated and must be regenerated
(`npm run gen:kit-manifest`), and `check:kit-manifest` inside `npm run check`
enforces it. `testIds.generated.ts` needs no regen (the primitive adds no
`data-testid`), which also avoids the known cross-branch collision on that file.

## Gallery / gate impact

- `check:gallery-coverage` walks `surfaceRoots` = `["src/modules","src/components/ui"]`
  (`src-app/ui/gallery.config.json`). The kit lives in `sdk/packages/kit/src`, which
  is NOT a surface root, so a new kit primitive does not demand a gallery cell.
- `check:state-matrix` covers conditional RENDER states, not viewports; this change
  adds no new render state.
- Layer B visual baselines for the three affected gallery surfaces will shift at
  mobile width (the row now wraps). Re-blessing is expected and is phase-8 work.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — additive kit export; mirrors `kit/card.tsx` shape and
  the existing `DialogFooter`/`AlertDialogFooter` role; manifest regen is scripted.
- **ITEM-2** — verdict: PASS — replaces a hand-rolled row on the one surface with a
  measured, reproduced failure; no logic touched, only the footer container.
- **ITEM-3** — verdict: PASS — same pattern, same file family. The no-fields
  variant (`Decline` 74px + `Accept without values`) exceeds the 238px line and is
  a latent instance; it has no gallery cell today, so ITEM-5 must add coverage
  that actually renders it or the item ships untested.
- **ITEM-4** — verdict: CONCERN — the wizard footer is `justify-between` with a
  NESTED group; the primitive's child constraints apply to that nested `div`, not
  to the buttons inside it, so the nested group needs `flex-wrap` of its own or
  ITEM-4 fixes only the outer axis. Resolved in the plan (ITEM-4 explicitly covers
  the nested group); carried into DEC-3 and re-checked by the phase-6 audit.
- **ITEM-5** — verdict: CONCERN — the `deep-chat-elicitation-no-fields` gallery
  surface currently renders the FIELDS card, not the no-fields card (measured:
  `elicitation-accept-no-values` = ABSENT, `denyclip-siblings-before.log`). A test
  written against that slug would be a phantom leg for ITEM-3's no-fields half.
  Resolved as **DEC-5**: the spec asserts only what the surface genuinely renders,
  and the no-fields variant's coverage is stated honestly rather than claimed.

## Addendum — ITEM-6 (added during phase 5, see DRIFT-1)

- **ITEM-6** — verdict: PASS — found by LOOKING at the fixed 390px render rather
  than by inference, then measured (`name w=0 scrollWidth=98` at 390px vs `w=98`
  at 1280px). It is the SAME taxonomy class as the footer (B2 failure-to-wrap) on
  the SAME card, one row up, and the fix is the same one-utility answer, so it
  belongs in this branch rather than a follow-up: shipping "mobile approval is
  fixed" while the mobile approval card still cannot say WHICH tool it is
  approving would be a false claim. Breakage risk is nil at desktop width —
  `flex-wrap` is inert when the row fits (verified: name w=98 at 1280px both
  before and after) — and `min-w-0` only widens what `truncate` can do. All three
  approval headers carry the pattern verbatim, so all three are fixed together.
