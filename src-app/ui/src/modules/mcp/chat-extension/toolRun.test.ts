import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveArtifactToolUseId } from './toolRun.ts'
import type { MessageContent } from '@/api-client/types'
import type { McpToolCall } from '@/modules/mcp/stores/mcpComposer'

const use = (id: string): MessageContent =>
  ({
    id: `blk-${id}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id },
  }) as unknown as MessageContent


const call = (
  id: string,
  status: McpToolCall['status'],
): McpToolCall => ({
  tool_use_id: id,
  server: 's',
  tool_name: 't',
  status,
})

// ── runToolUseIds ──────────────────────────────────────────────────────────
test('resolveArtifactToolUseId prefers the explicit event tool_use_id', () => {
  const contents = [use('A'), use('B')]
  const store = new Map<string, McpToolCall>()
  assert.equal(resolveArtifactToolUseId(contents, store, 'B'), 'B')
})

test('resolveArtifactToolUseId falls back to the sole tool_use when no event id', () => {
  const contents = [use('A')]
  const store = new Map<string, McpToolCall>()
  assert.equal(resolveArtifactToolUseId(contents, store, undefined), 'A')
})

test('resolveArtifactToolUseId disambiguates via a single in-flight store call', () => {
  const contents = [use('A'), use('B')]
  const store = new Map<string, McpToolCall>([
    ['A', call('A', 'completed')],
    ['B', call('B', 'started')],
  ])
  assert.equal(resolveArtifactToolUseId(contents, store, null), 'B')
})

test('resolveArtifactToolUseId returns null when parallel tools are ambiguous (never guesses last)', () => {
  const contents = [use('A'), use('B')]
  const store = new Map<string, McpToolCall>([
    ['A', call('A', 'started')],
    ['B', call('B', 'started')],
  ])
  assert.equal(resolveArtifactToolUseId(contents, store, undefined), null)
})

test('resolveArtifactToolUseId ignores an in-flight call NOT in this message (no cross-conversation capture)', () => {
  const contents = [use('A'), use('B')] // ambiguous within the message
  // The only in-flight store call belongs to a tool_use NOT in this message.
  const store = new Map<string, McpToolCall>([
    ['OTHER', call('OTHER', 'started')],
  ])
  assert.equal(resolveArtifactToolUseId(contents, store, undefined), null)
})
