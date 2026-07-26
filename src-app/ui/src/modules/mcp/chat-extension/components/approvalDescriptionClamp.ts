/**
 * Collapse geometry for the tool-approval card's description block.
 *
 * The advertised description is attacker-influenced text of unbounded length —
 * a hostile or careless MCP server can newline-stuff it. Rendered raw
 * (`whitespace-pre-wrap`, no cap) it grows the approval card without bound and
 * pushes Deny / Approve below the fold, so the user cannot reach the decision
 * controls without scrolling. That is a usability bug AND a safety one: the
 * cheapest way to make "Approve" the only visible action is to push "Deny" off
 * screen.
 *
 * The fix is a **CSS-only** clamp — a `max-height` on the block plus a
 * "Show more" toggle. It is deliberately NOT a string truncation: the surface's
 * disclosure contract is that the user sees the "FULL, EXACT advertised
 * description (never truncated/summarized — poisoning hides in truncation)", so
 * the complete string stays in the DOM at all times (copyable, searchable via
 * in-page find, readable by assistive tech and by tests) and only its viewport
 * is bounded.
 *
 * Pure geometry, no React — so the decision is unit-testable without a DOM.
 */

/**
 * Collapsed height cap for the description block, in px.
 *
 * ~6 lines at the card's `text-sm`, chosen to sit between the two bounds
 * already on this surface: the one-line egress preview above it and the
 * arguments block's `max-h-40` (160px) below it. Keeping it under the args cap
 * means the description can never be the tallest region of the card, which is
 * what bounds total card height and keeps the footer actions on screen.
 */
export const APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX = 120

/**
 * The Tailwind utility that APPLIES the cap above.
 *
 * The clamp is expressed as a class rather than an inline `style` because the
 * kit's `Text` refuses a raw style prop without an explicit `allowStyle`
 * opt-out, and because a utility keeps the value on Tailwind's 4px spacing
 * grid. Tailwind v4 spacing is `n × 4px`, so this MUST equal
 * `APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX / 4` — asserted in the unit test so the
 * two can never drift.
 */
export const APPROVAL_DESCRIPTION_COLLAPSED_CLASS = 'max-h-30'

/** Tailwind v4's spacing base, in px (`gap-2` = 8px). */
export const TAILWIND_SPACING_BASE_PX = 4

/**
 * Slack, in px, before an overflow is considered real.
 *
 * Sub-pixel layout rounding and font-metric differences routinely make
 * `scrollHeight` exceed `clientHeight` by a fraction on content that visually
 * fits. Without slack the toggle would flicker in for descriptions that need no
 * expanding at all.
 */
export const APPROVAL_DESCRIPTION_OVERFLOW_TOLERANCE_PX = 2

/** The measured box of the description element. */
export interface ClampMeasurement {
  /** Full content height (`el.scrollHeight`). */
  scrollHeight: number
  /** Visible height while clamped (`el.clientHeight`). */
  clientHeight: number
}

/**
 * Does this content genuinely overflow its collapsed box?
 *
 * Only when it does is the "Show more" toggle rendered — a toggle on a
 * three-word description would be noise.
 */
export function isDescriptionOverflowing(
  m: ClampMeasurement,
  tolerance: number = APPROVAL_DESCRIPTION_OVERFLOW_TOLERANCE_PX,
): boolean {
  if (!Number.isFinite(m.scrollHeight) || !Number.isFinite(m.clientHeight)) {
    return false
  }
  return m.scrollHeight - m.clientHeight > tolerance
}

/**
 * The clamp classes to apply, or `''` when expanded.
 *
 * Expanding returns NO height utility (rather than a larger one) so the expanded
 * block is genuinely unconstrained — never a taller second cage.
 */
export function descriptionClampClass(expanded: boolean): string {
  return expanded ? '' : `${APPROVAL_DESCRIPTION_COLLAPSED_CLASS} overflow-hidden`
}

/** Label for the toggle in its current state. */
export function descriptionToggleLabel(expanded: boolean): string {
  return expanded ? 'Show less' : 'Show more'
}
