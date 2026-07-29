import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext } from '@/modules/chat/components/rail/railTypes'
import {
  citationsRailContributions,
  describeActivity,
  verificationSummary,
} from './describeActivity.ts'

/**
 * TEST-27 [covers ITEM-19, ITEM-6] — all SIX citation tools yield a step, the
 * `verified/mismatch/not_found/unverified` outcomes surface in the detail
 * suffix, and every tool degrades to a name-only row without structuredContent.
 */

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

/** The six tools, as declared in `citations/tools.rs:116-121`. */
const SIX_TOOLS = [
  'lookup_citations',
  'add_citations',
  'verify_citations',
  'list_citations',
  'format_citations',
  'remove_citations',
]

const item = (verification_status: string) => ({
  input: 'x',
  entry_id: null,
  verification_status,
})

// ── the three batch/verification tools ─────────────────────────────────────
test('lookup_citations surfaces the verification outcomes in the detail suffix', () => {
  const step = describeActivity(
    ctxFor('lookup_citations', {
      results: [item('verified'), item('verified'), item('not_found')],
    }),
  )
  assert.ok(step)
  assert.equal(step.label, 'Looking up citations')
  assert.equal(step.detail, '3 items · 2 verified, 1 not found')
})

test('add_citations surfaces a mismatch outcome', () => {
  const step = describeActivity(
    ctxFor('add_citations', { results: [item('mismatch'), item('verified')] }),
  )
  assert.equal(step?.label, 'Adding citations')
  assert.equal(step?.detail, '2 items · 1 verified, 1 mismatch')
})

test('verify_citations surfaces the fabricated-citation (not_found) outcome', () => {
  const step = describeActivity(
    ctxFor('verify_citations', { results: [item('not_found')] }),
  )
  assert.equal(step?.label, 'Verifying citations')
  assert.equal(step?.detail, '1 item · 1 not found')
})

test('an identifier-less item rests at unverified and is reported as such', () => {
  const step = describeActivity(
    ctxFor('verify_citations', { results: [item('unverified')] }),
  )
  assert.equal(step?.detail, '1 item · 1 unverified')
})

test('verificationSummary reports the four outcomes in a stable order', () => {
  assert.equal(
    verificationSummary({
      results: [
        item('unverified'),
        item('not_found'),
        item('mismatch'),
        item('verified'),
      ],
    }),
    '4 items · 1 verified, 1 mismatch, 1 not found, 1 unverified',
  )
})

test('verificationSummary tolerates results with no verification_status', () => {
  assert.equal(
    verificationSummary({ results: [{ input: 'a' }, { input: 'b' }] }),
    '2 items',
  )
  assert.equal(verificationSummary(null), undefined)
  assert.equal(verificationSummary({ results: 'nope' }), undefined)
})

// ── the three non-batch tools ──────────────────────────────────────────────
test('list_citations reports the entry count', () => {
  const step = describeActivity(
    ctxFor('list_citations', { entries: [{}, {}, {}] }),
  )
  assert.equal(step?.label, 'Reading the bibliography')
  assert.equal(step?.detail, '3 citations')
})

test('format_citations reports the size of the output, never its contents', () => {
  const step = describeActivity(
    ctxFor('format_citations', { output: '@article{a,\n title={T}\n}' }),
  )
  assert.equal(step?.label, 'Formatting references')
  assert.equal(step?.detail, '3 lines')
  assert.ok(!step?.detail?.includes('@article'))
})

test('remove_citations reports how many were removed', () => {
  const step = describeActivity(ctxFor('remove_citations', { removed: 1 }))
  assert.equal(step?.label, 'Removing citations')
  assert.equal(step?.detail, '1 citation')
})

// ── coverage + ITEM-6 degradation ──────────────────────────────────────────
test('all six citation tools are claimed with domain language', () => {
  for (const name of SIX_TOOLS) {
    const step = describeActivity(
      ctxFor(name, { results: [], entries: [], removed: 0 }),
    )
    assert.ok(step, `${name} must be claimed`)
    assert.notEqual(
      step.label,
      name,
      `${name} must be renamed to domain language`,
    )
  }
})

test('every citation tool degrades to a name-only row without structuredContent', () => {
  for (const name of SIX_TOOLS) {
    const step = describeActivity(
      ctxFor(
        name,
        null,
        '3 item(s): 2 verified, 0 mismatch, 1 not found, 0 unverified.',
      ),
    )
    assert.ok(step, `${name} must still yield a row`)
    assert.notEqual(step.label, name)
    // The prose summary in the text channel is NOT parsed.
    assert.equal(step.detail, undefined, `${name} must have no invented detail`)
    assert.equal(step.key, 'T1')
    assert.equal(step.consumed, 2)
  }
})

test('an unknown tool is declined so the next contribution can claim it', () => {
  assert.equal(describeActivity(ctxFor('web_search', { results: [] })), null)
})

test('describeActivity never throws on a malformed structured payload', () => {
  for (const bad of [[], 'x', 3, { results: [null, 5, 'a'] }]) {
    const use = {
      id: 'u',
      content_type: 'tool_use',
      content: {
        type: 'tool_use',
        id: 'T1',
        name: 'add_citations',
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
  assert.equal(citationsRailContributions.length, 1)
  const c = citationsRailContributions[0]
  assert.deepEqual(c.contentTypes, ['tool_use'])
  assert.ok((c.order ?? 1000) < 1000)
  assert.equal(c.renderDetail, undefined)
})
