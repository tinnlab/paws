/**
 * Collapse geometry for the tool-approval card's description block.
 *
 * The advertised description is attacker-influenced text of unbounded length —
 * a hostile or careless MCP server can newline-stuff it. Rendered raw
 * (`whitespace-pre-wrap`, no cap) it grew the approval card without bound and
 * pushed the card's own header off the top of the viewport while the message
 * list auto-scrolled to the footer, so the reviewer could reach "Approve"
 * without ever seeing WHAT they were approving. That is a usability defect and
 * a safety one.
 *
 * The clamp itself is `CollapsibleBlock`'s (see `ApprovalToolDescription`) — this
 * module only owns the two values that are specific to THIS surface, so they sit
 * next to their rationale instead of being magic numbers at the call site.
 */

/**
 * Collapsed height cap for the description block, in px.
 *
 * Chosen to sit between the two bounds already on this card: the one-line
 * egress preview above it and the arguments block's `max-h-40` (160px) below it.
 * Keeping it under the args cap means the description can never be the tallest
 * region of the card, which is what bounds total card height and keeps the whole
 * card — header AND action row — inside the fold.
 *
 * Deliberately smaller than the chat module's own `COLLAPSE_MAX_HEIGHT_PX`
 * (384px, tuned for a whole assistant message): this is one field on a decision
 * card, not a message body.
 */
export const APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX = 120

/**
 * View-state key for the description's collapsed flag.
 *
 * `CollapsibleBlock` persists the flag in `MessageViewState` keyed by the string
 * it is handed, so expanding survives the virtualizer unmounting this row. The
 * prefix namespaces it away from real message ids, which share that map — a bare
 * `tool_use_id` would work today only by accident of the two id spaces not
 * colliding.
 */
export function approvalDescriptionViewKey(toolUseId: string): string {
  return `approval-desc:${toolUseId}`
}

/**
 * Collapsed height cap for the card's IDENTITY line (tool name + server label),
 * in px.
 *
 * Same threat, same answer as the description above. The tool name and the
 * server label are both chosen by the MCP server, and a first attempt at fixing
 * their truncation simply removed the bound — which measured 5123px of card for
 * a 6400-character name at 390px, putting Deny ~2800px below the fold. That is
 * the very failure this module's other constant exists to prevent, reintroduced
 * one row higher: a hostile server that cannot ellipsise its name into a benign
 * prefix can otherwise push the decision row out of view instead.
 *
 * So the identity line is bounded exactly like the description: a CSS clamp with
 * a fade and a "Show more" toggle, with the COMPLETE string always in the DOM.
 * Nothing is hidden — but nothing is unbounded either.
 *
 * 56px is ~3 lines of `text-sm`: enough that every realistic tool name and
 * server label renders in full and the toggle never appears, and small enough
 * that a pathological one cannot dominate the card.
 */
export const APPROVAL_IDENTITY_COLLAPSED_MAX_PX = 56

/** View-state key for the identity line's collapsed flag (see above). */
export function approvalIdentityViewKey(toolUseId: string): string {
  return `approval-identity:${toolUseId}`
}
