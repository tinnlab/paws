/**
 * TEST-25 (default-model-onboarding) — leaving the wizard clears the step's
 * orchestration state.
 *
 * Store-kit's `__destroy__` tears down listeners but does NOT restore initial
 * state, and the wizard already resets its two sibling step stores on unmount.
 * Without this, a failure from one visit survives and re-renders "The model
 * couldn't be installed" on a later, unrelated visit — an error about an attempt
 * the user never made.
 *
 * Runs under Vitest (`*.store.test.ts`) rather than `node --test`, because the
 * action imports a VALUE from `../state` with an extensionless specifier that
 * only Vite resolves. The sibling action tests are vitest for the same reason.
 */
import { describe, expect, it } from 'vitest'
import { defaultModelStepState } from './state'
import resetFactory from './actions/reset'

function run(seed: Record<string, unknown>) {
  const state = { ...defaultModelStepState, ...seed } as Record<string, unknown>
  const set = (fn: (s: unknown) => Record<string, unknown>) => {
    Object.assign(state, fn(state))
  }
  resetFactory(set as never, (() => state) as never)()
  return state
}

describe('reset', () => {
  it('clears a failed attempt so it cannot resurface on a later visit', () => {
    const after = run({
      installing: true,
      stage: 'runtime',
      error: 'The local runtime could not be installed.',
      runtimeUnavailable: true,
      runtimeKey: 'llamacpp@v1',
      loading: true,
    })

    expect(after.error, 'a stale error must not re-render next visit').toBeNull()
    expect(after.runtimeKey).toBeNull()
    expect(after.runtimeUnavailable).toBe(false)
    expect(after.installing).toBe(false)
    expect(after.stage).toBe('idle')
    expect(after.loading).toBe(false)
  })

  it('restores EVERY field, not a hand-picked subset', () => {
    // A partial reset is the failure mode this guards: a field added to the
    // state later would silently keep leaking across visits.
    const after = run({
      installing: true,
      stage: 'model',
      error: 'boom',
      runtimeUnavailable: true,
      runtimeKey: 'k',
      loading: true,
    })

    expect(after).toEqual({ ...defaultModelStepState })
  })
})
