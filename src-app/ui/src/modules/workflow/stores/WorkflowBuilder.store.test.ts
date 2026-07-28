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
