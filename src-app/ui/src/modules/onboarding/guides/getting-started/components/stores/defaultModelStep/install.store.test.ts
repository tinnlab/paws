/**
 * TEST-23 (default-model-onboarding) — the install orchestration.
 *
 * Three properties, each of which was previously asserted only by a comment:
 *
 *  1. **It is not re-entrant.** Two concurrent runs would each enable the
 *     provider and race the runtime leg's `setDefaultVersion`. Only the weights
 *     leg is de-duplicated, and only server-side.
 *  2. **It stops at an unavailable runtime.** Continuing would start a 5.68 GB
 *     download for a model nothing can serve.
 *  3. **It surfaces the readiness leg's own words.** `ensureLocalProvider`
 *     returns a problem naming what a human must do; swallowing it and
 *     substituting a generic message would strand the user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Draft = {
  installing: boolean
  stage: string
  error: string | null
  runtimeUnavailable: boolean
  runtimeKey: string | null
  loading: boolean
}

const outcome = vi.hoisted(() => ({
  provider: { providerId: 'local-1' as string | null, problem: null as string | null },
  runtime: 'ready' as 'ready' | 'unavailable' | 'failed',
}))

const ensureLocalProvider = vi.hoisted(() => vi.fn(async () => outcome.provider))
const ensureRuntime = vi.hoisted(() => vi.fn(async () => outcome.runtime))
const downloadLlmModelFromRepository = vi.hoisted(() =>
  vi.fn(async () => ({ downloadId: 'dl-1' })),
)

vi.mock('./actions/ensureLocalProvider', () => ({ default: () => ensureLocalProvider }))
vi.mock('./actions/ensureRuntime', () => ({ default: () => ensureRuntime }))
vi.mock('@/modules/llm-provider/stores/llmModelDownload', () => ({
  LlmModelDownload: { downloadLlmModelFromRepository },
}))

/** A minimal stand-in for the store's immer `set` + `get`. */
function makeStore() {
  const state: Draft = {
    installing: false,
    stage: 'idle',
    error: null,
    runtimeUnavailable: false,
    runtimeKey: null,
    loading: false,
  }
  const set = (fn: (draft: Draft) => void) => fn(state)
  const get = () => state
  return { state, set, get }
}

async function install(store: ReturnType<typeof makeStore>) {
  const factory = (await import('./actions/install.ts')).default
  return factory(store.set as never, store.get as never)()
}

beforeEach(() => {
  outcome.provider = { providerId: 'local-1', problem: null }
  outcome.runtime = 'ready'
  ensureLocalProvider.mockClear()
  ensureRuntime.mockClear()
  downloadLlmModelFromRepository.mockClear()
  vi.resetModules()
})

describe('install', () => {
  it('runs the three legs in order and registers the download', async () => {
    const store = makeStore()
    await install(store)

    expect(ensureLocalProvider).toHaveBeenCalledTimes(1)
    expect(ensureRuntime).toHaveBeenCalledTimes(1)
    expect(downloadLlmModelFromRepository).toHaveBeenCalledTimes(1)

    // The provider and runtime legs run BEFORE the multi-GB transfer: failing
    // them afterwards would waste the user's bandwidth to reach the same end.
    const providerOrder = ensureLocalProvider.mock.invocationCallOrder[0]
    const runtimeOrder = ensureRuntime.mock.invocationCallOrder[0]
    const downloadOrder = downloadLlmModelFromRepository.mock.invocationCallOrder[0]
    expect(providerOrder).toBeLessThan(runtimeOrder)
    expect(runtimeOrder).toBeLessThan(downloadOrder)

    expect(store.state.installing).toBe(false)
    expect(store.state.stage).toBe('idle')
    expect(store.state.error).toBeNull()
  })

  it('is NOT re-entrant — a second call while installing does nothing', async () => {
    const store = makeStore()
    store.state.installing = true

    await install(store)

    expect(
      ensureLocalProvider,
      'a double-click must not start a second orchestration racing the first',
    ).not.toHaveBeenCalled()
    expect(downloadLlmModelFromRepository).not.toHaveBeenCalled()
    // …and it must not clear the in-flight run's own state on its way out.
    expect(store.state.installing).toBe(true)
  })

  it('stops at an unavailable runtime WITHOUT downloading, and without erroring', async () => {
    outcome.runtime = 'unavailable'
    const store = makeStore()

    await install(store)

    expect(
      downloadLlmModelFromRepository,
      'a 5.68 GB download that nothing can serve is worse than an honest stop',
    ).not.toHaveBeenCalled()
    // Surfaced as its own state, not as a failure.
    expect(store.state.error).toBeNull()
    expect(store.state.installing).toBe(false)
  })

  it('treats a FAILED runtime install as an error, and does not download', async () => {
    outcome.runtime = 'failed'
    const store = makeStore()

    await install(store)

    expect(downloadLlmModelFromRepository).not.toHaveBeenCalled()
    expect(store.state.error).toMatch(/runtime/i)
  })

  it("surfaces the readiness leg's own problem text verbatim", async () => {
    // The readiness leg names what a human must do — which group to assign, or
    // that an administrator must enable the provider. Replacing that with a
    // generic message would strand the user with no next step.
    outcome.provider = {
      providerId: null,
      problem: 'An administrator can share it in Settings → LLM Providers → Groups.',
    }
    const store = makeStore()

    await install(store)

    expect(store.state.error).toBe(
      'An administrator can share it in Settings → LLM Providers → Groups.',
    )
    expect(ensureRuntime).not.toHaveBeenCalled()
    expect(downloadLlmModelFromRepository).not.toHaveBeenCalled()
  })

  it('always clears `installing`, even when a leg throws', async () => {
    // Otherwise the re-entrancy guard would latch the step shut forever.
    ensureLocalProvider.mockRejectedValueOnce(new Error('boom'))
    const store = makeStore()

    await install(store)

    expect(store.state.installing).toBe(false)
    expect(store.state.stage).toBe('idle')
    expect(store.state.error).toBe('boom')
  })
})
