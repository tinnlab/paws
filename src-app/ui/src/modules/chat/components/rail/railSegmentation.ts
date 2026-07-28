import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext, RailStepDescriptor } from '@/modules/chat/components/rail/railTypes'

/**
 * Segment a message's blocks into ACTIVITY SPANS vs prose (ITEM-2).
 *
 * Membership is decided by CONTRIBUTIONS, not by a hardcoded content-type list:
 * a block is a step iff some extension's `describeActivity` claims it. The only
 * type list core owns is {@link RAIL_EXCLUDED_TYPES} — the design's "Explicitly
 * out of the rail" set, which is core wire vocabulary (a `MessageContent`
 * discriminant), never an extension name.
 *
 * ITEM-5 — the desync class of bug is removed STRUCTURALLY. The old group card
 * held its `contentSpan` in agreement with its render branch only because two
 * separate code paths both called `shouldWrapRun`. Here the span is computed
 * ONCE, each step records how many blocks it owns, and the renderer walks the
 * SAME array. `sum(step.consumed) === segment.consumed` is an invariant of the
 * data structure, not of two functions agreeing.
 */

/**
 * Content types that are never rail candidates, from `DESIGN.md`
 * § "Explicitly out of the rail":
 *
 * - `text` — prose; it IS the answer.
 * - `thinking` — a standalone answer element. Deliberately untouched: the
 *   grouping simulation measured that folding it in changes the rendered card
 *   count by exactly zero, so absorbing it would be risk without benefit.
 * - `observation` — a background sub-agent result that arrives asynchronously.
 *   It rides a user-ROLE message but is a MESSAGE, not a step
 *   (`ChatMessage.tsx` already forces it full-width).
 * - `file_attachment` / `image` — user attachments, already lifted above the
 *   bubble.
 *
 * Excluded here as a belt-and-braces guard so a future contribution cannot
 * accidentally swallow the answer (INV-6), even if it registers for the type.
 */
export const RAIL_EXCLUDED_TYPES: ReadonlySet<string> = new Set([
  'text',
  'thinking',
  'observation',
  'file_attachment',
  'image',
])

/** A described step together with the block index it starts at. */
export interface PlacedRailStep {
  index: number
  step: RailStepDescriptor
}

export type RailSegment =
  /** A block no contribution claimed — rendered by the existing content path. */
  | { kind: 'prose'; index: number; consumed: 1 }
  /**
   * A step that needs the user (INV-3). Rendered full-width and NON-collapsible
   * as a sibling of the rail, never a row inside it.
   */
  | { kind: 'breakout'; index: number; consumed: number; step: RailStepDescriptor }
  /** A maximal run of consecutive non-blocking steps — one rail. */
  | { kind: 'span'; index: number; consumed: number; steps: PlacedRailStep[] }

/** The describe function the segmenter is parameterised over (the registry supplies the real one). */
export type RailDescribe = (ctx: RailActivityContext) => RailStepDescriptor | null

/**
 * Segment `blocks`. Pure: no React, no registry import, no store read — which is
 * what makes the invariant tests real rather than cosmetic.
 */
export function segmentRail(
  blocks: readonly MessageContent[],
  describe: RailDescribe,
): RailSegment[] {
  const memo = new Map<number, RailStepDescriptor | null>()
  // A `tool_use.id` is not guaranteed unique within a message (a retried or
  // replayed call can repeat one). Two steps sharing a key would collide on the
  // React key, on the per-message expansion state, and on the detail-panel tab
  // id — expanding one row would expand the other and both would open the same
  // tab. Disambiguate by block index on the SECOND and later sighting only, so
  // the common case keeps the clean `tool_use_id` key.
  const seenKeys = new Set<string>()

  /** Describe position `i` at most once, normalising `consumed` into range. */
  const at = (i: number): RailStepDescriptor | null => {
    if (memo.has(i)) return memo.get(i)!
    let out: RailStepDescriptor | null = null
    const block = blocks[i]
    if (block && !RAIL_EXCLUDED_TYPES.has(block.content_type)) {
      let d: RailStepDescriptor | null = null
      try {
        d = describe({ content: block, blocks, index: i })
      } catch {
        // A throwing contribution must degrade to prose, never break the
        // transcript. (ITEM-6 requires name-only degradation inside a
        // contribution; this is the outer backstop.)
        d = null
      }
      if (d) {
        // Clamp so a buggy contribution can neither stall the walk (0 / negative)
        // nor read past the end of the message.
        // Bound the span at the first EXCLUDED block after the anchor, not just
        // at the end of the message. The exclusion set was applied only to the
        // anchor, so a contribution returning `consumed: 3` over
        // [tool_use, text, tool_result] would have swallowed the `text` — the
        // answer itself — and the render loop would have advanced past it
        // without drawing it. That is the INV-6 failure this set exists to
        // prevent, arriving through the span rather than through the anchor.
        //
        // A BLOCKING step is additionally pinned to its anchor: the breakout
        // renders exactly one block, so any larger span would silently drop the
        // remainder (the "span says N, renders M" class ITEM-5 removes).
        let max = blocks.length - i
        for (let k = i + 1; k < blocks.length; k++) {
          if (RAIL_EXCLUDED_TYPES.has(blocks[k].content_type)) {
            max = k - i
            break
          }
        }
        const consumed = d.blocking
          ? 1
          : Math.min(Math.max(1, Math.floor(d.consumed) || 1), max)
        const key = seenKeys.has(d.key) ? `${d.key}#${i}` : d.key
        seenKeys.add(d.key)
        seenKeys.add(key)
        out = consumed === d.consumed && key === d.key ? d : { ...d, consumed, key }
      }
    }
    memo.set(i, out)
    return out
  }

  const segments: RailSegment[] = []
  let i = 0
  while (i < blocks.length) {
    const step = at(i)

    if (!step) {
      segments.push({ kind: 'prose', index: i, consumed: 1 })
      i += 1
      continue
    }

    if (step.blocking) {
      segments.push({ kind: 'breakout', index: i, consumed: step.consumed, step })
      i += step.consumed
      continue
    }

    // Accrete every consecutive non-blocking step into ONE rail.
    const start = i
    const steps: PlacedRailStep[] = []
    while (i < blocks.length) {
      const s = at(i)
      if (!s || s.blocking) break
      steps.push({ index: i, step: s })
      i += s.consumed
    }
    segments.push({
      kind: 'span',
      index: start,
      consumed: i - start,
      steps,
    })
  }

  return segments
}

/**
 * The rail's own open/closed decision (ITEM-7 / ITEM-9, INV-4 / INV-5).
 *
 * - While the turn is WORKING the rail is open: the user's question is "what is
 *   it doing, is it stuck?".
 * - A FAILED or TIMED-OUT step FORCES it open and keeps it open. A red dot
 *   inside a collapsed summary is a silent failure, so this overrides a user
 *   collapse exactly as the retired group card's `deriveGroupOpen` overrode one
 *   for a pending approval.
 * - Otherwise it follows the user's persisted choice, defaulting to collapsed
 *   once an answer exists ("get out of my way, but let me audit any step").
 */
export function deriveRailOpen(args: {
  isStreaming: boolean
  hasFailure: boolean
  userOpen: boolean | undefined
}): boolean {
  if (args.hasFailure) return true
  if (args.isStreaming) return true
  return args.userOpen ?? false
}

/** True when any step in the span is in a failure-shaped terminal state. */
export function spanHasFailure(steps: readonly PlacedRailStep[]): boolean {
  return steps.some(s => s.step.status === 'failed' || s.step.status === 'timeout')
}

/**
 * A span of exactly ONE step renders as a single quiet line — no spine, no
 * summary row, no collapse control (DEC-4/DEC-3: 84% of tool-using messages are
 * a single call, and "a rail of one is ceremony"). The row itself is always
 * visible, so INV-5 is satisfied trivially for this shape.
 */
export function isQuietSingle(steps: readonly PlacedRailStep[]): boolean {
  return steps.length === 1
}
