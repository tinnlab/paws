/**
 * TEST-11 (default-model-onboarding) — the local-provider readiness leg.
 *
 * A fresh install ships the built-in `Local` provider DISABLED, and
 * `list_local_providers` filters `WHERE provider_type='local' AND enabled = true`
 * — so without this leg there is nothing to download into and INV-2's "working
 * model" is unreachable.
 *
 * The subtle one is the third case. `updateLlmProvider` early-returns
 * `null as any` when its own `updating` flag is already set, so an install that
 * trusted its return value would conclude "no provider" on a benign race and
 * abort a perfectly good install. The action must re-read the list instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Provider = { id: string; provider_type: string; enabled: boolean }

const state = vi.hoisted(() => ({
  providers: [] as Provider[],
  /** What `updateLlmProvider` resolves to — `null` reproduces the concurrent-update race. */
  updateResult: {} as unknown,
  canEditProviders: true,
}))

const loadLlmProviders = vi.hoisted(() =>
  vi.fn(async (_force?: boolean) => undefined),
)
const updateLlmProvider = vi.hoisted(() =>
  vi.fn(async (_id: string, _data: { enabled?: boolean }) => state.updateResult),
)

vi.mock('@/modules/llm-provider/stores/llmProvider', () => ({
  LlmProvider: {
    loadLlmProviders,
    updateLlmProvider,
    get $() {
      return { providers: state.providers }
    },
  },
}))

vi.mock('@/core/permissions', () => ({
  hasPermissionNow: () => state.canEditProviders,
}))

// The action writes no state of its own; these stand in for the store's
// `set`/`get` so the factory can be exercised without booting a store.
const noopSet = (() => undefined) as never
const noopGet = (() => ({})) as never

async function run() {
  const factory = (await import('./actions/ensureLocalProvider.ts')).default
  return factory(noopSet, noopGet)()
}

beforeEach(() => {
  state.providers = []
  state.updateResult = {}
  state.canEditProviders = true
  loadLlmProviders.mockClear()
  // `mockReset`, not `mockClear`: a per-test `mockImplementation` survives
  // `mockClear`, so an earlier case's "flip enabled on update" would leak into
  // the case that asserts what happens when the enable does NOT take effect.
  updateLlmProvider.mockReset()
  updateLlmProvider.mockImplementation(async () => state.updateResult)
  vi.resetModules()
})

describe('ensureLocalProvider', () => {
  it('enables a DISABLED built-in local provider before installing', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    updateLlmProvider.mockImplementation(async (id: string) => {
      // The server flips it; the next list read reflects that.
      state.providers = state.providers.map(p =>
        p.id === id ? { ...p, enabled: true } : p,
      )
      return state.updateResult
    })

    await expect(run()).resolves.toBe('local-1')
    expect(updateLlmProvider).toHaveBeenCalledWith('local-1', { enabled: true })
  })

  it('leaves an ALREADY-enabled provider untouched', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: true }]

    await expect(run()).resolves.toBe('local-1')
    expect(updateLlmProvider).not.toHaveBeenCalled()
  })

  it('re-reads the list instead of trusting updateLlmProvider\'s return value', async () => {
    // The concurrent-update race: the store early-returns `null` while another
    // update is in flight, even though the write it represents did land.
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.updateResult = null
    updateLlmProvider.mockImplementation(async (id: string) => {
      state.providers = state.providers.map(p =>
        p.id === id ? { ...p, enabled: true } : p,
      )
      return null
    })

    await expect(run()).resolves.toBe(
      'local-1',
      // If the action returned `updateLlmProvider`'s value it would be null here
      // and the install would abort with "no local provider".
    )
    expect(loadLlmProviders).toHaveBeenCalledWith(true)
  })

  it('returns null when the enable did not take effect', async () => {
    // No re-read optimism: if the provider is still disabled afterwards, saying
    // "ready" would start a multi-GB download into a provider that cannot serve it.
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]

    await expect(run()).resolves.toBeNull()
  })

  it('returns null when no local provider exists at all', async () => {
    state.providers = [{ id: 'openai-1', provider_type: 'openai', enabled: true }]

    await expect(run()).resolves.toBeNull()
    expect(updateLlmProvider).not.toHaveBeenCalled()
  })

  it('does not attempt the enable without the provider-edit permission', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.canEditProviders = false

    await expect(run()).resolves.toBeNull()
    expect(updateLlmProvider).not.toHaveBeenCalled()
  })
})
