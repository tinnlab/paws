import test from 'node:test'
import assert from 'node:assert/strict'

import { textRailContributions } from '@/modules/chat/extensions/text/railContribution'
import type { MessageContent } from '@/api-client/types'

const [thinking] = textRailContributions

function blk(data: unknown, id = 'blk-1'): MessageContent {
  return {
    id,
    content_type: 'thinking',
    content: data as MessageContent['content'],
    created_at: '2026-07-29T10:00:00Z',
    updated_at: '2026-07-29T10:00:00Z',
    message_id: 'm1',
    sequence_order: 0,
  }
}

const describe = (data: unknown, id?: string) => {
  const content = blk(data, id)
  return thinking.describeActivity({ content, blocks: [content], index: 0 })
}

test('claims only the `thinking` content type', () => {
  assert.deepEqual(thinking.contentTypes, ['thinking'])
})

test('describes a thought as a terminal step', () => {
  const step = describe({ type: 'thinking', thinking: 'Let me work through this.' })
  assert.ok(step)
  assert.equal(step.label, 'Thought')
  assert.equal(step.status, 'success')
  assert.equal(step.consumed, 1)
  assert.equal(step.blocking, undefined)
})

test('status is NEVER running — a finalised turn can end on a thinking block', () => {
  // The tempting heuristic ("last block ⇒ still thinking") leaves a permanent
  // spinner on the empty-completion case, where a turn legitimately produces
  // reasoning and nothing else. Pinned because that heuristic is the obvious
  // "improvement" a later edit would reach for.
  const only = blk({ type: 'thinking', thinking: 'reasoning, no answer followed' })
  const step = thinking.describeActivity({ content: only, blocks: [only], index: 0 })
  assert.equal(step?.status, 'success')
})

test('surfaces the token count when the provider reported one, and only then', () => {
  const withTokens = describe({
    type: 'thinking',
    thinking: 'x',
    metadata: { token_count: 1240 },
  })
  assert.equal(withTokens?.detail, '1,240 tokens')

  for (const meta of [undefined, null, { token_count: 0 }, { token_count: -5 }, {}]) {
    const s = describe({ type: 'thinking', thinking: 'x', metadata: meta })
    assert.equal(s?.detail, undefined, `no detail for metadata ${JSON.stringify(meta)}`)
  }
})

test('never fabricates a duration — no timing fields are emitted', () => {
  // No duration is stored on a thinking block, so the row must not imply one.
  // `created_at` is a save-time stamp; deriving "Thought for 4s" from it would
  // present an invented number with the authority of a measurement.
  const step = describe({ type: 'thinking', thinking: 'x', metadata: { token_count: 9 } })
  assert.equal(step?.durationMs, undefined)
  assert.equal(step?.startedAt, undefined)
  assert.ok(!/\bfor\b|\bs\b|second/i.test(step?.label ?? ''))
})

test('declines an empty thought so the rail gains no row the old card never drew', () => {
  // `ThinkingContent` returns null for an empty block. Claiming it would turn a
  // silent no-op into a visible row — clutter added by a de-cluttering feature.
  for (const t of ['', '   ', '\n\t ']) {
    assert.equal(describe({ type: 'thinking', thinking: t }), null, `empty: ${JSON.stringify(t)}`)
  }
  assert.equal(describe({ type: 'thinking' }), null)
  assert.equal(describe(undefined), null)
})

test('a REDACTED block is still a step even though its text is empty', () => {
  // Anthropic returns encrypted reasoning with no readable text. That is a real
  // thought that happened, so it earns a row — the empty-decline above must not
  // swallow it.
  const step = describe({
    type: 'thinking',
    thinking: '',
    metadata: { redacted_data: 'enc:abc' },
  })
  assert.ok(step)
  assert.equal(step.label, 'Thought (redacted)')
  assert.equal(step.status, 'success')
})

test('key is derived from the block id, so two thoughts never collide', () => {
  assert.equal(describe({ type: 'thinking', thinking: 'a' }, 'id-a')?.key, 'thinking:id-a')
  assert.notEqual(
    describe({ type: 'thinking', thinking: 'a' }, 'id-a')?.key,
    describe({ type: 'thinking', thinking: 'a' }, 'id-b')?.key,
  )
})

test('never throws on a malformed block (ITEM-6)', () => {
  for (const bad of [null, 0, 'string', [], { type: 'thinking', thinking: 42 }]) {
    assert.doesNotThrow(() => describe(bad))
  }
})

test('ships its own detail body rather than delegating to the Thinking CARD', () => {
  // Delegation would re-render `ThinkingContent` — a bordered Card with its own
  // header and chevron — nested inside a rail row, reinstating the exact box
  // this change removes.
  assert.equal(typeof thinking.renderDetail, 'function')
})
