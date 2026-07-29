import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import { mcpRailContributions } from './railContribution.ts'

// TEST-24 (ITEM-18) — the mcp extension's GENERIC fallback contribution.
//
// It is the one every unclaimed tool lands on, so two things matter and both are
// asserted here: that it claims anything, and that it deliberately sits LAST.

const [generic, elicitation] = mcpRailContributions

const use = (name: string, id = 't1'): MessageContent =>
  ({
    id: `blk-${id}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id, name, input: { q: 1 }, server_id: 's' },
  }) as unknown as MessageContent

const ctxOf = (blocks: MessageContent[], index = 0) => ({
  content: blocks[index],
  blocks,
  index,
})

test('TEST-24: the generic contribution registers LAST, so every tool family outranks it', () => {
  // The whole first-wins design rests on this constant: a domain contribution at
  // order 40 must get to claim its own tools before mcp title-cases the raw id.
  assert.equal(generic.order, 1000)
  assert.deepEqual(generic.contentTypes, ['tool_use'])
})

test('TEST-24: it claims ANY tool and degrades to a readable title-cased name', () => {
  const step = generic.describeActivity(ctxOf([use('fetch_paper_fulltext')]))
  assert.ok(step)
  assert.equal(step?.label, 'Fetch Paper Fulltext')
  assert.equal(step?.status, 'running')
  assert.equal(step?.blocking, false)
})

test('TEST-24: no structured_content is the ORDINARY case and still yields a row (ITEM-6)', () => {
  const step = generic.describeActivity(ctxOf([use('some_unknown_tool')]))
  assert.ok(step)
  assert.ok((step?.label.length ?? 0) > 0)
})

test('TEST-24: it declines a block that is not a tool step at all', () => {
  const text = { id: 'b', content_type: 'text', content: {} } as unknown as MessageContent
  assert.equal(generic.describeActivity(ctxOf([text])), null)
})

test('TEST-24: it supplies NO renderDetail — the core body is what redacts', () => {
  // Redaction has to be a property of the delegation, not an opt-in of one
  // contribution: every domain contribution pre-empts this one, so a body that
  // only THIS entry supplied would never run for the families most likely to
  // carry a credential.
  assert.equal(generic.renderDetail, undefined)
})

test('TEST-24: an elicitation is a BLOCKING step (INV-3)', () => {
  const block = {
    id: 'e',
    content_type: 'elicitation_request',
    content: { type: 'elicitation_request', elicitation_id: 'e1', message: 'Pick a file' },
  } as unknown as MessageContent
  const step = elicitation.describeActivity(ctxOf([block]))
  assert.equal(step?.blocking, true)
  assert.equal(step?.status, 'pending-approval')
  assert.equal(step?.key, 'e1')
  assert.equal(step?.label, 'Pick a file')
})

test('TEST-24: an elicitation with no message still gets a usable label', () => {
  const block = {
    id: 'e',
    content_type: 'elicitation_request',
    content: { type: 'elicitation_request', elicitation_id: 'e2', message: '   ' },
  } as unknown as MessageContent
  const step = elicitation.describeActivity(ctxOf([block]))
  assert.ok(step && step.label.trim().length > 0)
})
