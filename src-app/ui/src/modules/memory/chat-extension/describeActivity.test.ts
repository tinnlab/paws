import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext } from '@/modules/chat/components/rail/railTypes'
import {
  describeActivity,
  excerpt,
  memoryRailContributions,
} from './describeActivity.ts'

/**
 * TEST-29 [covers ITEM-19, ITEM-6] — `remember` / `recall` / `forget` yield
 * steps built from the STRUCTURED output despite the module stringifying its
 * text channel (`memory_mcp/handlers.rs:224-227` emits `v.to_string()` as the
 * "readable" text), and degrade to a name-only row when there is no payload.
 */

function ctxFor(
  name: string,
  structured: Record<string, unknown> | null,
): RailActivityContext {
  const use = {
    id: 'blk-u',
    content_type: 'tool_use',
    content: { type: 'tool_use', id: 'T1', name, input: {}, server_id: 'S1' },
  } as unknown as MessageContent
  const res = {
    id: 'blk-r',
    content_type: 'tool_result',
    content: {
      type: 'tool_result',
      tool_use_id: 'T1',
      name,
      // The REAL text channel for this server: the same value, stringified.
      content: structured ? JSON.stringify(structured) : '',
      is_error: false,
      ...(structured ? { structured_content: structured } : {}),
    },
  } as unknown as MessageContent
  return { content: use, blocks: [use, res], index: 0 }
}

// ── remember ───────────────────────────────────────────────────────────────
test('remember builds its detail from the structured content + scope', () => {
  const step = describeActivity(
    ctxFor('remember', {
      memory_id: '11111111-1111-1111-1111-111111111111',
      content: 'Prefers metric units',
      scope: 'user',
    }),
  )
  assert.ok(step)
  assert.equal(step.label, 'Saving a memory')
  assert.equal(step.detail, 'Prefers metric units · user scope')
  // The stringified JSON text channel must never leak into the row.
  assert.ok(!step.detail?.includes('memory_id'))
  assert.ok(!step.detail?.includes('{'))
})

test('remember collapses whitespace and ellipsises a long memory', () => {
  const long = `${'a'.repeat(200)}`
  const step = describeActivity(
    ctxFor('remember', { content: long, scope: 'conversation' }),
  )
  assert.ok(step)
  assert.ok((step.detail ?? '').length < 100)
  assert.ok(step.detail?.includes('…'))
  assert.ok(step.detail?.endsWith('conversation scope'))
})

test('excerpt flattens whitespace and only ellipsises past the cap', () => {
  assert.equal(excerpt('a\n  b\tc'), 'a b c')
  assert.equal(excerpt('abcdef', 4), 'abc…')
  assert.equal(excerpt('abc', 4), 'abc')
})

// ── recall ─────────────────────────────────────────────────────────────────
test('recall reports the number of memories from the structured payload', () => {
  const step = describeActivity(
    ctxFor('recall', {
      memories: [
        { id: '1', content: 'a' },
        { id: '2', content: 'b' },
      ],
    }),
  )
  assert.ok(step)
  assert.equal(step.label, 'Recalling memories')
  assert.equal(step.detail, '2 memories')
})

test('recall pluralises correctly and reports an empty hit set', () => {
  assert.equal(
    describeActivity(ctxFor('recall', { memories: [{ id: '1' }] }))?.detail,
    '1 memory',
  )
  assert.equal(
    describeActivity(ctxFor('recall', { memories: [] }))?.detail,
    '0 memories',
  )
})

// ── forget ─────────────────────────────────────────────────────────────────
test('forget reports the deleted flag', () => {
  const step = describeActivity(
    ctxFor('forget', { memory_id: '1111', deleted: true }),
  )
  assert.equal(step?.label, 'Forgetting a memory')
  assert.equal(step?.detail, 'deleted')
})

// ── ITEM-6 degradation + declining ─────────────────────────────────────────
test('every memory tool degrades to a name-only row without structuredContent', () => {
  for (const name of ['remember', 'recall', 'forget']) {
    const step = describeActivity(ctxFor(name, null))
    assert.ok(step, `${name} must still yield a row`)
    assert.notEqual(
      step.label,
      name,
      `${name} must still be renamed to domain language`,
    )
    assert.equal(step.detail, undefined, `${name} must have no invented detail`)
    assert.equal(step.key, 'T1')
    assert.equal(step.consumed, 2)
  }
})

test('an unknown tool is declined so the next contribution can claim it', () => {
  assert.equal(describeActivity(ctxFor('web_search', { results: [] })), null)
})

test('describeActivity never throws on a malformed structured payload', () => {
  for (const bad of [[], 'x', 9, { memories: 'nope', content: 5 }]) {
    const use = {
      id: 'u',
      content_type: 'tool_use',
      content: {
        type: 'tool_use',
        id: 'T1',
        name: 'recall',
        input: {},
        server_id: 'S',
      },
    } as unknown as MessageContent
    const res = {
      id: 'r',
      content_type: 'tool_result',
      content: {
        type: 'tool_result',
        tool_use_id: 'T1',
        structured_content: bad,
      },
    } as unknown as MessageContent
    assert.doesNotThrow(() =>
      describeActivity({ content: use, blocks: [use, res], index: 0 }),
    )
  }
})

// ── registration shape ─────────────────────────────────────────────────────
test('the contribution claims tool_use and outranks the generic fallback', () => {
  assert.equal(memoryRailContributions.length, 1)
  const c = memoryRailContributions[0]
  assert.deepEqual(c.contentTypes, ['tool_use'])
  assert.ok((c.order ?? 1000) < 1000)
  assert.equal(c.renderDetail, undefined)
})
