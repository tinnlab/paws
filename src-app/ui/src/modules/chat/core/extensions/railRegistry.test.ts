import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import { RailContributionRegistry } from '@/modules/chat/core/extensions/railRegistryCore'
import type {
  RailActivityContext,
  RailContribution,
} from '@/modules/chat/components/rail/railTypes'

// TEST-10 (ITEM-1): a contribution registers and resolves by content type; an
// unregistered type yields no contribution; registration is ADDITIVE and leaves
// content-renderer resolution untouched.

const block = (content_type: string, name = 'x'): MessageContent =>
  ({ id: 'b', content_type, content: { type: content_type, id: 't1', name } }) as unknown as MessageContent

const ctx = (content_type: string, name = 'x'): RailActivityContext => {
  const b = block(content_type, name)
  return { content: b, blocks: [b], index: 0 }
}

const contribution = (
  label: string,
  over: Partial<RailContribution> = {},
): RailContribution => ({
  contentTypes: ['tool_use'],
  describeActivity: () => ({ key: label, label, status: 'success', consumed: 1 }),
  ...over,
})

const always = () => true

test('TEST-10: a contribution registers and resolves by content type', () => {
  const r = new RailContributionRegistry()
  r.register('web-search', [contribution('Searching the web')], 100)
  assert.deepEqual(r.registeredTypes(), ['tool_use'])
  assert.equal(r.resolve(ctx('tool_use'), always)?.step.label, 'Searching the web')
})

test('TEST-10: an UNREGISTERED content type yields no contribution', () => {
  const r = new RailContributionRegistry()
  r.register('web-search', [contribution('Searching the web')], 100)
  assert.equal(r.resolve(ctx('text'), always), null)
  assert.equal(r.resolve(ctx('elicitation_request'), always), null)
  // …and an empty registry claims nothing at all.
  assert.equal(new RailContributionRegistry().resolve(ctx('tool_use'), always), null)
})

test('TEST-10: resolution is FIRST-WINS in `order`, so a generic fallback can sit last', () => {
  // This is the mechanism that lets each tool family own its own domain language
  // while mcp catches everything else at order 1000 — and it is why no module's
  // tool names need to live in a central map.
  const r = new RailContributionRegistry()
  r.register('mcp', [contribution('Tool Call', { order: 1000 })], 50)
  r.register('web-search', [contribution('Searching the web', { order: 40 })], 40)
  assert.equal(r.resolve(ctx('tool_use'), always)?.step.label, 'Searching the web')
})

test('TEST-10: a contribution that DECLINES (returns null) falls through to the next', () => {
  const r = new RailContributionRegistry()
  r.register('web-search', [
    { contentTypes: ['tool_use'], order: 10, describeActivity: () => null },
  ], 10)
  r.register('mcp', [contribution('Tool Call', { order: 1000 })], 50)
  assert.equal(r.resolve(ctx('tool_use'), always)?.step.label, 'Tool Call')
})

test('TEST-10: a THROWING contribution is skipped, and the next one still resolves', () => {
  const r = new RailContributionRegistry()
  r.register('broken', [
    {
      contentTypes: ['tool_use'],
      order: 10,
      describeActivity: () => {
        throw new Error('boom')
      },
    },
  ], 10)
  r.register('mcp', [contribution('Tool Call', { order: 1000 })], 50)
  const seen: string[] = []
  assert.equal(r.resolve(ctx('tool_use'), always, n => seen.push(n))?.step.label, 'Tool Call')
  assert.deepEqual(seen, ['broken'], 'the failure is reported, not swallowed silently')
})

test('TEST-10: a DISABLED extension contributes nothing', () => {
  const r = new RailContributionRegistry()
  r.register('web-search', [contribution('Searching the web', { order: 40 })], 40)
  r.register('mcp', [contribution('Tool Call', { order: 1000 })], 50)
  const enabled = (n: string) => n !== 'web-search'
  assert.equal(r.resolve(ctx('tool_use'), enabled)?.step.label, 'Tool Call')
})

test('TEST-10: unregister removes exactly one extension’s entries (HMR / teardown)', () => {
  const r = new RailContributionRegistry()
  r.register('web-search', [contribution('Searching the web', { order: 40 })], 40)
  r.register('mcp', [contribution('Tool Call', { order: 1000 })], 50)
  r.unregister('web-search')
  assert.equal(r.resolve(ctx('tool_use'), always)?.step.label, 'Tool Call')
  r.unregister('mcp')
  assert.deepEqual(r.registeredTypes(), [], 'the type is dropped once nothing claims it')
  assert.equal(r.resolve(ctx('tool_use'), always), null)
})

test('TEST-10: the resolved CONTRIBUTION is returned alongside the step', () => {
  // The caller renders the step's detail through the SAME contribution that
  // described it — that is what makes it impossible for a row's label and its
  // body to come from two different extensions.
  const r = new RailContributionRegistry()
  const c = contribution('Searching the web')
  r.register('web-search', [c], 40)
  assert.equal(r.resolve(ctx('tool_use'), always)?.contribution, c)
})

test('TEST-10: one contribution may claim SEVERAL content types', () => {
  const r = new RailContributionRegistry()
  r.register('mcp', [
    {
      contentTypes: ['tool_use', 'elicitation_request'],
      describeActivity: c => ({
        key: 'k',
        label: c.content.content_type,
        status: 'success',
        consumed: 1,
      }),
    },
  ], 50)
  assert.deepEqual(r.registeredTypes(), ['elicitation_request', 'tool_use'])
  assert.equal(r.resolve(ctx('elicitation_request'), always)?.step.label, 'elicitation_request')
})
