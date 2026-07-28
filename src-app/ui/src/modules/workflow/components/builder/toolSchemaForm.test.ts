import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SCHEMA_BUDGET,
  coerceToDeclared,
  describeToolSchema,
  isTemplateValue,
  splitArguments,
  valueToText,
} from './toolSchemaForm.ts'

// TEST-11..14 — turning an MCP tool's declared input schema into typed fields
// (INV-4), degrading honestly on a schema we cannot read (INV-6), and never
// destroying a `{{ … }}` reference (INV-5).

const richSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    limit: { type: 'integer', description: 'How many results', default: 10 },
    query: { type: 'string', title: 'Search terms', description: 'What to look for' },
    verbose: { type: 'boolean' },
    mode: { type: 'string', enum: ['fast', 'thorough'] },
    filters: { type: 'object' },
    tags: { type: 'array', items: { enum: ['a', 'b'] } },
  },
}

test('describeToolSchema derives a typed field per declared property', () => {
  const spec = describeToolSchema(richSchema)
  assert.ok(spec)
  const byName = Object.fromEntries(spec.fields.map(f => [f.name, f]))

  assert.equal(byName.query.kind, 'text')
  assert.equal(byName.query.required, true)
  assert.equal(byName.query.label, 'Search terms', 'schema `title` wins over the key')
  assert.equal(byName.query.description, 'What to look for')

  assert.equal(byName.limit.kind, 'integer')
  assert.equal(byName.limit.required, false)
  assert.equal(byName.limit.default, 10)

  assert.equal(byName.verbose.kind, 'switch')
  assert.equal(byName.mode.kind, 'select')
  assert.deepEqual(
    byName.mode.options?.map(o => o.value),
    ['fast', 'thorough'],
    'a closed value set is a picker, never a typed string',
  )
  assert.equal(byName.filters.kind, 'json')
  assert.equal(byName.tags.kind, 'multiselect')

  assert.equal(byName.limit.label, 'limit', 'no title ⇒ the key is the label')
  assert.equal(spec.fields[0].name, 'query', 'required properties sort first')
  assert.equal(spec.declaredCount, 6)
})

test('a $ref into the schema’s own $defs is resolved, not shown as opaque JSON', () => {
  const spec = describeToolSchema({
    type: 'object',
    required: ['mode'],
    $defs: { Mode: { type: 'string', enum: ['fast', 'slow'], title: 'Mode' } },
    properties: { mode: { $ref: '#/$defs/Mode' } },
  })
  assert.ok(spec)
  assert.equal(spec.fields[0].kind, 'select')
  assert.equal(spec.fields[0].label, 'Mode')
  assert.deepEqual(spec.fields[0].options?.map(o => o.value), ['fast', 'slow'])
})

test('a recursive $ref terminates and degrades to a JSON field', () => {
  const spec = describeToolSchema({
    type: 'object',
    $defs: { Node: { $ref: '#/$defs/Node' } },
    properties: { tree: { $ref: '#/$defs/Node' } },
  })
  assert.ok(spec)
  assert.equal(spec.fields[0].kind, 'json', 'a cycle is cut, not looped')
})

test('an unresolvable pointer degrades to JSON rather than pretending it is a string', () => {
  const spec = describeToolSchema({
    type: 'object',
    properties: { body: { $ref: '#/components/schemas/CreateThing' } },
  })
  assert.ok(spec)
  assert.equal(spec.fields[0].kind, 'json')
})

test('an unusable schema returns null so the caller renders the hand-entry fallback', () => {
  for (const bad of [
    undefined,
    null,
    'not a schema',
    42,
    [],
    {},
    { type: 'object' },
    { type: 'object', properties: {} },
    { type: 'object', properties: 'nonsense' },
  ]) {
    assert.equal(describeToolSchema(bad), null, `${JSON.stringify(bad)} must be null`)
  }
})

test('splitArguments preserves keys the schema does not declare', () => {
  const spec = describeToolSchema(richSchema)
  const { known, extra } = splitArguments(
    { query: 'crispr', limit: 5, legacy_flag: true, another: 'kept' },
    spec,
  )
  assert.deepEqual(known, { query: 'crispr', limit: 5 })
  assert.deepEqual(
    extra,
    { legacy_flag: true, another: 'kept' },
    'an argument the current schema omits must survive editing, not be dropped',
  )
})

test('with no schema every argument is an extra (nothing is lost)', () => {
  const { known, extra } = splitArguments({ a: 1, b: 'x' }, null)
  assert.deepEqual(known, {})
  assert.deepEqual(extra, { a: 1, b: 'x' })
})

test('a pathological schema spills past the budget instead of rendering unbounded fields', () => {
  const properties: Record<string, unknown> = {}
  const count = SCHEMA_BUDGET.maxFields + 7
  for (let i = 0; i < count; i += 1) properties[`p${i}`] = { type: 'string' }
  const spec = describeToolSchema({ type: 'object', properties })
  assert.ok(spec)
  assert.equal(spec.fields.length, SCHEMA_BUDGET.maxFields)
  assert.equal(spec.overflowNames.length, 7)
  assert.equal(spec.declaredCount, count)
  // The spilled ones are still reachable as extras, not silently dropped.
  const { extra } = splitArguments({ [`p${count - 1}`]: 'v' }, spec)
  assert.deepEqual(extra, { [`p${count - 1}`]: 'v' })
})

test('isTemplateValue recognises a reference in a value of any declared type', () => {
  assert.equal(isTemplateValue('{{ inputs.query }}'), true)
  assert.equal(isTemplateValue('prefix {{ agent_1.output }} suffix'), true)
  assert.equal(isTemplateValue('{{inputs.n}}'), true)
  assert.equal(isTemplateValue('plain text'), false)
  assert.equal(isTemplateValue(10), false)
  assert.equal(isTemplateValue(true), false)
  assert.equal(isTemplateValue(null), false)
})

test('coerceToDeclared types a literal but never destroys a reference', () => {
  const spec = describeToolSchema(richSchema)
  assert.ok(spec)
  const f = (name: string) => spec.fields.find(x => x.name === name)!

  assert.equal(coerceToDeclared('5', f('limit')), 5)
  assert.equal(coerceToDeclared('true', f('verbose')), true)
  assert.deepEqual(coerceToDeclared('{"a":1}', f('filters')), { a: 1 })

  // INV-5: the hard case — a reference in a NUMBER field survives verbatim.
  assert.equal(
    coerceToDeclared('{{ inputs.limit }}', f('limit')),
    '{{ inputs.limit }}',
    'coercing a reference to a number would destroy it',
  )

  // Uncoercible input is kept as typed, so the author sees what they wrote.
  assert.equal(coerceToDeclared('not a number', f('limit')), 'not a number')
  assert.deepEqual(coerceToDeclared('{ broken', f('filters')), '{ broken')
})

test('valueToText round-trips a value into editor text', () => {
  assert.equal(valueToText(undefined), '')
  assert.equal(valueToText(null), '')
  assert.equal(valueToText('a'), 'a')
  assert.equal(valueToText(10), '10')
  assert.equal(valueToText(true), 'true')
  assert.equal(valueToText({ a: 1 }), '{"a":1}')
})
