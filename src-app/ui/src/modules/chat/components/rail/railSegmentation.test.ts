import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import {
  RAIL_EXCLUDED_TYPES,
  deriveRailOpen,
  isQuietSingle,
  segmentRail,
  spanHasFailure,
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
  for (const t of ['observation', 'file_attachment', 'image', 'text', 'thinking']) {
    const segs = segmentRail([blk(t)], greedy)
    assert.deepEqual(kinds(segs), ['prose'], `${t} must stay prose even if a contribution claims it`)
  }
  // And the exclusion set is exactly the design's list.
  assert.deepEqual(
    [...RAIL_EXCLUDED_TYPES].sort(),
    ['file_attachment', 'image', 'observation', 'text', 'thinking'],
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
