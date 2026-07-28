/**
 * TEST-9 — the WorkflowBuilder local store's pure conversion helpers.
 *
 * SCOPE NOTE (sanctioned fallback): the store is a `defineLocalStore`, whose
 * ONLY entry point is `.use()` — a React hook (`useRef` + `useEffect`). This
 * workspace has no `@testing-library/react` / `renderHook` and no precedent for
 * headless-rendering a local store, so its reducer closures (add/reorder/delete
 * step) cannot be instantiated in isolation without standing up a full React
 * runtime. Per the task's fallback, this test pins the PURE helpers the store
 * delegates to instead: `emptyDef`, `toBuilderDef`, `toWorkflowDef` (now
 * exported, behaviour-preserving) — in particular the base-field round-trip
 * (`id` / `description` / `depends_on`) through `StepBase`, and the store's
 * add-step delegation to `createStep`. The reducers themselves are exercised by
 * the module's E2E/integration coverage.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ValidateDefResponse, WorkflowDef } from '@/api-client/types'

vi.mock('@/api-client', () => ({ ApiClient: {} }))
vi.mock('@/core/permissions', () => ({ hasPermissionNow: () => true }))

import { createStep } from '../components/builder/stepForms'
import {
  type BuilderDef,
  type ValidationSlice,
  createValidateRunner,
  emptyDef,
  toBuilderDef,
  toWorkflowDef,
} from './WorkflowBuilder.store'

describe('emptyDef', () => {
  it('is a blank, mutable definition', () => {
    const d = emptyDef()
    expect(d.inputs).toEqual([])
    expect(d.steps).toEqual([])
    // Distinct instances (no shared array reference between sessions).
    expect(emptyDef().steps).not.toBe(d.steps)
  })
})

describe('toBuilderDef / toWorkflowDef round-trip', () => {
  it('round-trips base fields (id / description / depends_on) through StepBase', () => {
    const wire: WorkflowDef = {
      $schema: 'https://ziee/workflow.schema.json',
      max_runtime_secs: 600,
      inputs: [{ name: 'topic', required: true }],
      steps: [
        {
          // base fields serde-flatten keeps on the wire but the generated
          // StepDef type drops — the whole point of the BuilderStep narrowing.
          id: 's1',
          description: 'first step',
          depends_on: [],
          kind: 'llm',
          prompt: 'hello',
          output_format: 'text',
        },
        {
          id: 's2',
          description: 'second step',
          depends_on: ['s1'],
          kind: 'sandbox',
          run: 'echo hi',
          timeout_ms: 30000,
        },
      ] as never,
    }

    const builder = toBuilderDef(wire)
    // Base fields survive the wire → builder narrowing.
    expect(builder.steps.map(s => s.id)).toEqual(['s1', 's2'])
    expect(builder.steps[1].description).toBe('second step')
    expect(builder.steps[1].depends_on).toEqual(['s1'])

    const back = toWorkflowDef(builder)
    // builder → wire preserves base fields + config + top-level metadata.
    expect(back.steps).toEqual(wire.steps)
    expect(back.inputs).toEqual(wire.inputs)
    expect(back.$schema).toBe(wire.$schema)
    expect(back.max_runtime_secs).toBe(600)
  })

  it('toWorkflowDef omits absent optional metadata (no $schema / max_runtime_secs keys)', () => {
    const def: BuilderDef = { inputs: [], steps: [] }
    const wire = toWorkflowDef(def)
    expect('$schema' in wire).toBe(false)
    expect('max_runtime_secs' in wire).toBe(false)
    expect(wire.inputs).toEqual([])
    expect(wire.steps).toEqual([])
  })

  it('toBuilderDef tolerates a wire def with no inputs/steps', () => {
    const builder = toBuilderDef({} as WorkflowDef)
    expect(builder.inputs).toEqual([])
    expect(builder.steps).toEqual([])
  })
})

describe('createValidateRunner — the two ordering rules of a validation run', () => {
  const RESULT_A = { errors: [], warnings: [], cost_estimate: null } as unknown as ValidateDefResponse
  const RESULT_B = { errors: [], warnings: [], cost_estimate: null } as unknown as ValidateDefResponse

  function harness(request: (def: WorkflowDef) => Promise<ValidateDefResponse>) {
    const slice: ValidationSlice = {
      validating: false,
      validation: null,
      error: null,
      errorSource: null,
      errorFinding: null,
    }
    const run = createValidateRunner({
      getDef: () => emptyDef(),
      request,
      apply: mutate => mutate(slice),
    })
    return { slice, run }
  }

  /** A promise plus its resolve/reject, so a test can land responses out of order. */
  function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('discards a STALE response: an older run may not overwrite a newer result', async () => {
    // Validation is debounced AND fired directly (mount, save), so two requests
    // are routinely in flight. The older one landing last used to win — and the
    // result it wrote drives the panel, the step markers AND the Save gate.
    const first = deferred<ValidateDefResponse>()
    const second = deferred<ValidateDefResponse>()
    const queue = [first.promise, second.promise]
    const { slice, run } = harness(() => queue.shift() as Promise<ValidateDefResponse>)

    const p1 = run()
    const p2 = run()

    second.resolve(RESULT_B)
    await p2
    expect(slice.validation).toBe(RESULT_B)
    expect(slice.validating).toBe(false)

    // …and now the OLDER response lands.
    first.resolve(RESULT_A)
    await p1
    expect(slice.validation, 'the stale response overwrote the newer result').toBe(
      RESULT_B,
    )
    expect(slice.validating, 'a stale response re-opened the spinner').toBe(false)
  })

  it('discards a stale FAILURE: an older rejection may not raise an error over a newer success', async () => {
    const first = deferred<ValidateDefResponse>()
    const second = deferred<ValidateDefResponse>()
    const queue = [first.promise, second.promise]
    const { slice, run } = harness(() => queue.shift() as Promise<ValidateDefResponse>)

    const p1 = run()
    const p2 = run()
    second.resolve(RESULT_B)
    await p2
    first.reject(new Error('HTTP error! status: 502 - <html>gateway</html>'))
    await p1

    expect(slice.validation).toBe(RESULT_B)
    expect(slice.error, 'a stale failure surfaced over a fresh success').toBeNull()
  })

  it('a successful check does NOT clear a save failure (which is still true)', async () => {
    const { slice, run } = harness(async () => RESULT_A)
    slice.error = 'The workflow could not be saved — try again.'
    slice.errorSource = 'save'

    await run()

    expect(slice.validation).toBe(RESULT_A)
    expect(
      slice.error,
      'the background check erased a save failure — the alert self-erased and the green ' +
        '"No blocking errors." returned while the workflow was still unsaved',
    ).toBe('The workflow could not be saved — try again.')
    expect(slice.errorSource).toBe('save')
  })

  it('a successful check DOES clear the failure validation itself left', async () => {
    const { slice, run } = harness(async () => RESULT_A)
    slice.error = 'The workflow could not be checked — try again.'
    slice.errorSource = 'validate'

    await run()

    expect(slice.error, 'a transient check failure latched forever').toBeNull()
    expect(slice.errorSource).toBeNull()
  })

  it('a failed check surfaces a humanised reason — never the api-client wire string', async () => {
    const { slice, run } = harness(async () => {
      throw Object.assign(
        new Error('HTTP error! status: 502 - <!DOCTYPE html><h1>502 Bad Gateway</h1>'),
        { status: 502 },
      )
    })

    await run()

    expect(slice.errorSource).toBe('validate')
    expect(slice.error).not.toBeNull()
    expect(slice.error).not.toMatch(/HTTP error!/)
    expect(slice.error).not.toMatch(/[<>]/)
    expect(slice.validating).toBe(false)
  })

  it('retires a save failure once the finding it described is GONE', async () => {
    // The sequence this fixes: Save is rejected by
    //   [semantic/WORKFLOW_PROMPT_MISSING] agent_1: step has neither prompt: …
    // → the author FIXES the prompt → the next check comes back clean → the
    // panel says "No blocking errors." with the save alert still above it,
    // stating something the author has already dealt with. Nothing retired it
    // until they happened to press Save again.
    const { slice, run } = harness(async () => RESULT_A)
    slice.error =
      'Step 1 · Research the topic: This step needs a task description — say what the assistant should do.'
    slice.errorSource = 'save'
    slice.errorFinding = {
      code: 'WORKFLOW_PROMPT_MISSING',
      location: 'agent_1',
      // The backend SENT this location and it names a real step — see
      // `FindingIdentity.locationCertain`.
      locationCertain: true,
    }

    await run()

    expect(
      slice.error,
      'a save failure whose finding the author has fixed stayed on screen, above a green "No blocking errors."',
    ).toBeNull()
    expect(slice.errorSource).toBeNull()
    expect(slice.errorFinding).toBeNull()
  })

  it('KEEPS a save failure while its finding is still reported', async () => {
    const stillBroken = {
      errors: [
        {
          layer: 'semantic',
          code: 'WORKFLOW_PROMPT_MISSING',
          message: 'step has neither prompt: nor prompt_file:',
          location: 'agent_1',
        },
      ],
      warnings: [],
      cost_estimate: null,
    } as unknown as ValidateDefResponse
    const { slice, run } = harness(async () => stillBroken)
    const msg =
      'Step 1 · Research the topic: This step needs a task description — say what the assistant should do.'
    slice.error = msg
    slice.errorSource = 'save'
    slice.errorFinding = {
      code: 'WORKFLOW_PROMPT_MISSING',
      location: 'agent_1',
      // The backend SENT this location and it names a real step — see
      // `FindingIdentity.locationCertain`.
      locationCertain: true,
    }

    await run()

    expect(slice.error, 'the save failure was retired while still true').toBe(msg)
    expect(slice.errorSource).toBe('save')
  })

  it('matches on LOCATION too — the same code on another step is not the same claim', async () => {
    // The stored sentence names step 1 ("Step 1 · Research the topic: …"). A
    // check that reports the same code against step 2 means step 1's problem is
    // gone, so that sentence is now false and must go — the live step-2 finding
    // is rendered by the panel's own list, in its own words.
    const otherStep = {
      errors: [
        {
          layer: 'semantic',
          code: 'WORKFLOW_PROMPT_MISSING',
          message: 'step has neither prompt: nor prompt_file:',
          location: 'summarize',
        },
      ],
      warnings: [],
      cost_estimate: null,
    } as unknown as ValidateDefResponse
    const { slice, run } = harness(async () => otherStep)
    slice.error = 'Step 1 · Research the topic: This step needs a task description — say what the assistant should do.'
    slice.errorSource = 'save'
    slice.errorFinding = {
      code: 'WORKFLOW_PROMPT_MISSING',
      location: 'agent_1',
      // The backend SENT this location and it names a real step — see
      // `FindingIdentity.locationCertain`.
      locationCertain: true,
    }

    await run()

    expect(
      slice.errorSource,
      'a sentence naming step 1 survived a check in which step 1 is clean',
    ).toBeNull()
    expect(slice.error).toBeNull()
  })

  it('KEEPS a save failure whose location was GUESSED out of the message', async () => {
    // FIX round 4 / finding 1. `WORKFLOW_TOO_MANY_STEPS` carries NO location;
    // its message merely opens `workflow.yaml: …`, which `parseInstallError`
    // reads as a location. The structured `/validate-def` result for the very
    // same finding has no location, so a code+location comparison never matched
    // and the save error was retired on the FIRST check — with nothing fixed,
    // and reachable through the 400ms debounce race.
    const stillTooMany = {
      errors: [
        {
          layer: 'semantic',
          code: 'WORKFLOW_TOO_MANY_STEPS',
          message: 'workflow.yaml: a workflow may declare at most 50 steps',
          // exactly what the endpoint returns: no location at all
        },
      ],
      warnings: [],
      cost_estimate: null,
    } as unknown as ValidateDefResponse
    const { slice, run } = harness(async () => stillTooMany)
    const msg = 'This workflow has too many steps — remove a few.'
    slice.error = msg
    slice.errorSource = 'save'
    // What `describeRequestError` produces for that wire string.
    slice.errorFinding = {
      code: 'WORKFLOW_TOO_MANY_STEPS',
      location: 'workflow.yaml',
      locationCertain: false,
    }

    await run()

    expect(
      slice.error,
      'a save failure was retired by a check that still reports the very same finding',
    ).toBe(msg)
    expect(slice.errorSource).toBe('save')
  })

  it('retires a GUESSED-location save failure once the code is gone entirely', async () => {
    // The other direction: falling back to code-only matching must still retire
    // a message the author has genuinely dealt with, or the fix would just trade
    // one untrue screen for another.
    const { slice, run } = harness(async () => RESULT_A)
    slice.error = 'This workflow has too many steps — remove a few.'
    slice.errorSource = 'save'
    slice.errorFinding = {
      code: 'WORKFLOW_TOO_MANY_STEPS',
      location: 'workflow.yaml',
      locationCertain: false,
    }

    await run()

    expect(slice.error).toBeNull()
    expect(slice.errorSource).toBeNull()
    expect(slice.errorFinding).toBeNull()
  })

  it('never retires a finding the def-check cannot decide (prompt_file existence)', async () => {
    // A draft has no bundle, so `/validate-def` skips the `prompt_file:`
    // existence/confinement check entirely (validate.rs::check_prompt_files).
    // Its silence is not evidence — only a save, which validates against the
    // real bundle root, can settle it. Reading silence as "fixed" would wipe a
    // true save failure on the author's next keystroke.
    const { slice, run } = harness(async () => RESULT_A)
    const msg =
      'Step 1 · Research the topic: The prompt file for this step is missing.'
    slice.error = msg
    slice.errorSource = 'save'
    slice.errorFinding = {
      code: 'WORKFLOW_PROMPT_FILE_MISSING',
      location: 'agent_1',
      locationCertain: true,
    }

    await run()

    expect(
      slice.error,
      'a save failure was retired by a check that never looked at the question',
    ).toBe(msg)
    expect(slice.errorSource).toBe('save')
  })

  it('a failed check does not clobber a save failure already on screen', async () => {
    const { slice, run } = harness(async () => {
      throw new Error('network down')
    })
    slice.error = 'The workflow could not be saved — try again.'
    slice.errorSource = 'save'

    await run()

    expect(slice.error).toBe('The workflow could not be saved — try again.')
    expect(slice.errorSource).toBe('save')
  })
})

describe('add-step delegation (the reducer builds via createStep)', () => {
  it('createStep produces collision-free ids against the working def', () => {
    // Mirrors `addStep`, which calls createStep(kind, def.steps.map(s => s.id)).
    const def: BuilderDef = { inputs: [], steps: [] }
    const a = createStep('agent', def.steps.map(s => s.id))
    def.steps.push(a)
    const b = createStep('agent', def.steps.map(s => s.id))
    def.steps.push(b)
    expect(def.steps.map(s => s.id)).toEqual(['agent_1', 'agent_2'])
    // Each added step round-trips cleanly back to the wire form.
    expect(toWorkflowDef(def).steps).toEqual(def.steps)
  })
})
