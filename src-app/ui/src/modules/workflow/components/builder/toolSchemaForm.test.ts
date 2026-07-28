import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SCHEMA_BUDGET,
  coerceToDeclared,
  describeToolSchema,
  isTemplateValue,
  isWholeTemplateValue,
  optionKeyForValue,
  optionKeysForValues,
  optionValueForKey,
  optionValuesForKeys,
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

test('a $ref’s OWN sibling keywords survive the resolution', () => {
  // JSON Schema 2020-12 allows keywords beside `$ref`, and generators use them
  // to specialise a shared definition per use site. Discarding them lost the
  // per-field title / description / default entirely.
  const spec = describeToolSchema({
    type: 'object',
    $defs: { Color: { type: 'string', enum: ['red', 'blue'], title: 'Colour' } },
    properties: {
      line: {
        $ref: '#/$defs/Color',
        title: 'Line colour',
        description: 'Stroke colour of the plotted line',
        default: 'red',
      },
    },
  })
  assert.ok(spec)
  const [line] = spec.fields
  assert.equal(line.kind, 'select', 'the resolved enum still drives the control')
  assert.equal(line.label, 'Line colour', 'the referencing node’s title wins')
  assert.equal(line.description, 'Stroke colour of the plotted line')
  assert.equal(line.default, 'red')
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

test('a $defs pointer resolves only an OWN definition, never an inherited one', () => {
  // `name in bucket` walked the prototype chain, so a definition the schema
  // never declared could satisfy a `$ref`. An inherited member is the shape that
  // makes that observable (`#/$defs/__proto__` reached `Object.prototype`, which
  // happens to carry no schema keywords, so it degraded to JSON by luck).
  const defs: Record<string, unknown> = Object.create({
    Injected: { type: 'string', enum: ['pwned'] },
  })
  defs.Real = { type: 'string', enum: ['a'] }

  const inherited = describeToolSchema({
    type: 'object',
    $defs: defs,
    properties: { x: { $ref: '#/$defs/Injected' } },
  })
  assert.ok(inherited)
  assert.equal(
    inherited.fields[0].kind,
    'json',
    'an inherited definition must NOT satisfy a $ref',
  )

  // The own definition beside it still resolves, so the guard is not a blanket
  // "stop resolving".
  const own = describeToolSchema({
    type: 'object',
    $defs: defs,
    properties: { x: { $ref: '#/$defs/Real' } },
  })
  assert.ok(own)
  assert.equal(own.fields[0].kind, 'select')

  for (const evil of ['#/$defs/__proto__', '#/$defs/toString', '#/definitions/constructor']) {
    const spec = describeToolSchema({
      type: 'object',
      $defs: { Real: { type: 'string' } },
      definitions: { Real: { type: 'string' } },
      properties: { hacked: { $ref: evil } },
    })
    assert.ok(spec)
    assert.equal(spec.fields[0].kind, 'json', `${evil} must NOT resolve`)
  }
})

test('both nullable spellings unwrap to the declared type', () => {
  // `Optional[str]` reaches us as an anyOf pair from FastMCP/pydantic v2, and as
  // a type-array from a hand-written schema. Neither used to be understood, so
  // an optional string rendered as a raw JSON textarea.
  const spec = describeToolSchema({
    type: 'object',
    properties: {
      note: { type: ['string', 'null'], description: 'Free text' },
      title: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Title' },
      count: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: 3 },
      flag: { oneOf: [{ type: 'null' }, { type: 'boolean' }] },
      level: { anyOf: [{ type: 'string', enum: ['low', 'high'] }, { type: 'null' }] },
      either: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
    },
  })
  assert.ok(spec)
  const byName = Object.fromEntries(spec.fields.map(f => [f.name, f]))
  assert.equal(byName.note.kind, 'text')
  assert.equal(byName.note.description, 'Free text', 'siblings survive the unwrap')
  assert.equal(byName.title.kind, 'text')
  assert.equal(byName.title.label, 'Title')
  assert.equal(byName.count.kind, 'integer')
  assert.equal(byName.count.default, 3)
  assert.equal(byName.flag.kind, 'switch')
  assert.equal(byName.level.kind, 'select')
  assert.deepEqual(byName.level.options?.map(o => o.value), ['low', 'high'])
  assert.equal(
    byName.either.kind,
    'json',
    'a genuine multi-type union is NOT a single declared type — JSON is honest',
  )
})

test('a single-branch allOf (pydantic v1) is merged, not ignored', () => {
  const spec = describeToolSchema({
    type: 'object',
    $defs: { Mode: { type: 'string', enum: ['fast', 'slow'] } },
    properties: {
      mode: { allOf: [{ $ref: '#/$defs/Mode' }], default: 'fast', title: 'Mode' },
    },
  })
  assert.ok(spec)
  assert.equal(spec.fields[0].kind, 'select')
  assert.equal(spec.fields[0].label, 'Mode')
  assert.equal(spec.fields[0].default, 'fast')
})

test('a root-level $ref still yields generated fields', () => {
  const spec = describeToolSchema({
    $ref: '#/$defs/SearchArgs',
    $defs: {
      SearchArgs: {
        type: 'object',
        required: ['query'],
        properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      },
    },
  })
  assert.ok(spec, 'a $ref root must not collapse the whole tool to hand-typed pairs')
  assert.deepEqual(spec.fields.map(f => f.name), ['query', 'limit'])
  assert.equal(spec.fields[0].required, true)
})

test('the textarea promotion keys off the declared VALUE length, not the prose', () => {
  const spec = describeToolSchema({
    type: 'object',
    properties: {
      name: {
        type: 'string',
        maxLength: 40,
        description: 'x'.repeat(400),
      },
      body: { type: 'string', maxLength: 4000 },
    },
  })
  assert.ok(spec)
  const byName = Object.fromEntries(spec.fields.map(f => [f.name, f]))
  assert.equal(
    byName.name.kind,
    'text',
    'a 40-character value is a one-line field however long its description is',
  )
  assert.equal(byName.body.kind, 'textarea')
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
  // The spilled ones are NAMED, so the author can type the key they need
  // instead of guessing which properties were hidden.
  assert.deepEqual(spec.overflowNames, [
    'p24', 'p25', 'p26', 'p27', 'p28', 'p29', 'p30',
  ])
  // …and are still reachable as extras, not silently dropped.
  const { extra } = splitArguments({ [`p${count - 1}`]: 'v' }, spec)
  assert.deepEqual(extra, { [`p${count - 1}`]: 'v' })
})

// ---------------------------------------------------------------------------
// Enum values keep their DECLARED type
// ---------------------------------------------------------------------------

test('a non-string enum round-trips as its declared type, not as a string', () => {
  // Stringifying the option value with `String(v)` silently committed `"2"`
  // where `integer` was declared, and a saved `{"page": 2}` rendered unselected
  // because the control's string value never matched the stored number.
  const spec = describeToolSchema({
    type: 'object',
    properties: {
      level: { type: 'integer', enum: [1, 2, 3] },
      ratio: { type: 'number', enum: [0.5, 1.5] },
      strict: { type: 'boolean', enum: [true, false] },
      sizes: { type: 'array', items: { enum: [10, 20, 30] } },
    },
  })
  assert.ok(spec)
  const byName = Object.fromEntries(spec.fields.map(f => [f.name, f]))

  assert.equal(byName.level.kind, 'select')
  assert.deepEqual(byName.level.options?.map(o => o.value), ['1', '2', '3'])
  assert.deepEqual(byName.level.options?.map(o => o.raw), [1, 2, 3])

  // Commit: the control hands back a string key; the DECLARED value is stored.
  assert.strictEqual(optionValueForKey(byName.level, '2'), 2)
  assert.strictEqual(optionValueForKey(byName.ratio, '0.5'), 0.5)
  assert.strictEqual(optionValueForKey(byName.strict, 'true'), true)

  // Load: a stored declared value selects its option.
  assert.equal(optionKeyForValue(byName.level, 2), '2')
  assert.equal(optionKeyForValue(byName.ratio, 1.5), '1.5')
  assert.equal(optionKeyForValue(byName.strict, false), 'false')

  // Multi-select does the same in both directions.
  assert.deepEqual(optionValuesForKeys(byName.sizes, ['10', '30']), [10, 30])
  assert.deepEqual(optionKeysForValues(byName.sizes, [20, 30]), ['20', '30'])
})

test('a value stored by an older build as a string still selects its option', () => {
  const spec = describeToolSchema({
    type: 'object',
    properties: { level: { type: 'integer', enum: [1, 2, 3] } },
  })
  assert.ok(spec)
  const level = spec.fields[0]
  assert.equal(
    optionKeyForValue(level, '2'),
    '2',
    'a legacy stringified value must not read as "nothing selected"',
  )
  assert.equal(optionKeyForValue(level, 9), undefined, 'an unknown value selects nothing')
  assert.equal(optionKeyForValue(level, undefined), undefined)
  assert.deepEqual(
    optionKeysForValues(level, [2, 99]),
    ['2'],
    'an unmatched entry is dropped rather than rendered as a phantom chip',
  )
})

test('string enums are untouched by the mapping (the common case stays trivial)', () => {
  const spec = describeToolSchema(richSchema)
  assert.ok(spec)
  const mode = spec.fields.find(f => f.name === 'mode')!
  assert.equal(optionValueForKey(mode, 'fast'), 'fast')
  assert.equal(optionKeyForValue(mode, 'thorough'), 'thorough')
})

// ---------------------------------------------------------------------------
// Templating (INV-5)
// ---------------------------------------------------------------------------

test('isTemplateValue recognises a reference in a value of any declared type', () => {
  assert.equal(isTemplateValue('{{ inputs.query }}'), true)
  assert.equal(isTemplateValue('prefix {{ agent_1.output }} suffix'), true)
  assert.equal(isTemplateValue('{{inputs.n}}'), true)
  assert.equal(isTemplateValue('plain text'), false)
  assert.equal(isTemplateValue(10), false)
  assert.equal(isTemplateValue(true), false)
  assert.equal(isTemplateValue(null), false)
})

test('isWholeTemplateValue matches the backend’s whole-value rule exactly', () => {
  // `dispatch.rs::render_tool_arguments`: trimmed, starts `{{`, ends `}}`, and
  // exactly one `{{`. Only that shape resolves to a NATIVE JSON type.
  assert.equal(isWholeTemplateValue('{{ inputs.query }}'), true)
  assert.equal(isWholeTemplateValue('  {{ inputs.query }}  '), true)
  assert.equal(isWholeTemplateValue('prefix {{ inputs.q }}'), false)
  assert.equal(isWholeTemplateValue('{{ a }} and {{ b }}'), false)
  assert.equal(isWholeTemplateValue('{"userId": "{{ inputs.user }}"}'), false)
  assert.equal(isWholeTemplateValue('plain'), false)
  assert.equal(isWholeTemplateValue(10), false)
})

test('coerceToDeclared parses a json field that merely CONTAINS a reference', () => {
  // The natural way to author a structured argument is to put the reference
  // inside the JSON. Treating "contains a reference" as "pass the whole thing
  // through as a string" stored `{"userId": "{{ inputs.user }}"}` as a STRING —
  // and the backend, which recurses into objects and interpolates nested
  // strings, then received a string where the tool declared an object.
  const spec = describeToolSchema(richSchema)
  assert.ok(spec)
  const filters = spec.fields.find(f => f.name === 'filters')!
  assert.equal(filters.kind, 'json')

  assert.deepEqual(coerceToDeclared('{"userId": "{{ inputs.user }}"}', filters), {
    userId: '{{ inputs.user }}',
  })
  assert.deepEqual(
    coerceToDeclared('[1, "{{ inputs.a }}"]', filters),
    [1, '{{ inputs.a }}'],
  )
  assert.deepEqual(coerceToDeclared('{"a":1}', filters), { a: 1 })

  // A WHOLE-value reference is still passed through verbatim: the backend
  // resolves it to a native object at run time.
  assert.equal(
    coerceToDeclared('{{ inputs.filters }}', filters),
    '{{ inputs.filters }}',
    'a whole-value reference must survive untouched',
  )

  // Uncoercible input is kept as typed, so the author sees what they wrote.
  assert.deepEqual(coerceToDeclared('{ broken', filters), '{ broken')
  assert.equal(coerceToDeclared('   ', filters), '')
})

test('coerceToDeclared leaves a text-edited string field alone', () => {
  // SCOPE CHANGE (was: this test exercised `integer`/`switch`/`multiselect`
  // arms). Those arms were unreachable — `coerceToDeclared` has exactly one
  // caller, the `textarea | json` control — and testing them made the function
  // look correct while the LIVE enum path stringified its values. The typed
  // controls now commit their declared type directly (see the enum tests
  // above), and this asserts the real, reachable contract.
  const spec = describeToolSchema({
    type: 'object',
    properties: {
      note: { type: 'string' },
      body: { type: 'string', maxLength: 4000 },
    },
  })
  assert.ok(spec)
  const byName = Object.fromEntries(spec.fields.map(f => [f.name, f]))
  assert.equal(byName.body.kind, 'textarea')

  // A textarea holds TEXT: `1234` is the string the author typed, and must not
  // be silently turned into a number for a field declared `string`.
  assert.strictEqual(coerceToDeclared('1234', byName.body), '1234')
  assert.strictEqual(coerceToDeclared('true', byName.body), 'true')
  assert.strictEqual(coerceToDeclared('{"a":1}', byName.body), '{"a":1}')
  assert.strictEqual(
    coerceToDeclared('{{ inputs.body }}', byName.body),
    '{{ inputs.body }}',
  )
  assert.strictEqual(coerceToDeclared('', byName.body), '')
})

test('valueToText round-trips a value into editor text', () => {
  assert.equal(valueToText(undefined), '')
  assert.equal(valueToText(null), '')
  assert.equal(valueToText('a'), 'a')
  assert.equal(valueToText(10), '10')
  assert.equal(valueToText(true), 'true')
  assert.equal(valueToText({ a: 1 }), '{"a":1}')
})
