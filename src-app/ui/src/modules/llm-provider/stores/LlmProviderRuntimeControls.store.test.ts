/**
 * LlmProvider — proxy-token rotation + model validation.
 *
 * Both endpoints shipped with a backend and no button:
 *   - `POST /llm-providers/{id}/rotate-proxy-token` — the ONLY way to change the
 *     local provider's proxy token (the update endpoint explicitly refuses to
 *     set it), so a leaked token previously meant editing the database.
 *   - `POST /llm-models/{id}/validate` — no validate control in any drawer.
 *
 * The security-relevant assertion here is that the rotated plaintext token is
 * RETURNED and never parked in store state: a live credential in a Zustand
 * store shows up in every devtools snapshot for the rest of the session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  LlmProvider: {
    list: vi.fn(() => Promise.resolve([])),
    rotateProxyToken: vi.fn(() =>
      Promise.resolve({
        plaintext_api_key: 'sk-local-newtoken',
        provider: { id: 'p-1', name: 'Local', provider_type: 'local' },
      }),
    ),
  },
  LlmModel: {
    validate: vi.fn(() => Promise.resolve({ queued: false, valid: true })),
  },
}))

const bus = vi.hoisted(() => {
  const map = new Map<string, Set<(p?: unknown) => void>>()
  return {
    on: (event: string, handler: (p?: unknown) => void) => {
      let s = map.get(event)
      if (!s) {
        s = new Set()
        map.set(event, s)
      }
      s.add(handler)
      return () => s?.delete(handler)
    },
    removeGroupListeners: () => {
      /* noop */
    },
    clear: () => map.clear(),
  }
})

vi.mock('@/api-client', () => ({ ApiClient: apiMock }))
vi.mock('@ziee/framework/stores', () => ({
  Stores: {},
  createStoreProxy: () => ({}),
  registerLazyStore: () => ({}),
}))
vi.mock('@ziee/framework/events', () => ({
  useEventBusStore: {
    getState: () => ({
      on: bus.on,
      removeGroupListeners: bus.removeGroupListeners,
    }),
  },
}))
vi.mock('@/modules/llm-provider/events', () => ({
  emitLlmProviderUpdated: vi.fn(() => Promise.resolve()),
}))

import { useLlmProviderStore } from './llmProvider'

const store = () => useLlmProviderStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  bus.clear()
  useLlmProviderStore.setState({
    providers: [
      {
        id: 'p-1',
        name: 'Local',
        provider_type: 'local',
        llm_models: [{ id: 'm-1', name: 'qwen' }],
      },
    ],
    isInitialized: true,
    loading: false,
    creating: false,
    updating: false,
    deleting: false,
    llmModelsLoading: {},
    modelError: {},
    llmModelOperations: {},
    discoveredModels: {},
    discoverNotes: {},
    discoverLoading: {},
    refreshingModels: {},
    rotatingProxyToken: {},
    validatingModels: {},
    error: null,
  } as never)
})

describe('LlmProvider.rotateProxyToken', () => {
  it('returns the new plaintext token to the caller', async () => {
    expect(await store().rotateProxyToken('p-1')).toBe('sk-local-newtoken')
    expect(apiMock.LlmProvider.rotateProxyToken).toHaveBeenCalledWith({
      provider_id: 'p-1',
    })
  })

  it('never persists the plaintext token into store state', async () => {
    await store().rotateProxyToken('p-1')
    // A whole-state scan, not a field check: the point is that the secret is
    // nowhere in the store, however a future refactor might route it.
    expect(JSON.stringify(store())).not.toContain('sk-local-newtoken')
  })

  it('merges the returned provider without dropping its loaded models', async () => {
    await store().rotateProxyToken('p-1')
    const p = store().providers[0]
    expect(p.id).toBe('p-1')
    expect(p.llm_models).toEqual([{ id: 'm-1', name: 'qwen' }])
    expect(store().rotatingProxyToken['p-1']).toBe(false)
  })

  it('clears the in-flight flag and records the error on failure', async () => {
    apiMock.LlmProvider.rotateProxyToken.mockRejectedValueOnce(
      new Error('rotate boom'),
    )
    await expect(store().rotateProxyToken('p-1')).rejects.toThrow('rotate boom')
    expect(store().rotatingProxyToken['p-1']).toBe(false)
    expect(store().error).toBe('rotate boom')
  })
})

describe('LlmProvider.validateLlmModel', () => {
  it('narrows the remote provider verdict', async () => {
    expect(await store().validateLlmModel('m-1')).toEqual({
      queued: false,
      valid: true,
      message: undefined,
    })
  })

  it('narrows the local provider QUEUED response without inventing a verdict', async () => {
    // A queued local check has no verdict yet — reporting `valid` here would
    // tell the admin the model works before anything has probed it.
    apiMock.LlmModel.validate.mockResolvedValueOnce({
      queued: true,
      tier: 'tier3',
      message: 'Local model validation queued; watch validation_status.',
    } as never)
    const r = await store().validateLlmModel('m-1')
    expect(r.queued).toBe(true)
    expect(r.valid).toBeUndefined()
    expect(r.message).toContain('queued')
  })

  it('tolerates a malformed body instead of throwing', async () => {
    // The endpoint is typed `unknown` by the generator (the handler returns a
    // raw JSON value), so the narrowing must not assume any field exists.
    apiMock.LlmModel.validate.mockResolvedValueOnce(null as never)
    expect(await store().validateLlmModel('m-1')).toEqual({
      queued: false,
      valid: undefined,
      message: undefined,
    })
  })

  it('clears the in-flight flag and records the error on failure', async () => {
    apiMock.LlmModel.validate.mockRejectedValueOnce(new Error('validate boom'))
    await expect(store().validateLlmModel('m-1')).rejects.toThrow(
      'validate boom',
    )
    expect(store().validatingModels['m-1']).toBe(false)
    expect(store().error).toBe('validate boom')
  })
})
