import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import {
  artifactsFor,
  countLabel,
  countOf,
  railToolStepBase,
  resultBlockFor,
  stringOf,
  structuredOf,
  titleCaseToolId,
  toolStepSpan,
} from './railBlocks.ts'
import { __resetRailLiveSourceForTests, setRailLiveSource } from '@/modules/chat/core/rail/liveSteps'

// TEST-13 (ITEM-6): a block with ABSENT, DROPPED or MALFORMED structured_content
// still yields a name-only row rather than throwing or rendering an empty step.
//
// This is not a defensive nicety. `cap_structured_content` in the backend DROPS
// an oversized payload rather than truncating it, and `ask_user`, `delegate`,
// `schedule_next` and `files_mcp` image/binary reads emit none at all — so the
// null case is the COMMON case for several tool families.

const use = (id: string, name: string, input: unknown = {}): MessageContent =>
  ({
    id: `blk-${id}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id, name, input, server_id: 's' },
  }) as unknown as MessageContent

const result = (
  toolUseId: string,
  over: Record<string, unknown> = {},
): MessageContent =>
  ({
    id: `res-${toolUseId}`,
    content_type: 'tool_result',
    content: { type: 'tool_result', tool_use_id: toolUseId, content: 'ok', ...over },
  }) as unknown as MessageContent

const ctxOf = (blocks: MessageContent[], index = 0) => ({
  content: blocks[index],
  blocks,
  index,
})

test('TEST-13: no structured_content at all → a name-only row, no throw', () => {
  const blocks = [use('t1', 'fetch_url'), result('t1')]
  assert.equal(structuredOf(ctxOf(blocks)), null)
  const base = railToolStepBase(ctxOf(blocks))
  assert.ok(base)
  assert.equal(base?.label, 'fetch_url')
  assert.equal(base?.status, 'success')
  assert.equal(base?.consumed, 2)
})

test('TEST-13: a MALFORMED structured_content (array / string / null) degrades, never throws', () => {
  for (const sc of [[], 'oops', null, 42, undefined]) {
    const blocks = [use('t1', 'x'), result('t1', { structured_content: sc })]
    assert.doesNotThrow(() => structuredOf(ctxOf(blocks)))
    assert.equal(structuredOf(ctxOf(blocks)), null, `sc=${JSON.stringify(sc)} must read as null`)
    const base = railToolStepBase(ctxOf(blocks))
    assert.ok(base, 'a malformed payload still yields a row')
    assert.ok(base && base.label.length > 0, 'the row is never empty')
  }
})

test('TEST-13: an IN-FLIGHT tool_use with no result yet is a running, single-block step', () => {
  const blocks = [use('t1', 'execute_command')]
  const base = railToolStepBase(ctxOf(blocks))
  assert.equal(base?.status, 'running')
  assert.equal(base?.consumed, 1)
  assert.equal(resultBlockFor(ctxOf(blocks)), null)
})

test('an is_error result maps to failed', () => {
  const failed = [use('t1', 'x'), result('t1', { is_error: true })]
  assert.equal(railToolStepBase(ctxOf(failed))?.status, 'failed')
})

test('INV-1: core does NOT special-case the scheduler skip markers', () => {
  // These markers belong to one backend surface, and core encoding their
  // vocabulary would violate INV-1 just as surely as importing the module would
  // ("never imports, NAMES, or special-cases any extension"). The neutral
  // `cancelled` mapping lives in the scheduler contribution, which sits at
  // order 20 — ahead of every tool family — so it is still the one decision
  // point. Asserted from CORE's side: the base must NOT quietly re-map them.
  for (const marker of ['unattended_denied', 'admin_disabled']) {
    const blocks = [
      use('t1', 'x'),
      result('t1', { is_error: true, structured_content: { [marker]: true, tool_name: 'x' } }),
    ]
    assert.equal(
      railToolStepBase(ctxOf(blocks))?.status,
      'failed',
      'core reports only what the block says; the OWNING module reinterprets it',
    )
  }
})

test('toolStepSpan: a step owns its tool_use plus only ITS OWN following results', () => {
  assert.equal(toolStepSpan(ctxOf([use('t1', 'x')])), 1)
  assert.equal(toolStepSpan(ctxOf([use('t1', 'x'), result('t1')])), 2)
  // A parallel tool's result must not be swallowed.
  assert.equal(toolStepSpan(ctxOf([use('t1', 'x'), result('t2')])), 1)
  // A text block ends the step.
  const withText = [use('t1', 'x'), { content_type: 'text', content: {} } as MessageContent]
  assert.equal(toolStepSpan(ctxOf(withText)), 1)
})

test('artifactsFor: names resource links, and SKIPS a blanked (rejected ziee://) uri', () => {
  const blocks = [
    use('t1', 'x'),
    result('t1', {
      resource_links: [
        { uri: '/api/files/abc', name: 'chart.svg' },
        { uri: '', name: '' }, // the strip-before-client guard blanked this one
        { uri: '/api/files/def', name: '' }, // falls back to the uri's last segment
      ],
    }),
  ]
  const arts = artifactsFor(ctxOf(blocks))
  assert.deepEqual(arts.map(a => a.name), ['chart.svg', 'def'])
})

test('the LIVE seam supplies pending-approval + timing that no persisted block can express', () => {
  // Core owns the seam; whichever extension owns the tool SSE frames feeds it.
  // With NO source registered the rail must still work — that is what a reload,
  // a unit test and a gallery render all see.
  __resetRailLiveSourceForTests()
  const blocks = [use('t1', 'x')]
  assert.equal(railToolStepBase(ctxOf(blocks))?.status, 'running')

  setRailLiveSource({
    get: id => (id === 't1' ? { status: 'pending_approval', startedAt: '2026-07-27T12:00:00Z' } : null),
    subscribe: () => () => {},
  })
  const base = railToolStepBase(ctxOf(blocks))
  assert.equal(base?.status, 'pending-approval')
  assert.equal(base?.startedAt, '2026-07-27T12:00:00Z')

  // A source that throws must not break the row.
  setRailLiveSource({
    get: () => {
      throw new Error('store exploded')
    },
    subscribe: () => () => {},
  })
  assert.doesNotThrow(() => railToolStepBase(ctxOf(blocks)))
  __resetRailLiveSourceForTests()
})

test('titleCaseToolId / countOf / stringOf / countLabel — the shared contribution helpers', () => {
  assert.equal(titleCaseToolId('fetch_paper_fulltext'), 'Fetch Paper Fulltext')
  assert.equal(titleCaseToolId('web-search'), 'Web Search')
  assert.equal(countOf(null, 'results'), null)
  assert.equal(countOf({ results: 3 }, 'results'), 3)
  assert.equal(countOf({ records: [1, 2] }, 'results', 'records'), 2)
  assert.equal(stringOf({ query: '  cats ' }, 'query'), 'cats')
  assert.equal(stringOf({ query: '   ' }, 'query'), null)
  assert.equal(countLabel(1, 'result'), '1 result')
  assert.equal(countLabel(2, 'result'), '2 results')
  assert.equal(countLabel(2, 'entry', 'entries'), '2 entries')
})

test('INV-3: a pending-approval step is BLOCKING straight from the base — no contribution can forget it', () => {
  // A domain contribution (order 40) pre-empts the generic one (order 1000), so
  // if `blocking` lived only in the generic contribution, every tool family that
  // claimed its own tools would silently lose the breakout guarantee.
  __resetRailLiveSourceForTests()
  const blocks = [use('t1', 'web_search')]
  assert.equal(railToolStepBase(ctxOf(blocks))?.blocking, false)

  setRailLiveSource({
    get: () => ({ status: 'pending_approval' }),
    subscribe: () => () => {},
  })
  const base = railToolStepBase(ctxOf(blocks))
  assert.equal(base?.status, 'pending-approval')
  assert.equal(base?.blocking, true)
  __resetRailLiveSourceForTests()
})
