/**
 * The rootfs install-progress SSE subscription's RECONNECT ACCOUNTING.
 *
 * Regression under test: the api-client dispatches the `__init` SSE callback as
 * soon as `fetch()` resolves and BEFORE it checks `response.ok`, so a failing
 * status (the live rig served 503 for two days) reached `__init` too. `__init`
 * reset `reconnectAttempts` to 0, the catch then took it 0 → 1, and 1 is
 * forever below `maxReconnectAttempts` — so the "bounded" reconnect never
 * terminated and re-hit the endpoint every `reconnectDelayMs` for as long as
 * the settings page stayed mounted.
 *
 * These tests drive the ACTION closure against a fake transport that reproduces
 * that exact ordering, so they fail on the pre-fix code rather than merely
 * describing it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const subscribeRootfsInstallProgress = vi.hoisted(() => vi.fn())

vi.mock('@/api-client', () => ({
  ApiClient: {
    CodeSandbox: { subscribeRootfsInstallProgress },
  },
}))

import { sseState } from './_sse'
import makeSubscribe, { setSubscribeWires } from './actions/subscribeToInstallProgress'

/** immer-style `set` that just runs the recipe against a scratch draft. */
const noopSet = ((recipe: (s: Record<string, unknown>) => void) => {
  recipe({ actions: {}, installTasks: {} })
}) as never

/** A transport that fires `__init` (as the real one does, pre-status-check) and
 *  then rejects with the given HTTP status. */
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
  subscribeRootfsInstallProgress.mockReset()
  sseState.controller = null
  sseState.reconnectTimer = null
  sseState.reconnectAttempts = 0
  setSubscribeWires({ loadStatus: async () => undefined, self: async () => undefined })
})

afterEach(() => {
  if (sseState.reconnectTimer) clearTimeout(sseState.reconnectTimer)
  sseState.reconnectTimer = null
  vi.useRealTimers()
})

describe('subscribeToInstallProgress reconnect accounting', () => {
  it('accumulates the attempt count across consecutive 503s', async () => {
    // Counting ONE failure is not discriminating: pre-fix the counter also read
    // 1 after a single attempt (reset to 0 in `__init`, then +1 in the catch).
    // It is the SECOND consecutive failure that separates the two behaviours —
    // pre-fix it read 1 again, which is why the budget was never spent.
    subscribeRootfsInstallProgress.mockImplementation(transportFailingWith(503))
    const subscribe = makeSubscribe(noopSet)

    await subscribe()
    expect(sseState.reconnectAttempts).toBe(1)

    // Clear the scheduled retry so the re-entry guard lets the next call through.
    if (sseState.reconnectTimer) clearTimeout(sseState.reconnectTimer)
    sseState.reconnectTimer = null
    await subscribe()

    expect(sseState.reconnectAttempts).toBe(2)
  })

  it('gives up after maxReconnectAttempts instead of reconnecting forever', async () => {
    subscribeRootfsInstallProgress.mockImplementation(transportFailingWith(503))
    // `self` is what the reconnect timer calls; wire it to the real action so
    // the retry chain runs exactly as it does in the app.
    const subscribe = makeSubscribe(noopSet)
    setSubscribeWires({ loadStatus: async () => undefined, self: subscribe })

    await subscribe()
    // Drain the scheduled retries. Each attempt schedules the next one only
    // while under the cap; a run that never terminates would keep producing a
    // pending timer here forever.
    for (let i = 0; i < sseState.maxReconnectAttempts + 3; i++) {
      if (!sseState.reconnectTimer) break
      await vi.advanceTimersByTimeAsync(sseState.reconnectDelayMs)
    }

    expect(sseState.reconnectTimer).toBeNull()
    expect(subscribeRootfsInstallProgress).toHaveBeenCalledTimes(sseState.maxReconnectAttempts)
  })

  it('resets the counter on the server handshake, so a real reconnect is not penalised', async () => {
    // Negative control: the fix must not amount to "never reset". A stream that
    // genuinely connects (the server's `connected` event, reachable only on a
    // 200) has to clear the backoff, or a long-lived page would exhaust its
    // budget across unrelated disconnects and stop reconnecting for good.
    sseState.reconnectAttempts = 3
    subscribeRootfsInstallProgress.mockImplementation(
      async (_b: unknown, opts: { SSE: Record<string, (...a: never[]) => void> }) => {
        opts.SSE.__init?.({ abortController: new AbortController() } as never)
        opts.SSE.connected?.({} as never)
      },
    )

    await makeSubscribe(noopSet)()

    expect(sseState.reconnectAttempts).toBe(0)
  })
})
