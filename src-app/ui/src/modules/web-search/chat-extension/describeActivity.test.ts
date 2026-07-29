import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext } from '@/modules/chat/components/rail/railTypes'
import {
  describeActivity,
  webSearchRailContributions,
} from './describeActivity.ts'

/**
 * TEST-25 [covers ITEM-19, ITEM-6] — `web_search` / `fetch_url` produce labelled
 * steps whose counts and titles come from `structuredContent`, and degrade to a
 * name-only row when there is none.
 */

/** A `tool_use` + its `tool_result`, with (or deliberately without) a payload. */
function ctxFor(
  name: string,
  structured: Record<string, unknown> | null,
  text = '',
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
      content: text,
      is_error: false,
      ...(structured ? { structured_content: structured } : {}),
    },
  } as unknown as MessageContent
  return { content: use, blocks: [use, res], index: 0 }
}

// ── web_search ─────────────────────────────────────────────────────────────
test('web_search reads the result count and provider from structuredContent', () => {
  const step = describeActivity(
    ctxFor('web_search', {
      provider: 'searxng',
      results: [
        { title: 'a', url: 'https://a', snippet: 's' },
        { title: 'b', url: 'https://b', snippet: 's' },
        { title: 'c', url: 'https://c', snippet: 's' },
      ],
    }),
  )
  assert.ok(step)
  assert.equal(step.label, 'Searching the web')
  assert.equal(step.detail, '3 results · via searxng')
  assert.equal(step.status, 'success')
})

test('web_search singularises one result', () => {
  const step = describeActivity(
    ctxFor('web_search', { provider: 'brave', results: [{ title: 'a' }] }),
  )
  assert.equal(step?.detail, '1 result · via brave')
})

test('web_search reports an empty result set as 0 results, not as missing', () => {
  const step = describeActivity(
    ctxFor('web_search', { provider: 'brave', results: [] }),
  )
  assert.equal(step?.detail, '0 results · via brave')
})

test('web_search does NOT parse the free-text digest', () => {
  // The text channel says 9; there is no structuredContent, so the row must be
  // name-only rather than reporting a number scraped out of prose.
  const step = describeActivity(
    ctxFor('web_search', null, '9 result(s) for "x" (via searxng).'),
  )
  assert.ok(step)
  assert.equal(step.label, 'Searching the web')
  assert.equal(step.detail, undefined)
})

// ── fetch_url ──────────────────────────────────────────────────────────────
test('fetch_url shows the page title from structuredContent', () => {
  const step = describeActivity(
    ctxFor('fetch_url', {
      url: 'https://x/a',
      final_url: 'https://x/b',
      title: 'Some Page',
      content: '# Some Page',
      truncated: false,
      byte_count: 1234,
    }),
  )
  assert.ok(step)
  assert.equal(step.label, 'Reading a page')
  assert.equal(step.detail, 'Some Page')
})

test('fetch_url falls back to the final URL when the title is empty', () => {
  const step = describeActivity(
    ctxFor('fetch_url', {
      url: 'https://x/a',
      final_url: 'https://x/b',
      title: '',
      truncated: true,
    }),
  )
  assert.equal(step?.detail, 'https://x/b · truncated')
})

// ── ITEM-6 degradation + declining ─────────────────────────────────────────
test('every web-search tool degrades to a name-only row without structuredContent', () => {
  for (const name of ['web_search', 'fetch_url']) {
    const step = describeActivity(ctxFor(name, null))
    assert.ok(step, `${name} must still yield a row`)
    assert.notEqual(
      step.label,
      name,
      `${name} must still be renamed to domain language`,
    )
    assert.equal(step.detail, undefined, `${name} must have no invented detail`)
    assert.equal(step.consumed, 2)
    assert.equal(step.key, 'T1')
    assert.equal(step.toolUseId, 'T1')
  }
})

test('an unknown tool is declined so the next contribution can claim it', () => {
  assert.equal(
    describeActivity(ctxFor('some_other_tool', { results: [] })),
    null,
  )
})

test('a non-tool block is declined', () => {
  const textBlock = {
    id: 'blk-t',
    content_type: 'text',
    content: { type: 'text', text: 'hi' },
  } as unknown as MessageContent
  assert.equal(
    describeActivity({ content: textBlock, blocks: [textBlock], index: 0 }),
    null,
  )
})

test('describeActivity never throws on a malformed structured payload', () => {
  for (const bad of [[], 'a string', 42, { results: 'not-an-array' }]) {
    const use = {
      id: 'blk-u',
      content_type: 'tool_use',
      content: {
        type: 'tool_use',
        id: 'T1',
        name: 'web_search',
        input: {},
        server_id: 'S',
      },
    } as unknown as MessageContent
    const res = {
      id: 'blk-r',
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
  assert.equal(webSearchRailContributions.length, 1)
  const c = webSearchRailContributions[0]
  assert.deepEqual(c.contentTypes, ['tool_use'])
  assert.ok((c.order ?? 1000) < 1000)
  // renderDetail omitted => the rail delegates to renderContent({content}).
  assert.equal(c.renderDetail, undefined)
})
