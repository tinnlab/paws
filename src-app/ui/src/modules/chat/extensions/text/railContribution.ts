import { createElement } from 'react'
import type { MessageContentDataThinking } from '@/api-client/types'
import type { RailContribution } from '@/modules/chat/components/rail/railTypes'

/**
 * The text extension's rail contribution: reasoning as a rail STEP.
 *
 * ## Why this exists (it reverses a design decision)
 *
 * `DESIGN.md` originally listed `thinking` under "Explicitly out of the rail",
 * and `RAIL_EXCLUDED_TYPES` enforced it. That exclusion was never argued — unlike
 * `observation`, which has DEC-11 ("it arrives asynchronously long after the turn
 * and is a *message*, not a step"), thinking simply sat in a list. Meanwhile the
 * design's OWN problem statement is:
 *
 *   > One reviewed conversation renders **14 boxes, 7 of them "Thinking"**
 *
 * so excluding it left the rail solving at most half the clutter it was built to
 * remove: tool boxes became quiet rows while an equal number of bordered
 * reasoning cards stayed exactly as they were. It also contradicted DEC-3, which
 * ruled that a single completed tool call renders as "one quiet muted line" — a
 * bordered, chevroned Thinking card directly above that line is the LOUDER
 * element while carrying less information.
 *
 * The one measurement ever cited near this ("treating `thinking` as
 * run-continuing changes the card count by exactly zero") answers a DIFFERENT
 * question: whether a thinking block should BREAK a tool run. It says nothing
 * about whether reasoning should be a step, and no backing artifact for it exists
 * in the feature's lifecycle directory.
 *
 * Reversed by the owner after being the first human to view the rail in a
 * browser (`HUMAN_FEEDBACK.md` recorded "no human has looked at the rail in a
 * browser" up to that point). See DEC-13.
 *
 * ## Why the text extension owns it
 *
 * The rail is a contribution surface, not a collector (INV-1): core owns the
 * registry and the row, each extension describes its own steps. `text` already
 * owns the `thinking` wire vocabulary — it registers the `thinking` content
 * renderer and builds thinking blocks in its streaming delta processor — so the
 * step descriptor belongs here and nothing in `chat/components/rail/` learns the
 * word "thinking" as an extension concern.
 */

/** `metadata.token_count` when the provider reported one. */
function tokenCountOf(data: MessageContentDataThinking | undefined): number | null {
  const n = data?.metadata?.token_count
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/**
 * The reasoning text, or `''` for anything that is not a string.
 *
 * `describeActivity` MUST NOT throw (ITEM-6) — a block whose shape the backend
 * changed still has to yield a row or a clean decline, never a broken
 * transcript. The declared type says `thinking: string`, but this value arrives
 * off the wire, and `(42).trim` is a TypeError that would take the whole message
 * down. The segmenter has an outer catch, but relying on it would silently
 * demote a real thought to prose; failing closed here keeps the decline
 * deliberate.
 */
function thinkingTextOf(data: MessageContentDataThinking | undefined): string {
  const t: unknown = data?.thinking
  return typeof t === 'string' ? t.trim() : ''
}

const thinkingStep: RailContribution = {
  contentTypes: ['thinking'],
  // `text` is priority 5 and owns this content type outright; no other
  // contribution competes for `thinking`, so the default order is right.
  describeActivity: ctx => {
    const data = ctx.content.content as MessageContentDataThinking | undefined
    const text = thinkingTextOf(data)
    const redacted = Boolean(
      data && typeof data === 'object' ? data.metadata?.redacted_data : undefined,
    )

    // An empty, non-redacted thinking block is not a step. `ThinkingContent`
    // already returns null for one, so claiming it here would ADD a row where
    // the old card rendered nothing — turning a no-op into visible clutter,
    // which is the opposite of this feature's purpose. Declining lets it fall
    // through to prose, where the empty renderer still draws nothing.
    if (!text && !redacted) return null

    const tokens = tokenCountOf(data)

    return {
      // `id` is the content block's own primary key — stable across re-renders
      // and unique within the message, so no `#index` disambiguation is needed
      // (unlike `tool_use.id`, which a replayed call can repeat).
      key: `thinking:${ctx.content.id || ctx.index}`,
      label: redacted ? 'Thought (redacted)' : 'Thought',
      // Deliberately NOT "Thought for Ns": no duration is stored anywhere on a
      // thinking block. `ThinkingMetadata` carries only `signature`,
      // `redacted_data` and `token_count`, and `MessageContent.created_at` is a
      // save-time stamp, not a reasoning-start time. Deriving a duration from
      // the gap to the next block would be a fabricated number presented with
      // the authority of a measurement, so the row shows the one real magnitude
      // available and omits timing entirely.
      detail: tokens ? `${tokens.toLocaleString()} tokens` : undefined,
      // Always terminal. The tempting heuristic — "last block in the message ⇒
      // still running" — is WRONG here: a finalised turn can legitimately end
      // with only a thinking block (that is the "empty completion" case
      // `emptyCompletion.ts` exists to notice), so that rule would leave a
      // permanent spinner on a turn that is demonstrably over. Reasoning also
      // has no live seam to consult: `getRailLiveStep` is keyed by
      // `tool_use_id`, which a thinking block does not have. While the turn IS
      // streaming the rail is force-open anyway (`deriveRailOpen`), so the text
      // is visible as it accumulates without the row claiming a false state.
      status: 'success',
      consumed: 1,
    }
  },

  // A real body, NOT the default delegation. Omitting `renderDetail` would make
  // the rail call the extension's registered content renderer — `ThinkingContent`
  // — which is itself a bordered Card with its own "Thinking" header and
  // chevron. That would nest a card inside a rail row and reinstate the exact
  // box this change removes. The reasoning text is the whole payload, so it is
  // rendered as plain prose.
  renderDetail: ctx => {
    const data = ctx.content.content as MessageContentDataThinking | undefined
    const text = thinkingTextOf(data)
    if (!text) {
      return createElement(
        'div',
        { className: 'text-sm text-muted-foreground italic' },
        'This provider returned an encrypted reasoning block, which cannot be displayed.',
      )
    }
    // `createElement`, not JSX, so this module stays a `.ts` file. The node test
    // runner cannot load `.tsx`, and js-tool's contribution is JSX-free for the
    // same reason — the difference is that this one needs a real body, so the
    // element is built by hand rather than the body being dropped.
    return createElement(
      'div',
      { className: 'text-sm text-muted-foreground whitespace-pre-wrap' },
      text,
    )
  },
}

export const textRailContributions: RailContribution[] = [thinkingStep]
