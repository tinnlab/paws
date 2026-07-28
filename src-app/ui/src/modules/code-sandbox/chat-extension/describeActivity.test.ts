import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext } from '@/modules/chat/components/rail/railTypes'
import {
  codeSandboxRailContributions,
  describeActivity,
  formatDurationMs,
} from './describeActivity.ts'

/**
 * TEST-26 [covers ITEM-19, ITEM-6, ITEM-9] — `execute_command` reports exit code
 * and duration, `timed_out: true` maps to `timeout` (NOT `failed`), the five
 * file tools describe themselves, and all of them degrade to a name-only row.
 */

function ctxFor(
  name: string,
  structured: Record<string, unknown> | null,
  input: Record<string, unknown> = {},
): RailActivityContext {
  const use = {
    id: 'blk-u',
    content_type: 'tool_use',
    content: { type: 'tool_use', id: 'T1', name, input, server_id: 'S1' },
  } as unknown as MessageContent
  const res = {
    id: 'blk-r',
    content_type: 'tool_result',
    content: {
      type: 'tool_result',
      tool_use_id: 'T1',
      name,
      content: '',
      // The sandbox returns `isError:false` even for a timed-out run
      // (`code_sandbox/handlers.rs:311`), which is exactly why the timeout
      // override below is load-bearing.
      is_error: false,
      ...(structured ? { structured_content: structured } : {}),
    },
  } as unknown as MessageContent
  return { content: use, blocks: [use, res], index: 0 }
}

const EXEC_OK = {
  stdout: 'hi\n',
  stderr: '',
  exit_code: 0,
  timed_out: false,
  duration_ms: 1234,
  stdout_truncated: false,
  stderr_truncated: false,
  flavor: 'minimal',
}

// ── execute_command ────────────────────────────────────────────────────────
test('execute_command reports exit code and duration from structuredContent', () => {
  const step = describeActivity(ctxFor('execute_command', EXEC_OK))
  assert.ok(step)
  assert.equal(step.label, 'Running a command')
  assert.equal(step.detail, 'exit 0 · 1.2s · minimal')
  assert.equal(step.status, 'success')
  assert.equal(step.durationMs, 1234)
})

test('execute_command surfaces a non-zero exit code without calling it failed', () => {
  const step = describeActivity(
    ctxFor('execute_command', { ...EXEC_OK, exit_code: 1, duration_ms: 400 }),
  )
  assert.ok(step)
  assert.match(step.detail ?? '', /exit 1/)
  assert.match(step.detail ?? '', /400ms/)
  // A command exiting 1 is a routine agentic outcome; `failed` force-opens the
  // rail (ITEM-9) and is reserved for a real tool error.
  assert.equal(step.status, 'success')
})

test('timed_out: true maps to the timeout status, NOT failed', () => {
  const step = describeActivity(
    ctxFor('execute_command', {
      ...EXEC_OK,
      exit_code: 124,
      timed_out: true,
      duration_ms: 30_000,
    }),
  )
  assert.ok(step)
  assert.equal(step.status, 'timeout')
  assert.notEqual(step.status, 'failed')
  assert.equal(step.detail, 'timed out · 30.0s · minimal')
})

test('timed_out: false leaves the block-derived status alone', () => {
  const step = describeActivity(
    ctxFor('execute_command', { ...EXEC_OK, timed_out: false }),
  )
  assert.equal(step?.status, 'success')
})

// ── the five file tools ────────────────────────────────────────────────────
test('read_file reports the file name and line count', () => {
  const step = describeActivity(
    ctxFor(
      'read_file',
      { text: '1: a\n', total_lines: 42 },
      { filename: 'main.py' },
    ),
  )
  assert.ok(step)
  assert.equal(step.label, 'Reading a file')
  assert.equal(step.detail, 'main.py · 42 lines')
})

test('write_file reports the file name and bytes written', () => {
  const step = describeActivity(
    ctxFor(
      'write_file',
      { success: true, bytes_written: 1 },
      { filename: 'out.txt' },
    ),
  )
  assert.equal(step?.label, 'Writing a file')
  assert.equal(step?.detail, 'out.txt · 1 byte')
})

test('edit_file reports the file name and a saved marker', () => {
  const step = describeActivity(
    ctxFor('edit_file', { success: true }, { filename: 'main.py' }),
  )
  assert.equal(step?.label, 'Editing a file')
  assert.equal(step?.detail, 'main.py · saved')
})

test('list_files reports the file count', () => {
  const step = describeActivity(
    ctxFor('list_files', { files: [{ name: 'a' }, { name: 'b' }] }),
  )
  assert.equal(step?.label, 'Listing workspace files')
  assert.equal(step?.detail, '2 files')
})

test('get_resource_link reports the artifact name', () => {
  const step = describeActivity(
    ctxFor(
      'get_resource_link',
      {
        type: 'resource_link',
        uri: 'ziee://x',
        name: 'chart.png',
        is_saved: false,
      },
      { filename: 'chart.png' },
    ),
  )
  assert.equal(step?.label, 'Attaching a workspace file')
  assert.equal(step?.detail, 'chart.png')
})

test('list_sandbox_environments reports the environment count', () => {
  const step = describeActivity(
    ctxFor('list_sandbox_environments', { available: [{ flavor: 'minimal' }] }),
  )
  assert.equal(step?.label, 'Listing sandbox environments')
  assert.equal(step?.detail, '1 environment')
})

// ── ITEM-6 degradation + declining ─────────────────────────────────────────
test('every sandbox tool degrades to a name-only row without structuredContent', () => {
  const tools = [
    'execute_command',
    'read_file',
    'write_file',
    'edit_file',
    'list_files',
    'get_resource_link',
    'list_sandbox_environments',
  ]
  for (const name of tools) {
    const step = describeActivity(ctxFor(name, null))
    assert.ok(step, `${name} must still yield a row`)
    assert.notEqual(
      step.label,
      name,
      `${name} must still be renamed to domain language`,
    )
    assert.equal(step.detail, undefined, `${name} must have no invented detail`)
    assert.equal(step.status, 'success')
    assert.equal(step.key, 'T1')
  }
})

test('a dropped payload cannot silently downgrade a timeout to success — it just says nothing', () => {
  const step = describeActivity(ctxFor('execute_command', null))
  assert.ok(step)
  assert.equal(step.detail, undefined)
})

test('an unknown tool is declined so the next contribution can claim it', () => {
  assert.equal(describeActivity(ctxFor('web_search', { results: [] })), null)
})

test('describeActivity never throws on a malformed structured payload', () => {
  for (const bad of [[], 'x', 7, { exit_code: 'nope', duration_ms: 'nope' }]) {
    const use = {
      id: 'u',
      content_type: 'tool_use',
      content: {
        type: 'tool_use',
        id: 'T1',
        name: 'execute_command',
        input: null,
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

// ── helper ─────────────────────────────────────────────────────────────────
test('formatDurationMs is human-scale at every magnitude', () => {
  assert.equal(formatDurationMs(0), '0ms')
  assert.equal(formatDurationMs(950), '950ms')
  assert.equal(formatDurationMs(1234), '1.2s')
  assert.equal(formatDurationMs(65_000), '1m 5s')
  assert.equal(formatDurationMs(Number.NaN), '')
})

// ── registration shape ─────────────────────────────────────────────────────
test('the contribution claims tool_use and outranks the generic fallback', () => {
  assert.equal(codeSandboxRailContributions.length, 1)
  const c = codeSandboxRailContributions[0]
  assert.deepEqual(c.contentTypes, ['tool_use'])
  assert.ok((c.order ?? 1000) < 1000)
  assert.equal(c.renderDetail, undefined)
})
