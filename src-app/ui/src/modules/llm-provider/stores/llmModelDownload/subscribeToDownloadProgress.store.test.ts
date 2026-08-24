/**
 * The model-download SSE subscription's RECONNECT ACCOUNTING.
 *
 * Same defect, same shape as the code-sandbox rootfs stream (see
 * `sandboxRootfsVersions/subscribeToInstallProgress.store.test.ts`): the
 * api-client fires the `__init` SSE callback as soon as `fetch()` resolves and
 * BEFORE checking `response.ok`, so a failing status reached `__init` — which
 * marked the stream connected and zeroed `reconnectAttempts`. The catch then
 * took it 0 → 1, forever short of the 5-attempt cap, so the reconnect never
 * terminated. Covered here too because a fix applied to only one of two
 * identical call sites leaves the other silently broken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const subscribeDownloadProgress = vi.hoisted(() => vi.fn())

vi.mock('@/api-client', () => ({
  ApiClient: { LlmModel: { subscribeDownloadProgress } },
}))
// Boundary stubs: this action imports sibling stores + event emitters at module
// load. None participate in the reconnect accounting under test.
vi.mock('@/modules/llm-provider/stores/llmProvider', () => ({
  useLlmProviderStore: { getState: () => ({ loadModelsForProvider: async () => undefined }) },
}))
vi.mock('@/modules/llm-provider/stores/llmModelDownload', () => ({
  useLlmModelDownloadStore: { getState: () => ({ disconnectSSE: async () => undefined }) },
}))
vi.mock('@/modules/llm-provider/events/emitters', () => ({
  emitLlmModelDownloadCompleted: async () => undefined,
  emitLlmModelDownloadFailed: async () => undefined,
}))
vi.mock('./actions/_loadExistingDownloads', () => ({
  default: () => async () => undefined,
}))

import makeSubscribe from './actions/subscribeToDownloadProgress'

type State = { downloads: unknown[]; sseConnected: boolean; sseError: string | null; reconnectAttempts: number }

/** Minimal store harness matching the action's (set, get) contract. */
function harness() {
  const state: State = { downloads: [], sseConnected: false, sseError: null, reconnectAttempts: 0 }
  const get = (() => state) as never
  const set = ((patch: Partial<State> | ((s: State) => Partial<State> | void)) => {
    const next = typeof patch === 'function' ? patch(state) : patch
    if (next) Object.assign(state, next)
  }) as never
  return { state, get, set }
}

function transportFailingWith(status: number) {
  return async (_body: unknown, opts: { SSE: Record<string, (...a: never[]) => void> }) => {
    opts.SSE.__init?.({ abortController: new AbortController() } as never)
    const err = new Error(`HTTP error! status: ${status}`) as Error & { status: number }
    err.status = status
    throw err
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  subscribeDownloadProgress.mockReset()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('subscribeToDownloadProgress reconnect accounting', () => {
  it('accumulates the attempt count across consecutive failures', async () => {
    subscribeDownloadProgress.mockImplementation(transportFailingWith(503))
    const { state, get, set } = harness()
    const subscribe = makeSubscribe(set, get)

    await subscribe()
    expect(state.reconnectAttempts).toBe(1)
    await subscribe()

    // Pre-fix this read 1 again: `__init` reset the counter on every failed
    // attempt, so the cap was unreachable and the retry loop never stopped.
    expect(state.reconnectAttempts).toBe(2)
  })

  it('does not report the stream as connected when the request failed', async () => {
    subscribeDownloadProgress.mockImplementation(transportFailingWith(502))
    const { state, get, set } = harness()

    await makeSubscribe(set, get)()

    expect(state.sseConnected).toBe(false)
  })

  it('marks connected and clears the backoff on the server handshake', async () => {
    // Negative control: the fix must not be "never mark connected". A real 200
    // stream still has to flip the flag, or the re-entry guard would let every
    // caller open a duplicate stream.
    subscribeDownloadProgress.mockImplementation(
      async (_b: unknown, opts: { SSE: Record<string, (...a: never[]) => void> }) => {
        opts.SSE.__init?.({ abortController: new AbortController() } as never)
        opts.SSE.connected?.({} as never)
      },
    )
    const { state, get, set } = harness()
    state.reconnectAttempts = 3

    await makeSubscribe(set, get)()

    expect(state.sseConnected).toBe(true)
    expect(state.reconnectAttempts).toBe(0)
  })
})
