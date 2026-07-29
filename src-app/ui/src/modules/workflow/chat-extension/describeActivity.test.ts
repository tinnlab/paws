import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import { RUN_FROM_WORKSPACE, describeWorkspaceRun } from './describeActivity.ts'

// TEST-24 (ITEM-18) — the workflow contribution. Shipped uncovered; audit caught it.

const use = (name: string, id = 't1'): MessageContent =>
  ({
    id: `blk-${id}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id, name, input: {}, server_id: 's' },
  }) as unknown as MessageContent

const result = (toolUseId: string, over: Record<string, unknown> = {}): MessageContent =>
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

test('TEST-24: run_from_workspace yields a labelled step', () => {
  const step = describeWorkspaceRun(ctxOf([use(RUN_FROM_WORKSPACE), result('t1')]))
  assert.ok(step)
  assert.ok((step?.label.length ?? 0) > 0)
  assert.notEqual(step?.label, RUN_FROM_WORKSPACE, 'the raw tool id is not a label')
})

test('TEST-24: it DECLINES another module’s tool', () => {
  assert.equal(describeWorkspaceRun(ctxOf([use('web_search')])), null)
  assert.equal(describeWorkspaceRun(ctxOf([use('search_knowledge')])), null)
})

test('TEST-24: no structured_content still yields a usable row (ITEM-6)', () => {
  const step = describeWorkspaceRun(ctxOf([use(RUN_FROM_WORKSPACE), result('t1')]))
  assert.ok(step)
  assert.ok((step?.label.length ?? 0) > 0)
})

test('TEST-24: a malformed structured_content does not throw', () => {
  for (const sc of [[], 'oops', 42, null]) {
    const blocks = [use(RUN_FROM_WORKSPACE), result('t1', { structured_content: sc })]
    assert.doesNotThrow(() => describeWorkspaceRun(ctxOf(blocks)))
  }
})
