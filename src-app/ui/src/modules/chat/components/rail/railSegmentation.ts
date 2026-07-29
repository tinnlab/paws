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
 * - `observation` — a background sub-agent result that arrives asynchronously.
 *   It rides a user-ROLE message but is a MESSAGE, not a step
 *   (`ChatMessage.tsx` already forces it full-width).
 * - `file_attachment` / `image` — user attachments, already lifted above the
 *   bubble.
 *
 * Excluded here as a belt-and-braces guard so a future contribution cannot
 * accidentally swallow the answer (INV-6), even if it registers for the type.
 *
 * ## `thinking` was removed from this set (DEC-13)
 *
 * Reasoning is now a rail STEP, contributed by the `text` extension (which owns
 * the `thinking` wire vocabulary), not an excluded standalone element. The
 * original exclusion was unargued — `observation` has DEC-11 to justify it,
 * `thinking` had only a list entry — and it left the rail solving half its own
 * stated problem, since the design's motivating measurement was "14 boxes, 7 of
 * them Thinking".
 *
 * INV-6 is UNAFFECTED: the invariant is that the rail can never swallow the
 * ANSWER, and the answer is `text`, which remains excluded. A span may now cross
 * a thinking block, which is precisely the intent — one timeline for the turn
 * rather than a rail interrupted by bordered reasoning cards.
 */
export const RAIL_EXCLUDED_TYPES: ReadonlySet<string> = new Set([
  'text',
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

/**
 * Merge a RE-RESOLVED step back onto its placed one, keeping every field
 * SEGMENTATION owns: `key`, `consumed` and `blocking`.
 *
 * `ChatMessage` re-resolves each step through the contribution registry on every
 * render so live status/timing refresh (`ActivityRail` is subscribed to the
 * live-step seam; the memoised message is not). But re-resolution goes back to
 * the CONTRIBUTION, which knows nothing about this message's layout — so any
 * shape field taken from it silently overrides what segmentation decided.
 *
 * Three fields, three reasons:
 *  - **`key`** — `segmentRail` disambiguates a REPEATED key to `${key}#${i}`;
 *    the contribution always returns the bare one. Losing the suffix collides
 *    the React key in `ActivityRail` and the per-message expansion state
 *    (`stepStateKey`) in `RailStep`, and splits a breakout's `data-step-key`
 *    from a rail row's into two namespaces.
 *  - **`consumed`** (FIX_ROUND-5) — `segmentRail` CLAMPS it to the first
 *    `RAIL_EXCLUDED_TYPES` block after the anchor, which is the ITEM-5 guard
 *    against a contribution swallowing the prose answer. `ActivityRail` passes
 *    the re-resolved step to `renderStepDetail`, which reads
 *    `placed.step.consumed` — so an over-reporting contribution had its clamp
 *    bypassed at detail-render time and its body redrew blocks the segmentation
 *    loop already rendered separately. That is exactly the "span says N, renders
 *    M" class ITEM-5 exists to make impossible.
 *  - **`blocking`** — segmentation is what turns a blocking step into a
 *    BREAKOUT rather than a span member; a span member re-resolving to
 *    `blocking: true` cannot change that decision and must not pretend to.
 *
 * Segmentation owns the SHAPE and the identity; re-resolution owns the STATE.
 * Extracted (FIX_ROUND-4) so that rule is pinned by a test rather than living
 * inline where a one-line revert turned nothing red.
 */
export function withSegmentationShape(
  placed: PlacedRailStep,
  resolved: RailStepDescriptor | undefined | null,
): RailStepDescriptor {
  if (!resolved) return placed.step
  const shapeIntact =
    resolved.key === placed.step.key &&
    resolved.consumed === placed.step.consumed &&
    resolved.blocking === placed.step.blocking
  return shapeIntact
    ? resolved
    : {
        ...resolved,
        key: placed.step.key,
        consumed: placed.step.consumed,
        blocking: placed.step.blocking,
      }
}
