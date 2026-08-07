/**
 * RuntimeModelUsage — the local-runtime recovery + diagnostics actions.
 *
 * `clear-failed` is the one that matters: `auto_start` gives up after 5 crashes
 * in 60s and latches the model `failed`, and the endpoint that clears that latch
 * had no frontend call site — so a model that flapped once was stuck until the
 * whole server was restarted. `status` and `health` had none either, which is
 * why the row could not tell "never started" from "gave up".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  LocalRuntime: {
    getStatus: vi.fn(() =>
      Promise.resolve({ model_id: 'm-1', status: 'failed' }),
    ),
    healthCheck: vi.fn(() =>
      Promise.resolve({ healthy: true, response_time_ms: 12 }),
    ),
    clearFailed: vi.fn(() =>
      Promise.resolve({ cleared: true, model_id: 'm-1', state: 'stopped' }),
    ),
  },
  RuntimeVersion: {
    usage: vi.fn(() => Promise.resolve({ versions: [] })),
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
vi.mock('@/core/permissions', () => ({ hasPermissionNow: () => true }))
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
vi.mock('../../events/emitters', () => ({
  emitRuntimeModelUsageChanged: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/modules/llm-local-runtime/events/emitters', () => ({
  emitRuntimeModelUsageChanged: vi.fn(() => Promise.resolve()),
}))

import { useRuntimeModelUsageStore } from './runtimeModelUsage'

const store = () => useRuntimeModelUsageStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  bus.clear()
  useRuntimeModelUsageStore.setState({
    usage: new Map(),
    loading: new Map(),
    acting: new Map(),
    instances: new Map(),
    statuses: new Map(),
    health: new Map(),
    error: null,
  })
})

describe('RuntimeModelUsage.loadStatus', () => {
  it('records the runtime STATE the usage snapshot cannot express', async () => {
    const s = await store().loadStatus('m-1')
    expect(apiMock.LocalRuntime.getStatus).toHaveBeenCalledWith({
      model_id: 'm-1',
    })
    expect(s.status).toBe('failed')
    expect(store().statuses.get('m-1')?.status).toBe('failed')
    // `_act` must release the per-model busy flag or the row's buttons latch.
    expect(store().acting.get('m-1')).toBeUndefined()
  })
})

describe('RuntimeModelUsage.checkHealth', () => {
  it('records the probe result per model', async () => {
    const h = await store().checkHealth('m-1')
    expect(h.healthy).toBe(true)
    expect(store().health.get('m-1')?.response_time_ms).toBe(12)
    expect(store().acting.get('m-1')).toBeUndefined()
  })

  it('surfaces a failed probe and still releases the busy flag', async () => {
    apiMock.LocalRuntime.healthCheck.mockRejectedValueOnce(
      new Error('health boom'),
    )
    await expect(store().checkHealth('m-1')).rejects.toThrow('health boom')
    expect(store().error).toBe('health boom')
    expect(store().acting.get('m-1')).toBeUndefined()
  })
})

describe('RuntimeModelUsage.clearFailed', () => {
  it('calls the recovery endpoint and returns the server verdict', async () => {
    const r = await store().clearFailed('llamacpp', 'm-1')
    expect(apiMock.LocalRuntime.clearFailed).toHaveBeenCalledWith({
      model_id: 'm-1',
    })
    expect(r.cleared).toBe(true)
  })

  it('re-reads status afterwards so the row stops showing "failed"', async () => {
    // Without the re-read the latch is gone server-side while the UI keeps
    // offering "Clear failed state" — the exact confusion the control exists
    // to remove.
    apiMock.LocalRuntime.getStatus.mockResolvedValueOnce({
      model_id: 'm-1',
      status: 'stopped',
    })
    await store().clearFailed('llamacpp', 'm-1')
    expect(apiMock.LocalRuntime.getStatus).toHaveBeenCalled()
    expect(store().statuses.get('m-1')?.status).toBe('stopped')
  })

  it('reports a no-op honestly when the model was not failed', async () => {
    apiMock.LocalRuntime.clearFailed.mockResolvedValueOnce({
      cleared: false,
      model_id: 'm-1',
      state: 'running',
    })
    expect((await store().clearFailed('llamacpp', 'm-1')).cleared).toBe(false)
  })
})
