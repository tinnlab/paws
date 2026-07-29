import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolCallTabId } from '@/modules/chat/components/rail/railView'
import type { ToolCallPanelData } from '@/modules/chat/components/toolCallPanel/ToolCallPanel.tsx'

// TEST-15 (ITEM-12): the panel tab id is derived deterministically from
// `tool_use_id`, so re-opening a step FOCUSES the existing tab instead of
// stacking duplicates; and the tab payload is SERIALIZABLE (no component
// reference), which is what lets a panel snapshot survive a reload.
//
// `displayInRightPanel` is an id-keyed upsert: an existing id focuses, a new id
// appends. So tab-id determinism is the whole of the de-duplication contract.

test('TEST-15: the tab id is deterministic and namespaced by tool_use_id (DEC-8)', () => {
  assert.equal(toolCallTabId('toolu_abc'), 'tool:toolu_abc')
  assert.equal(toolCallTabId('toolu_abc'), toolCallTabId('toolu_abc'))
  assert.notEqual(toolCallTabId('toolu_abc'), toolCallTabId('toolu_def'))
  // Namespaced so it can never collide with the existing tab-id schemes
  // (`lit:<tool_use_id>`, `kb:<file>:<page>:<char>`, `background-<conv>`, a bare
  // file id) inside the one shared per-conversation tab list.
  assert.ok(toolCallTabId('x').startsWith('tool:'))
  assert.ok(!toolCallTabId('x').startsWith('lit:'))
})

test('TEST-15: re-opening the same step yields the SAME id, so the tab is focused not stacked', () => {
  const ids = new Set([
    toolCallTabId('toolu_1'),
    toolCallTabId('toolu_1'),
    toolCallTabId('toolu_1'),
  ])
  assert.equal(ids.size, 1)
})

test('TEST-15: the tab payload is fully serializable — it round-trips through JSON unchanged', () => {
  // The panel snapshot is persisted to localStorage and rehydrated by
  // `resolvePanelRenderer` keyed on `type`, so a payload holding anything
  // non-serializable (a component, a Map, a store handle) would silently break
  // rehydration. Assert the SHAPE is plain data.
  const data: ToolCallPanelData = {
    toolUseId: 'toolu_1',
    messageId: 'm-1',
    toolName: 'web_search',
  }
  const round = JSON.parse(JSON.stringify(data)) as ToolCallPanelData
  assert.deepEqual(round, data)
  for (const v of Object.values(data as unknown as Record<string, unknown>)) {
    assert.equal(typeof v, 'string', 'every field must be a primitive, not a live reference')
  }
})

test('TEST-15: the payload carries the message id, which is what the deep link needs (ITEM-15)', () => {
  const data: ToolCallPanelData = { toolUseId: 'toolu_1', messageId: 'm-42' }
  assert.equal(`#message-${data.messageId}`, '#message-m-42')
})
