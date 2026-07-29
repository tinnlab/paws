import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import { segmentRail } from '@/modules/chat/components/rail/railSegmentation'
import { describeSchedulerSkip, skipMarkerOf } from './railContribution.ts'

/**
 * TEST-33 (ITEM-22) — the two policy SKIP markers.
 *
 * The backend stamps them onto a denial `tool_result`'s `structured_content` with
 * `is_error: Some(true)` (`server/src/modules/mcp/chat_extension/mcp.rs:3175-3178`
 * and `:3202-3205`). `is_error` makes the MODEL treat the call as failed — but
 * for the USER nothing ran, so the rail must show the NEUTRAL `cancelled`, never
 * `failed`. `failed` owns the red X exclusively (`chat/core/tool-status.ts`).
 */

const use = (id: string, name: string): MessageContent =>
  ({
    id: `blk-${id}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id, name, input: {}, server_id: 'srv' },
  }) as unknown as MessageContent

/** A denial result exactly as the backend builds it: `is_error: true` + marker. */
const denial = (
  useId: string,
  name: string,
  marker: 'admin_disabled' | 'unattended_denied',
): MessageContent =>
  ({
    id: `res-${useId}`,
    content_type: 'tool_result',
    content: {
      type: 'tool_result',
      tool_use_id: useId,
      name,
      content: `Tool '${name}' was skipped.`,
      is_error: true,
      structured_content: { [marker]: true, tool_name: name },
    },
  }) as unknown as MessageContent

const describe = (blocks: MessageContent[], index = 0) =>
  describeSchedulerSkip({ content: blocks[index], blocks, index })

// ── the core assertion: cancelled, never failed ─────────────────────────────

test('unattended_denied renders as cancelled, never failed', () => {
  const blocks = [use('u1', 'web_search'), denial('u1', 'web_search', 'unattended_denied')]
  const step = describe(blocks)
  assert.ok(step)
  assert.equal(step.status, 'cancelled')
  assert.notEqual(step.status, 'failed')
  assert.equal(step.label, 'Skipped: needs approval, and this run is unattended')
  assert.equal(step.detail, 'Web Search')
})

test('admin_disabled renders as cancelled, never failed', () => {
  const blocks = [use('u1', 'execute_command'), denial('u1', 'execute_command', 'admin_disabled')]
  const step = describe(blocks)
  assert.ok(step)
  assert.equal(step.status, 'cancelled')
  assert.notEqual(step.status, 'failed')
  assert.equal(step.label, 'Skipped: disabled by the administrator')
  assert.equal(step.detail, 'Execute Command')
})

test('the is_error:true the backend sets does NOT leak through as a failure', () => {
  // This is the whole point: the marker overrides `is_error` for the user-facing
  // status. Both markers, both anchors, always cancelled.
  for (const marker of ['unattended_denied', 'admin_disabled'] as const) {
    const blocks = [use('u1', 'grep_files'), denial('u1', 'grep_files', marker)]
    assert.equal(describe(blocks)?.status, 'cancelled')
    // ...and when only the orphaned result reaches the transcript.
    const orphan = [denial('u1', 'grep_files', marker)]
    assert.equal(describe(orphan)?.status, 'cancelled')
  }
})

// ── claiming discipline ─────────────────────────────────────────────────────

test('an ordinary tool call is declined so its own family can describe it', () => {
  const blocks = [
    use('u1', 'web_search'),
    {
      id: 'res-u1',
      content_type: 'tool_result',
      content: {
        type: 'tool_result',
        tool_use_id: 'u1',
        name: 'web_search',
        content: 'ok',
        is_error: false,
        structured_content: { results: [] },
      },
    } as unknown as MessageContent,
  ]
  assert.equal(describe(blocks), null)
  assert.equal(skipMarkerOf({ content: blocks[0], blocks, index: 0 }), null)
})

test('a genuinely FAILED tool call is not claimed (it stays failed)', () => {
  const blocks = [
    use('u1', 'web_search'),
    {
      id: 'res-u1',
      content_type: 'tool_result',
      content: {
        type: 'tool_result',
        tool_use_id: 'u1',
        name: 'web_search',
        content: 'boom',
        is_error: true,
      },
    } as unknown as MessageContent,
  ]
  assert.equal(describe(blocks), null, 'a real error must not be laundered into a skip')
})

test('a skip is a row, not a breakout — it asks the user for nothing', () => {
  const blocks = [use('u1', 'web_search'), denial('u1', 'web_search', 'unattended_denied')]
  assert.equal(describe(blocks)?.blocking, false)
  const segments = segmentRail(blocks, describeSchedulerSkip)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].kind, 'span')
})

test('the step owns BOTH blocks of the pair — the denial never leaks as prose', () => {
  const blocks = [use('u1', 'web_search'), denial('u1', 'web_search', 'admin_disabled')]
  const segments = segmentRail(blocks, describeSchedulerSkip)
  const steps = segments.flatMap(s => (s.kind === 'span' ? s.steps : []))
  assert.equal(steps.length, 1)
  assert.equal(steps[0].step.consumed, 2)
})

test('a marker whose tool_name was lost still yields a labelled row', () => {
  const blocks = [
    use('u1', 'web_search'),
    {
      id: 'res-u1',
      content_type: 'tool_result',
      content: {
        type: 'tool_result',
        tool_use_id: 'u1',
        content: 'skipped',
        is_error: true,
        structured_content: { unattended_denied: true },
      },
    } as unknown as MessageContent,
  ]
  const step = describe(blocks)
  assert.ok(step)
  assert.equal(step.status, 'cancelled')
  // Falls back to the block's own tool name.
  assert.equal(step.detail, 'Web Search')
})
