import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import {
  RAIL_EXCLUDED_TYPES,
  deriveRailOpen,
  isQuietSingle,
  segmentRail,
  spanHasFailure,
  withSegmentationShape,
  type RailSegment,
} from './railSegmentation.ts'
import type { RailStepDescriptor } from './railTypes.ts'

// TEST-11 (ITEM-2), TEST-12 (ITEM-5), TEST-40 (ITEM-10).
// Pure — no React, no registry, no store. The `describe` function is injected,
// which is precisely how the rail decides span membership from CONTRIBUTIONS
// rather than from a hardcoded content-type list.

const blk = (content_type: string, content: unknown = {}): MessageContent =>
  ({ id: `${content_type}-${Math.random()}`, content_type, content }) as unknown as MessageContent

/** A describe that claims `tool_use`, consuming the tool_use + its result. */
const describeToolPairs = (ctx: {
  content: MessageContent
  blocks: readonly MessageContent[]
  index: number
}): RailStepDescriptor | null => {
  if (ctx.content.content_type !== 'tool_use') return null
  const next = ctx.blocks[ctx.index + 1]
  const consumed = next?.content_type === 'tool_result' ? 2 : 1
  const c = ctx.content.content as { name?: string; blocking?: boolean }
  return {
    key: `k${ctx.index}`,
    label: c.name ?? 'tool',
    status: 'success',
    consumed,
    blocking: c.blocking,
  }
}

const kinds = (segs: RailSegment[]) => segs.map(s => s.kind)

test('TEST-11: consecutive tool pairs accrete into ONE span; prose is untouched', () => {
  const blocks = [
    blk('text'),
    blk('tool_use', { name: 'a' }),
    blk('tool_result'),
    blk('tool_use', { name: 'b' }),
    blk('tool_result'),
    blk('text'),
  ]
  const segs = segmentRail(blocks, describeToolPairs)
  assert.deepEqual(kinds(segs), ['prose', 'span', 'prose'])
  const span = segs[1]
  assert.equal(span.kind, 'span')
  if (span.kind !== 'span') return
  assert.equal(span.steps.length, 2)
  assert.deepEqual(span.steps.map(s => s.step.label), ['a', 'b'])
})

test('TEST-11: a narration text block BREAKS the run into two rails', () => {
  // The grouping simulation measured a short narration `text` block (78
  // occurrences, median 51 chars) as the real run-breaker — not the tool card.
  const blocks = [
    blk('tool_use', { name: 'a' }),
    blk('tool_result'),
    blk('text'),
    blk('tool_use', { name: 'b' }),
    blk('tool_result'),
  ]
  assert.deepEqual(kinds(segmentRail(blocks, describeToolPairs)), ['span', 'prose', 'span'])
})

test('TEST-11: observation, user attachments and images are NEVER absorbed into a span', () => {
  // `DESIGN.md` § Explicitly out of the rail. `observation` in particular rides a
  // user-ROLE message but is a MESSAGE, not a step.
  const greedy = () => ({
    key: 'k',
    label: 'greedy',
    status: 'success' as const,
    consumed: 1,
  })
  for (const t of ['observation', 'file_attachment', 'image', 'text']) {
    const segs = segmentRail([blk(t)], greedy)
    assert.deepEqual(kinds(segs), ['prose'], `${t} must stay prose even if a contribution claims it`)
  }
  // And the exclusion set is exactly the design's list, as amended by DEC-13
  // (which removed `thinking` — see the next test).
  assert.deepEqual(
    [...RAIL_EXCLUDED_TYPES].sort(),
    ['file_attachment', 'image', 'observation', 'text'],
  )
})

test('DEC-13: `thinking` IS a rail candidate — reasoning becomes a step, not a bordered card', () => {
  // The positive half of TEST-11. Removing a name from an exclusion set only
  // stops something being FORBIDDEN; without this, nothing asserts it is now
  // ALLOWED, and re-adding `thinking` to the set would leave the suite green.
  const claims = () => ({
    key: 'k',
    label: 'Thought',
    status: 'success' as const,
    consumed: 1,
  })
  assert.deepEqual(
    kinds(segmentRail([blk('thinking')], claims)),
    ['span'],
    'a claimed thinking block must segment as a rail step',
  )

  // The point of the change: reasoning between two tool calls no longer splits
  // the timeline into two rails with a card wedged between them. Before DEC-13
  // this produced ['span', 'prose', 'span'].
  const mixed = [blk('tool_use'), blk('thinking'), blk('tool_use')]
  assert.deepEqual(
    kinds(segmentRail(mixed, claims)),
    ['span'],
    'thinking must no longer break a run into separate rails',
  )

  // NEGATIVE CONTROL — the guarantee that actually matters (INV-6) is untouched:
  // the answer is still unswallowable. If a future edit widened the removal to
  // `text`, the assertion above would still pass and this one would fail.
  assert.deepEqual(
    kinds(segmentRail([blk('tool_use'), blk('text'), blk('tool_use')], claims)),
    ['span', 'prose', 'span'],
    'prose answer must still split the rail — INV-6',
  )
})

test('TEST-12 (ITEM-5): a span’s reported consumed ALWAYS equals the sum of its steps’ consumed', () => {
  // This is the class of bug the retired group card lived with: its render
  // branch and its `contentSpan` were two code paths that had to agree about the
  // size of a run. Here the span is computed once and the renderer walks the same
  // array, so the property is structural — assert it over every shape that used
  // to be able to desync.
  const shapes: MessageContent[][] = [
    [blk('tool_use', { name: 'a' })], // no result yet (in flight)
    [blk('tool_use', { name: 'a' }), blk('tool_result')],
    [blk('tool_use', { name: 'a' }), blk('tool_result'), blk('tool_result')],
    [blk('tool_use', { name: 'a' }), blk('tool_use', { name: 'b' }), blk('tool_result')],
    [blk('tool_result'), blk('tool_use', { name: 'a' }), blk('tool_result')],
    [blk('text'), blk('tool_use', { name: 'a' }), blk('tool_result'), blk('text')],
  ]
  for (const blocks of shapes) {
    const segs = segmentRail(blocks, describeToolPairs)
    let total = 0
    for (const s of segs) {
      total += s.consumed
      if (s.kind !== 'span') continue
      const sum = s.steps.reduce((n, p) => n + p.step.consumed, 0)
      assert.equal(sum, s.consumed, `span consumed ${s.consumed} but its steps sum to ${sum}`)
    }
    assert.equal(total, blocks.length, 'every block must be accounted for exactly once')
  }
})

test('TEST-12: a contribution that reports 0, a negative, or an over-long span cannot stall or overrun', () => {
  const bad = (n: number) => () =>
    ({ key: 'k', label: 'x', status: 'success' as const, consumed: n })
  for (const n of [0, -3, Number.NaN, 99]) {
    const blocks = [blk('tool_use'), blk('tool_result')]
    const segs = segmentRail(blocks, bad(n))
    const total = segs.reduce((t, s) => t + s.consumed, 0)
    assert.equal(total, blocks.length, `consumed=${n} must be clamped into range`)
  }
})

test('TEST-12: a THROWING contribution degrades the block to prose, never breaks the transcript', () => {
  const boom = () => {
    throw new Error('contribution exploded')
  }
  assert.deepEqual(kinds(segmentRail([blk('tool_use')], boom)), ['prose'])
})

test('TEST-40 (ITEM-10, INV-3): a blocking step is a BREAKOUT sibling, never a collapsible span member', () => {
  const blocks = [
    blk('tool_use', { name: 'a' }),
    blk('tool_result'),
    blk('tool_use', { name: 'needs-you', blocking: true }),
    blk('tool_use', { name: 'c' }),
    blk('tool_result'),
  ]
  const segs = segmentRail(blocks, describeToolPairs)
  assert.deepEqual(kinds(segs), ['span', 'breakout', 'span'])
  // and it is never swept into an adjacent rail
  for (const s of segs) {
    if (s.kind !== 'span') continue
    assert.ok(
      s.steps.every(p => !p.step.blocking),
      'a blocking step must never appear inside a rail span',
    )
  }
})

test('TEST-40: a message consisting ONLY of a blocking request produces no rail at all', () => {
  const segs = segmentRail([blk('tool_use', { name: 'x', blocking: true })], describeToolPairs)
  assert.deepEqual(kinds(segs), ['breakout'])
})

// ── Lifecycle (ITEM-7 / ITEM-9) ───────────────────────────────────────────────

test('deriveRailOpen: open while streaming, collapsed once the answer exists', () => {
  assert.equal(deriveRailOpen({ isStreaming: true, hasFailure: false, userOpen: undefined }), true)
  assert.equal(deriveRailOpen({ isStreaming: false, hasFailure: false, userOpen: undefined }), false)
  assert.equal(deriveRailOpen({ isStreaming: false, hasFailure: false, userOpen: true }), true)
})

test('deriveRailOpen: a failure FORCES open and overrides a user collapse (INV-5)', () => {
  assert.equal(deriveRailOpen({ isStreaming: false, hasFailure: true, userOpen: false }), true)
})

test('spanHasFailure counts both failed AND timed-out steps', () => {
  const step = (status: RailStepDescriptor['status']) => ({
    index: 0,
    step: { key: 'k', label: 'l', status, consumed: 1 },
  })
  assert.equal(spanHasFailure([step('success')]), false)
  assert.equal(spanHasFailure([step('success'), step('failed')]), true)
  assert.equal(spanHasFailure([step('timeout')]), true)
  // A cancel is a user/policy choice, not a failure — it must NOT force open.
  assert.equal(spanHasFailure([step('cancelled')]), false)
})

test('isQuietSingle: one step renders without rail ceremony (DEC-3)', () => {
  const s = { index: 0, step: { key: 'k', label: 'l', status: 'success' as const, consumed: 1 } }
  assert.equal(isQuietSingle([s]), true)
  assert.equal(isQuietSingle([s, s]), false)
})

/**
 * FIX_ROUND-4 (regression for the FIX_ROUND-3 fix).
 *
 * `segmentRail` disambiguates a REPEATED key to `${key}#${i}` — two steps
 * sharing one would collide on the React key in `ActivityRail` and on the
 * per-message expansion state (`stepStateKey`) in `RailStep`. `ChatMessage`
 * re-resolves each step through the contribution registry for live status, and
 * that re-resolution returns the CONTRIBUTION's key, which never carries the
 * suffix. FIX_ROUND-3 made `resolveStep` pin segmentation's key back on; nothing
 * pinned that, so the one-line revert `return resolved` turned nothing red.
 *
 * The two tests below are the missing halves: that segmentation disambiguates at
 * all, and that re-resolution preserves it.
 */
test('segmentRail disambiguates a REPEATED step key (replayed tool_use_id)', () => {
  // A describe that returns the SAME key for every block — a replayed call.
  const describeSameKey = (ctx: { content: MessageContent }): RailStepDescriptor | null =>
    ctx.content.content_type !== 'tool_use'
      ? null
      : { key: 'dup', label: 'tool', status: 'success', consumed: 1 }

  const segs = segmentRail([blk('tool_use'), blk('tool_use')], describeSameKey)
  const keys = segs
    .filter((s): s is Extract<RailSegment, { kind: 'span' }> => s.kind === 'span')
    .flatMap(s => s.steps.map(p => p.step.key))

  assert.equal(keys.length, 2, 'both replayed calls must be present')
  assert.equal(keys[0], 'dup')
  assert.notEqual(keys[1], keys[0], 'the second must be disambiguated, not a duplicate')
  assert.equal(new Set(keys).size, keys.length, 'keys must be unique within a span')
})

test('withSegmentationShape PRESERVES every field segmentation owns', () => {
  // The fixture DELIBERATELY differs on all three: FIX_ROUND-6 found the earlier
  // version pinned only `key`, because `consumed` happened to be equal on both
  // sides and `blocking` was undefined on both — so reverting the `consumed` /
  // `blocking` clamp (the ITEM-5 guard) turned nothing red.
  const placed = {
    index: 1,
    step: {
      key: 'dup#1',
      label: 'l',
      status: 'success' as const,
      consumed: 1, // segmentation CLAMPED it
      blocking: false, // segmentation placed it in a span, not a breakout
    },
  }
  // What the registry hands back: fresh live STATE, but the contribution's own
  // shape — a bare key, an UNCLAMPED consumed, and its own blocking claim.
  const resolved: RailStepDescriptor = {
    key: 'dup',
    label: 'l',
    status: 'failed',
    consumed: 3,
    blocking: true,
  }

  const merged = withSegmentationShape(placed, resolved)
  assert.equal(merged.key, 'dup#1', 'segmentation owns the identity')
  assert.equal(merged.consumed, 1, 'segmentation owns the consumed CLAMP (ITEM-5)')
  assert.equal(merged.blocking, false, 'segmentation owns span-vs-breakout')
  assert.equal(merged.status, 'failed', 're-resolution owns the state')

  // Shape intact -> the SAME object, no needless copy on the common path.
  const same: RailStepDescriptor = { ...placed.step }
  assert.equal(withSegmentationShape(placed, same), same)

  // …and the intactness CHECK must cover every pinned field, not just `key`.
  // FIX_ROUND-7: without these, dropping a term from `shapeIntact` was a silent
  // mutant — a re-resolved step with a matching key but an UNCLAMPED `consumed`
  // was returned verbatim, breaking the ITEM-5 invariant this test cites, and
  // both fixtures above stayed green.
  const sameKeyWiderConsumed: RailStepDescriptor = { ...placed.step, consumed: 3 }
  assert.equal(
    withSegmentationShape(placed, sameKeyWiderConsumed).consumed,
    1,
    'a matching key must not let an unclamped consumed through',
  )
  const sameKeyBlockingFlipped: RailStepDescriptor = { ...placed.step, blocking: true }
  assert.equal(
    withSegmentationShape(placed, sameKeyBlockingFlipped).blocking,
    false,
    'a matching key must not let a flipped blocking through',
  )

  // No resolution at all -> fall back to the placed step, never undefined.
  assert.equal(withSegmentationShape(placed, null), placed.step)
  assert.equal(withSegmentationShape(placed, undefined), placed.step)
})
