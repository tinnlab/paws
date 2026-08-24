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

/**
 * FB-12 — what the CONSUMER sees, not what the server wrote.
 *
 * The server record was provably correct during a live 5.68 GB transfer
 * (queried straight out of the running instance's embedded Postgres:
 * `current: 5637699037, total: 5680522464, speed_bps: 1606723`), yet both the
 * onboarding step and the LLM-providers view showed 0% and "0 bytes / 0 bytes".
 *
 * The SSE payload is FLAT — `current`/`total`/`speed_bps`/`eta_seconds` sit at
 * the top level of `DownloadProgressUpdate` — while every UI renders
 * `progress_data.*`. The handler did `{ ...download, ...update }`, which grafts
 * stray top-level keys on and leaves `progress_data` untouched. An
 * `as DownloadInstance` cast kept the compiler quiet.
 *
 * These assert the rendered shape, because that is the property that failed.
 * The earlier FB-5 test asserted the WRITE, and the write was never the
 * problem — which is exactly why the bug survived a "fixed" round.
 */
describe('subscribeToDownloadProgress delivers progress the UI can render', () => {
  const ROW = {
    id: 'dl-1',
    provider_id: 'prov-1',
    status: 'downloading',
    progress_data: {
      phase: 'downloading',
      current: 0,
      total: 0,
      message: '',
      speed_bps: 0,
      eta_seconds: 0,
    },
  }

  /** Drive the real handler's `update` callback with SSE frames. */
  async function deliver(frames: Record<string, unknown>[][], initial = ROW) {
    const h = harness()
    h.state.downloads = [{ ...initial, progress_data: { ...initial.progress_data } }]
    subscribeDownloadProgress.mockImplementation(
      async (_b: unknown, opts: { SSE: Record<string, (...a: never[]) => void> }) => {
        for (const frame of frames) opts.SSE.update?.(frame as never)
      },
    )
    await makeSubscribe(h.set, h.get)()
    return h.state.downloads[0] as { progress_data: Record<string, number | string> }
  }

  it('exposes advancing BYTES on progress_data, which is what the views render', async () => {
    const row = await deliver([
      [{ id: 'dl-1', status: 'downloading', current: 1_000_000, total: 5_680_522_464 }],
      [{ id: 'dl-1', status: 'downloading', current: 2_500_000, total: 5_680_522_464 }],
    ])
    expect(
      row.progress_data.current,
      'the view reads progress_data.current — a flat spread leaves it at 0 and the bar sits at 0%',
    ).toBe(2_500_000)
    expect(row.progress_data.total).toBe(5_680_522_464)
  })

  it('carries speed and ETA through, so "slow" is distinguishable from "hung"', async () => {
    const row = await deliver([
      [
        {
          id: 'dl-1',
          status: 'downloading',
          current: 5_637_699_037,
          total: 5_680_522_464,
          speed_bps: 1_606_723,
          eta_seconds: 26,
          message: 'Downloading model weights — 5.64 GB of 5.68 GB',
        },
      ],
    ])
    expect(row.progress_data.speed_bps).toBe(1_606_723)
    expect(row.progress_data.eta_seconds).toBe(26)
    expect(row.progress_data.message).toContain('5.64 GB')
  })

  it('a null field does not blank a figure already known', async () => {
    // The server sends these as Option; a frame omitting the rate must not
    // reset a rate the user could already see.
    const row = await deliver([
      [{ id: 'dl-1', status: 'downloading', current: 10, total: 100, speed_bps: 4242 }],
      [{ id: 'dl-1', status: 'downloading', current: 20, total: 100, speed_bps: null }],
    ])
    expect(row.progress_data.current).toBe(20)
    expect(row.progress_data.speed_bps).toBe(4242)
  })
})
