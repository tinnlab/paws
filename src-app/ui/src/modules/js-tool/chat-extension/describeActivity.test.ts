import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import { runJsStep, runJsApprovalStep } from './railContribution.ts'

// TEST-31 (ITEM-20) — the js-tool family. These contributions shipped with no
// unit coverage at all; the audit caught it.

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

test('TEST-31: run_js yields a domain-language step, not a raw tool id', () => {
  const step = runJsStep.describeActivity(ctxOf([use('run_js'), result('t1')]))
  assert.ok(step)
  assert.equal(step?.label, 'Running a script')
  assert.equal(step?.status, 'success')
})

test('TEST-31: it DECLINES another module’s tool, so first-wins stays honest', () => {
  assert.equal(runJsStep.describeActivity(ctxOf([use('web_search')])), null)
  assert.equal(runJsStep.describeActivity(ctxOf([use('execute_command')])), null)
})

test('TEST-31: no structured_content degrades to a name-only row (ITEM-6)', () => {
  const step = runJsStep.describeActivity(ctxOf([use('run_js'), result('t1')]))
  assert.ok(step)
  assert.equal(step?.detail, undefined)
})

test('TEST-31: it registers ahead of mcp’s generic fallback', () => {
  assert.ok((runJsStep.order ?? 100) < 1000)
})

test('TEST-31: a suspended-script approval is a BLOCKING step (INV-3)', () => {
  const block = {
    id: 'a',
    content_type: 'run_js_approval',
    content: { elicitation_id: 'e1', tool_name: 'read_file', server: 'files' },
  } as unknown as MessageContent
  const step = runJsApprovalStep.describeActivity(ctxOf([block]))
  assert.equal(step?.blocking, true)
  assert.equal(step?.status, 'pending-approval')
  assert.equal(step?.key, 'e1')
  assert.match(step?.label ?? '', /read_file/)
})

test('TEST-31: an approval with no tool name still gets a usable label', () => {
  const block = {
    id: 'a',
    content_type: 'run_js_approval',
    content: { elicitation_id: 'e2' },
  } as unknown as MessageContent
  const step = runJsApprovalStep.describeActivity(ctxOf([block]))
  assert.ok(step && step.label.trim().length > 0)
  assert.equal(step?.blocking, true)
})
