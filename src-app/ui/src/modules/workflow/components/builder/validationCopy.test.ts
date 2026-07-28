import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ValidationError } from '@/api-client/types'
import type { BuilderStep } from './stepForms.ts'
import {
  HUMANISED_CODES,
  WORKFLOW_LEVEL,
  attributeFindings,
  findingStepTitle,
  humaniseFinding,
  indexFindingsByStep,
  resolveFindingStep,
} from './validationCopy.ts'

// TEST-8/9/10 — the presentation boundary that keeps wire vocabulary away from
// the person building a workflow (INV-1) and attributes each finding to its
// step (INV-2). Pure; the backend's `humanisation_contract` test is the other
// half (it fails if a code reaches here with no copy).

const steps = [
  {
    id: 'agent_1',
    kind: 'agent',
    description: 'Research the topic',
    depends_on: [],
    prompt: '',
  },
  {
    id: 'summarize',
    kind: 'llm',
    description: '',
    depends_on: ['agent_1'],
    prompt: '',
  },
  {
    id: 'tool_1',
    kind: 'tool',
    description: 'Look it up',
    depends_on: [],
    server: '',
    tool: '',
  },
] as unknown as BuilderStep[]

function finding(over: Partial<ValidationError>): ValidationError {
  return {
    code: 'WORKFLOW_PROMPT_MISSING',
    layer: 'semantic',
    message: 'step has neither prompt: nor prompt_file:',
    location: 'agent_1',
    ...over,
  } as ValidationError
}

test('one backend code reads differently per step kind', () => {
  const f = finding({})
  const onAgent = humaniseFinding(f, steps[0])
  const onLlm = humaniseFinding(f, steps[1])
  assert.notEqual(
    onAgent,
    onLlm,
    'WORKFLOW_PROMPT_MISSING must say "task" on an agent step and "prompt" on an llm step — ' +
      'this per-kind split is WHY the humanisation lives in the UI, not the validator',
  )
  assert.match(onAgent, /task/i)
  assert.match(onLlm, /prompt/i)
})

test('no mapped copy leaks wire vocabulary to the author', () => {
  // The literal defect: `prompt:` / `prompt_file:` are YAML keys, not English.
  const offenders: string[] = []
  for (const code of HUMANISED_CODES) {
    const text = humaniseFinding(
      finding({ code, message: 'RAW BACKEND MESSAGE' }),
      steps[0],
    )
    assert.notEqual(
      text,
      'RAW BACKEND MESSAGE',
      `${code} fell through to the raw backend message`,
    )
    // A trailing-colon token (`prompt:`, `run:`, `for_each:`) is the wire
    // vocabulary tell. `{{ … }}` and prose colons are fine.
    if (/\b[a-z_]{3,}:(?![/\s]*\/)/.test(text.replace(/https?:/g, ''))) {
      offenders.push(`${code}: ${text}`)
    }
    if (/prompt_file|\$defs|serde|snake_case/i.test(text)) {
      offenders.push(`${code}: ${text}`)
    }
  }
  assert.deepEqual(offenders, [], 'these findings still speak in wire vocabulary')
})

test('an unknown code falls back to the backend message, never to nothing', () => {
  const text = humaniseFinding(
    finding({ code: 'WORKFLOW_SOMETHING_NEW', message: 'a brand new problem' }),
    steps[0],
  )
  assert.equal(text, 'a brand new problem')
})

test('resolveFindingStep handles every location shape', () => {
  assert.equal(resolveFindingStep(finding({ location: 'agent_1' }), steps)?.id, 'agent_1')
  assert.equal(
    resolveFindingStep(finding({ location: 'agent_1.prompt' }), steps)?.id,
    'agent_1',
    'a field path resolves to its step',
  )
  assert.equal(
    resolveFindingStep(finding({ location: 'outputs[summary].from' }), steps),
    null,
    'an output path is workflow-level, not a step',
  )
  assert.equal(
    resolveFindingStep(finding({ location: undefined }), steps),
    null,
    'a finding with no location is workflow-level',
  )
  assert.equal(
    resolveFindingStep(finding({ location: 'ghost_step' }), steps),
    null,
    'a location naming a step that no longer exists is workflow-level, not a crash',
  )
})

test('attributeFindings numbers the step and labels it for the author', () => {
  const [a] = attributeFindings([finding({ location: 'agent_1.prompt' })], steps)
  assert.equal(a.stepId, 'agent_1')
  assert.equal(a.stepIndex, 1)
  assert.equal(a.stepLabel, 'Research the topic')
  assert.equal(findingStepTitle(a), 'Step 1 · Research the topic')

  // A step with no author label falls back to its id, never to blank.
  const [b] = attributeFindings([finding({ location: 'summarize' })], steps)
  assert.equal(findingStepTitle(b), 'Step 2 · summarize')

  const [c] = attributeFindings([finding({ location: undefined })], steps)
  assert.equal(findingStepTitle(c), 'Whole workflow')
})

test('indexFindingsByStep counts per step without double-counting', () => {
  const attributed = [
    ...attributeFindings(
      [
        finding({ location: 'agent_1' }),
        finding({ code: 'WORKFLOW_UNKNOWN_STEP_REF', location: 'agent_1.prompt' }),
        finding({ code: 'WORKFLOW_TOOL_NO_TOOL', location: 'tool_1' }),
        finding({ code: 'WORKFLOW_NO_STEPS', location: undefined }),
      ],
      steps,
    ),
    ...attributeFindings(
      [
        {
          code: 'WORKFLOW_REF_FIELD_UNRESOLVED',
          layer: 'semantic',
          message: 'unresolved',
          location: 'tool_1',
          severity: 'warning',
        } as ValidationError,
      ],
      steps,
    ),
  ]
  const idx = indexFindingsByStep(attributed)
  assert.deepEqual(idx.get('agent_1'), { errors: 2, warnings: 0 })
  assert.deepEqual(idx.get('tool_1'), { errors: 1, warnings: 1 })
  assert.deepEqual(idx.get(WORKFLOW_LEVEL), { errors: 1, warnings: 0 })
  assert.equal(idx.get('summarize'), undefined, 'a clean step gets no entry')
  // Total conservation: every finding lands in exactly one bucket.
  const total = [...idx.values()].reduce((n, c) => n + c.errors + c.warnings, 0)
  assert.equal(total, attributed.length)
})
