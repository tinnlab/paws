import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  STEP_KINDS,
  type StepKind,
  buildStepZodSchema,
  configErrors,
  createStep,
} from './stepForms.ts'

// TEST-13 — the per-kind zod-schema builder / `createStep` / `configErrors`.
// Pure logic: for every StepConfig kind, `createStep` yields a valid default,
// the schema rejects out-of-range / missing-required fields, and the removed
// tools picker regression is guarded (llm / llm_map set no non-empty `tools`).

test('createStep yields a schema-VALID default for every kind', () => {
  for (const kind of STEP_KINDS) {
    const step = createStep(kind, [])
    assert.equal(step.kind, kind, `kind tag preserved for ${kind}`)
    // A brand-new step should still fail required-text validation (empty prompt/
    // run/message/server) but NOT fail on any numeric/range/enum default — the
    // number + enum defaults are always in range. So: the ONLY error keys, if
    // any, are the required-text fields, never a numeric/enum default.
    const errs = configErrors(step)
    const numericOrEnumKeys = [
      'max_steps',
      'max_parallel',
      'max_retries',
      'timeout_ms',
      'output_format',
    ]
    for (const k of numericOrEnumKeys) {
      assert.ok(
        !(k in errs),
        `${kind}: default must satisfy ${k} (got error: ${errs[k]})`,
      )
    }
  }
})

test('createStep gives a fully-valid step once required text is filled', () => {
  // Fill each kind's required text fields and assert zero config errors — proves
  // the defaults for the non-text fields are all in range.
  const filled: Record<StepKind, Record<string, unknown>> = {
    agent: { prompt: 'do the thing' },
    llm: { prompt: 'answer this' },
    llm_map: { prompt: 'p', for_each: '{{ inputs.list }}', item_var: 'item' },
    sandbox: { run: 'echo hi' },
    elicit: { message: 'your name?' },
    tool: { server: 'web', tool: 'web_search' },
  }
  for (const kind of STEP_KINDS) {
    const step = { ...createStep(kind, []), ...filled[kind] } as never
    assert.deepEqual(
      configErrors(step),
      {},
      `${kind}: a required-fields-filled default must be fully valid`,
    )
  }
})

test('unique step ids: createStep avoids collisions with existing ids', () => {
  const a = createStep('llm', [])
  const b = createStep('llm', [a.id])
  assert.equal(a.id, 'llm_1')
  assert.equal(b.id, 'llm_2')
  assert.notEqual(a.id, b.id)
})

test('schema rejects a MISSING required field (empty prompt)', () => {
  const step = createStep('llm', []) // prompt: ''
  const errs = configErrors(step)
  assert.ok('prompt' in errs, 'empty prompt must be flagged')
})

test('schema rejects an OUT-OF-RANGE numeric field', () => {
  // agent max_steps must be >= 1.
  const agent = { ...createStep('agent', []), prompt: 'x', max_steps: 0 } as never
  assert.ok('max_steps' in configErrors(agent), 'max_steps 0 must fail min(1)')

  // llm_map max_parallel is capped at the hard cap (20).
  const map = {
    ...createStep('llm_map', []),
    prompt: 'p',
    for_each: 'l',
    item_var: 'i',
    max_parallel: 999,
  } as never
  assert.ok('max_parallel' in configErrors(map), 'max_parallel 999 must fail max cap')

  // llm_map max_retries cannot be negative.
  const retries = {
    ...createStep('llm_map', []),
    prompt: 'p',
    for_each: 'l',
    item_var: 'i',
    max_retries: -1,
  } as never
  assert.ok('max_retries' in configErrors(retries), 'negative max_retries must fail')

  // sandbox timeout_ms must be >= 1.
  const sandbox = { ...createStep('sandbox', []), run: 'echo', timeout_ms: 0 } as never
  assert.ok('timeout_ms' in configErrors(sandbox), 'sandbox timeout 0 must fail')
})

test('schema rejects an invalid enum (output_format)', () => {
  const step = { ...createStep('agent', []), prompt: 'x', output_format: 'xml' } as never
  assert.ok('output_format' in configErrors(step), 'unknown output_format must fail')
})

test('REGRESSION: llm / llm_map createStep sets NO non-empty `tools`', () => {
  // The tools picker was removed; the backend rejects a non-empty `tools` on an
  // llm/llm_map step. Guard that the default omits it (or leaves it empty).
  for (const kind of ['llm', 'llm_map'] as const) {
    const step = createStep(kind, []) as unknown as Record<string, unknown>
    const tools = step.tools
    const nonEmpty = Array.isArray(tools) && tools.length > 0
    assert.equal(
      nonEmpty,
      false,
      `${kind} default must not carry a non-empty tools field (got ${JSON.stringify(tools)})`,
    )
  }
})

// ---------------------------------------------------------------------------
// INV-1 AT THE FIELD LEVEL (fix round 5, finding 2).
//
// `LabeledControl` renders a `configErrors` message verbatim under the control,
// so ANY zod DEFAULT diagnostic that escapes is raw schema-validator language in
// front of the author. The reachable instance: `StepConfig::{Llm,LlmMap,Agent}`
// declare `prompt` with `skip_serializing_if = "Option::is_none"`, so a step
// authored with `prompt_file:` arrives with NO `prompt` key at all — and a
// custom message attached only to `.min(1, …)` left the ABSENT case answering
// "Invalid input: expected string, received undefined".
//
// These two are the CLASS guard, not the instance guard: they enumerate
// `STEP_KINDS` and every key of each kind's default step, so a NEW kind, a new
// field, or a new schema node with no authored copy fails here.
// ---------------------------------------------------------------------------

/** Vocabulary only a schema validator uses — never author-facing copy. */
const ZOD_DIAGNOSTIC =
  /invalid input|invalid option|invalid type|invalid value|invalid format|expected |received |unrecognized key|too small|too big|^required$|\bnan\b/i

test('no zod default diagnostic can reach a field, for ANY kind or field state', () => {
  const mutations: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    0,
    -1,
    1.5,
    999999,
    'abc',
    true,
    {},
    [],
  ]
  for (const kind of STEP_KINDS) {
    const base = createStep(kind, []) as unknown as Record<string, unknown>
    // The all-absent shape is the `prompt_file:`-import case: serde omits every
    // `Option::is_none` config field, so only the discriminant is guaranteed.
    const variants: Record<string, unknown>[] = [{ kind }, base]
    for (const key of Object.keys(base)) {
      const dropped = { ...base }
      delete dropped[key]
      variants.push(dropped)
      for (const value of mutations) variants.push({ ...base, [key]: value })
    }
    for (const variant of variants) {
      for (const [field, message] of Object.entries(configErrors(variant as never))) {
        assert.ok(
          message.trim().length > 0,
          `${kind}.${field}: an empty field message tells the author nothing`,
        )
        assert.doesNotMatch(
          message,
          ZOD_DIAGNOSTIC,
          `${kind}.${field} showed the author a raw schema-validator diagnostic ` +
            `(${JSON.stringify(message)}) for input ${JSON.stringify(variant)}. ` +
            `Give that schema node authored copy for its TYPE error too ` +
            `(z.string({ error }) / z.number({ error }) / z.enum([…], { error })).`,
        )
      }
    }
  }
})

test('an ABSENT required field reads exactly like an EMPTY one', () => {
  // THE LITERAL DEFECT: an imported `prompt_file:` step has no `prompt` key.
  const cases = [
    ['agent', 'prompt'],
    ['llm', 'prompt'],
    ['llm_map', 'prompt'],
    ['sandbox', 'run'],
    ['elicit', 'message'],
    ['tool', 'server'],
    ['tool', 'tool'],
  ] as const
  for (const [kind, field] of cases) {
    const empty = createStep(kind, []) as unknown as Record<string, unknown>
    const absent = { ...empty }
    delete absent[field]
    const emptyMessage = configErrors(empty as never)[field]
    assert.ok(emptyMessage, `${kind}.${field}: the empty case must be flagged`)
    assert.equal(
      configErrors(absent as never)[field],
      emptyMessage,
      `${kind}.${field}: an absent value must read like an empty one`,
    )
  }
})

// ---------------------------------------------------------------------------
// THE PROMPT XOR (fix round 6).
//
// `validate.rs` (~681-691) requires EXACTLY ONE of a typed prompt or a prompt
// file on `agent` / `llm` / `llm_map`:
//   has_prompt = prompt.filter(|s| !s.is_empty()).is_some()
//   has_file   = prompt_file.is_some()
//   MISSING fires only on !has_prompt && !has_file
// The client attached its prompt requirement UNCONDITIONALLY, so a step that
// supplies its wording from a file — valid to the backend, and with NO `prompt`
// key at all on the wire (`skip_serializing_if = "Option::is_none"`) — showed a
// red "is required" under an empty box the author cannot act on, beside a green
// "No blocking errors." panel and an enabled Save. INV-6: a stated reason must
// be TRUE.
// ---------------------------------------------------------------------------

/** The kinds carrying the prompt-XOR rule, with their author-facing copy. */
const PROMPT_XOR_KINDS = [
  ['agent', 'A task description is required'],
  ['llm', 'A prompt is required'],
  ['llm_map', 'A prompt is required'],
] as const

test('a step whose wording comes from a FILE is NOT told a prompt is missing', () => {
  for (const [kind] of PROMPT_XOR_KINDS) {
    const base = createStep(kind, []) as unknown as Record<string, unknown>
    // serde omits the key entirely on a `prompt_file:` import.
    const absent = { ...base }
    delete absent.prompt
    // …and the same step after the author cleared the box (`prompt: ''`), which
    // the backend also reads as "no typed prompt" (the `!s.is_empty()` filter).
    const shapes: Record<string, unknown>[] = [
      { ...absent, prompt_file: 'prompts/task.md' },
      { ...base, prompt: '', prompt_file: 'prompts/task.md' },
      { ...base, prompt: '   ', prompt_file: 'prompts/task.md' },
      // `prompt: ~` in YAML → `None` to serde, i.e. no typed prompt either.
      { ...base, prompt: null, prompt_file: 'prompts/task.md' },
    ]
    for (const shape of shapes) {
      const errs = configErrors(shape as never)
      assert.ok(
        !('prompt' in errs),
        `${kind}: a step supplying its wording from a file is VALID to the ` +
          `backend, yet the builder demanded a prompt (${JSON.stringify(errs.prompt)}) ` +
          `for ${JSON.stringify(shape)} — a FALSE requirement the author cannot ` +
          `act on (the builder renders no prompt-file control).`,
      )
    }
  }
})

test('a step with NEITHER a prompt nor a file keeps its exact original message', () => {
  // The e2e specs and the tests above assert these strings byte-for-byte; the
  // XOR must lift the requirement, never reword it.
  for (const [kind, message] of PROMPT_XOR_KINDS) {
    const base = createStep(kind, []) as unknown as Record<string, unknown>
    const absent = { ...base }
    delete absent.prompt
    for (const shape of [base, absent, { ...base, prompt: '   ' }]) {
      assert.equal(
        configErrors(shape as never).prompt,
        message,
        `${kind}: neither a typed prompt nor a file — the original required ` +
          `message must survive verbatim for ${JSON.stringify(shape)}`,
      )
    }
    // A `prompt_file` the backend would NOT read as a file (null / absent /
    // non-string) leaves the requirement in force.
    for (const promptFile of [null, undefined, 0, false, {}, []]) {
      assert.equal(
        configErrors({ ...absent, prompt_file: promptFile } as never).prompt,
        message,
        `${kind}: prompt_file ${JSON.stringify(promptFile)} is not a file to ` +
          `the backend, so the requirement must stay`,
      )
    }
  }
})

test('buildStepZodSchema returns a schema for each kind (no throw)', () => {
  for (const kind of STEP_KINDS) {
    const schema = buildStepZodSchema(kind)
    assert.ok(schema, `schema built for ${kind}`)
    // safeParse never throws even on garbage input.
    assert.doesNotThrow(() => schema.safeParse({ nonsense: true } as never))
  }
})
