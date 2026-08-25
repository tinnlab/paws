/**
 * TEST-6 — the chat-stream subscription must not fail SILENTLY.
 *
 * `PUT /api/chat/stream/subscription` is the only thing that scopes a chat-token
 * connection to a conversation (`chat/stream/handler.rs`); until it lands,
 * `publish_frame` matches no connection and every live token is dropped at the
 * registry while the reply persists normally.
 *
 * The reported bug took the REJECTION path, not the status path: the desktop
 * webview is cross-origin to the embedded server, the CORS allow-list omitted
 * `X-Chat-Stream-Connection-Id`, so the browser refused the preflight and
 * `fetch` REJECTED. Measured in the real engine the app ships (webkit2gtk
 * 2.50.4, driven via MiniBrowser): the page sees `TypeError: Load failed` and
 * the server logs no request at all. That missed the `!resp.ok` branch entirely
 * and landed in a `catch` that only `console.warn`ed — so the connection sat
 * open and healthy, scoped to nothing, forever.
 *
 * These drive the real `createChatStreamClient`, including its real reconnect
 * loop (fake timers advance the backoff) and its real abort handling (the
 * stalled stream read rejects on abort, exactly as an aborted `fetch` body
 * does) — not a re-implementation of either.
 *
 * Named `*.store.test.ts` because that (plus `*.test.tsx`) is vitest's include
 * glob in this workspace (`vitest.config.ts`); a plain `*.test.ts` runs under
 * `node --test`, which has no `vi.mock`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthToken = vi.hoisted(() => vi.fn(() => 'test-token'))
const getBaseUrl = vi.hoisted(() => vi.fn(async () => 'http://127.0.0.1:8082'))

vi.mock('@ziee/framework/api-client/core', () => ({ getAuthToken, getBaseUrl }))
vi.mock('@ziee/framework/events/store', () => ({
  useEventBusStore: { getState: () => ({ emit: async () => undefined }) },
}))

import { createChatStreamClient, SUBSCRIPTION_ERROR_MESSAGE } from './ChatStreamClient'

const SUBSCRIPTION_URL = 'http://127.0.0.1:8082/api/chat/stream/subscription'
const STREAM_URL = 'http://127.0.0.1:8082/api/chat/stream'

/**
 * An SSE response that yields the `connected` handshake and then stays open —
 * and, like a real `fetch` body, fails its pending read once the request is
 * aborted. Without that the client's reconnect loop could never turn over and
 * the test would be measuring its own harness.
 */
function connectedStream(connectionId: string, signal: AbortSignal): Response {
  const frame = `event: connected\ndata: ${JSON.stringify({ connectionId })}\n\n`
  let sent = false
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => {
          if (!sent) {
            sent = true
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode(frame),
            })
          }
          return new Promise((_resolve, reject) => {
            const fail = () => reject(new DOMException('aborted', 'AbortError'))
            if (signal.aborted) fail()
            else signal.addEventListener('abort', fail)
          })
        },
      }),
    },
  } as unknown as Response
}

interface Rig {
  fetchMock: ReturnType<typeof vi.fn>
  putAttempts: () => number
}

/** @param subscriptionOutcome what the subscription PUT does on each attempt. */
function rig(subscriptionOutcome: () => Promise<Response>): Rig {
  let puts = 0
  const fetchMock = vi.fn(
    async (url: string, init?: { signal?: AbortSignal }) => {
      if (url === SUBSCRIPTION_URL) {
        puts += 1
        return await subscriptionOutcome()
      }
      if (url === STREAM_URL) return connectedStream('conn-1', init!.signal!)
      throw new Error(`unexpected fetch ${url}`)
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, putAttempts: () => puts }
}

/**
 * Advance far enough for `n` connect → handshake → PUT cycles. The client backs
 * off 1s, 2s, 4s… between reconnects, so this walks (fake) time forward rather
 * than only flushing microtasks.
 */
async function runCycles(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2 ** i * 1000 + 100)
  }
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  getAuthToken.mockReturnValue('test-token')
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TEST-6: a subscription that cannot be established is reported', () => {
  it('reports onSubscriptionError after the consecutive-failure limit when fetch REJECTS', async () => {
    // The CORS-preflight-refusal shape: a rejection, NOT a status.
    const r = rig(async () => {
      throw new TypeError('Load failed')
    })
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await runCycles(5)

    expect(r.putAttempts()).toBeGreaterThanOrEqual(3)
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/live updates/i)
    client.stop()
  })

  it('reports it for a non-2xx too — the same condition, differently spelled', async () => {
    const r = rig(async () => ({ ok: false, status: 429 }) as Response)
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await runCycles(5)

    expect(r.putAttempts()).toBeGreaterThanOrEqual(3)
    expect(errors.length).toBe(1)
    client.stop()
  })

  it('does not report once per retry, but DOES stay able to report again', async () => {
    // The first version of this test asserted `errors.length === 1` after seven
    // cycles, and that assertion is what hid the real defect (audit FIX-1): the
    // client reported on `failures === LIMIT` exactly, so under a permanently
    // broken subscription it went silent forever after the first banner. Since
    // `sendMessage` clears `error` and sets `isStreaming: true` at the start of
    // every turn, the SECOND message then reverted to the exact infinite spinner
    // this whole branch exists to remove.
    //
    // Both properties matter, so both are asserted: far fewer reports than
    // attempts (no banner storm), and strictly more than one (it re-arms).
    const r = rig(async () => {
      throw new TypeError('Load failed')
    })
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await runCycles(14)

    const attempts = r.putAttempts()
    expect(attempts).toBeGreaterThan(8)
    expect(errors.length).toBeGreaterThan(1)
    expect(errors.length).toBeLessThan(attempts / 2)
    client.stop()
  })

  it('the message it reports is one the client can always truthfully say', async () => {
    // "The reply is still being generated" is the STORE's knowledge, not the
    // client's — and the most common trigger is opening a conversation with
    // nothing generating at all, where it would be false (audit FIX-3).
    rig(async () => {
      throw new TypeError('Load failed')
    })
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await runCycles(5)

    // Compared against the exported constant, not a re-spelled copy — a second
    // literal here is what would let a reword pass while the clear path silently
    // stopped matching (audit round 3).
    expect(errors[0]).toBe(SUBSCRIPTION_ERROR_MESSAGE)
    expect(errors[0]).not.toMatch(/still being generated/i)
    client.stop()
  })

  it('does NOT re-report for an unsubscribe', async () => {
    // `setActiveConversation(null)` is `reset`'s unsubscribe. Reporting there
    // raised a banner the same action wiped microseconds later, while still
    // advancing the counter — pushing the next VISIBLE report out by another
    // interval and making the flow worse (audit round 4).
    rig(async () => {
      throw new TypeError('Load failed')
    })
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await runCycles(5)
    const before = errors.length
    expect(before).toBeGreaterThanOrEqual(1)

    await client.setActiveConversation(null)
    expect(errors.length).toBe(before)
    client.stop()
  })

  it('re-reports when a turn starts on a DIFFERENT conversation too', async () => {
    // The per-turn re-arm first covered only the same-conversation early return,
    // so the FIRST turn after New-chat or a conversation switch — on a stream
    // already known to be broken — was still silent for minutes (audit round 3).
    rig(async () => {
      throw new TypeError('Load failed')
    })
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await runCycles(5)
    const before = errors.length
    expect(before).toBeGreaterThanOrEqual(1)

    await client.setActiveConversation('a-different-conversation')
    expect(errors.length).toBe(before + 1)
    client.stop()
  })

  it('re-reports when a NEW TURN starts on the same conversation', async () => {
    // The gap the modulo alone cannot close (audit round 2). `sendMessage` sets
    // `error: null` at the start of every turn and then calls
    // `setActiveConversation(sameId)`. That early-returned, so on a
    // known-broken stream the banner was destroyed by the very turn it was
    // warning about, and the connect loop's next report was up to
    // REREPORT_EVERY x 30s away — i.e. minutes of the exact silent spinner
    // INV-4 exists to remove, on EVERY turn.
    rig(async () => {
      throw new TypeError('Load failed')
    })
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await client.setActiveConversation('conv-1')
    await runCycles(5)

    const afterFirstReport = errors.length
    expect(afterFirstReport).toBeGreaterThanOrEqual(1)

    // A new turn on the SAME conversation — the early-return path.
    await client.setActiveConversation('conv-1')
    expect(errors.length).toBe(afterFirstReport + 1)
    client.stop()
  })

  it('recovery is NOT reported for a bare unsubscribe', async () => {
    // A 204 for `conversation_id: null` is the fresh-handshake unsubscribe. It
    // says nothing about whether the stream can be SCOPED, so clearing the
    // banner on it would be a false all-clear (audit round 3).
    let failuresLeft = 4
    const errors: string[] = []
    const recovered: number[] = []
    rig(async () => {
      if (failuresLeft-- > 0) throw new TypeError('Load failed')
      return { ok: true, status: 204 } as Response
    })
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
      onSubscriptionRecovered: () => recovered.push(1),
    })
    client.start()
    await runCycles(8)

    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(recovered, 'no conversation was ever scoped').toEqual([])
    client.stop()
  })

  it('a blip SHORTER than the limit stays silent, then recovers quietly', async () => {
    // The design says "a transient blip shorter than three attempts stays
    // silent". Nothing tested it (audit round 2), and a limit of 2 would have
    // passed every other case here.
    let failuresLeft = 2
    const errors: string[] = []
    const recovered: number[] = []
    rig(async () => {
      if (failuresLeft-- > 0) throw new TypeError('Load failed')
      return { ok: true, status: 204 } as Response
    })
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
      onSubscriptionRecovered: () => recovered.push(1),
    })
    client.start()
    await runCycles(6)

    expect(errors, 'two failures must not raise a banner').toEqual([])
    // …and nothing to recover from, so no spurious clear either.
    expect(recovered).toEqual([])
    client.stop()
  })

  it('reports recovery once the subscription succeeds again', async () => {
    // Without this the banner outlives the outage: nothing else clears `error`.
    let failuresLeft = 4
    const errors: string[] = []
    const recovered: number[] = []
    rig(async () => {
      if (failuresLeft-- > 0) throw new TypeError('Load failed')
      return { ok: true, status: 204 } as Response
    })
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
      onSubscriptionRecovered: () => recovered.push(1),
    })
    client.start()
    // Scoped to a real conversation: recovery is deliberately NOT reported for a
    // bare `conversation_id: null` unsubscribe, which proves nothing about
    // delivery (audit round 3).
    await client.setActiveConversation('conv-1')
    await runCycles(8)

    expect(errors.length, 'the outage must have been reported').toBeGreaterThanOrEqual(1)
    expect(recovered.length, 'and the recovery must be reported too').toBe(1)
    client.stop()
  })

  it('NEGATIVE CONTROL: a healthy subscription reports nothing', async () => {
    // The fix must not be "always report". A 204 must stay silent, or every
    // normal conversation switch would raise an error banner.
    const r = rig(async () => ({ ok: true, status: 204 }) as Response)
    const errors: string[] = []
    const client = createChatStreamClient({
      onSubscriptionError: (m) => errors.push(m),
    })
    client.start()
    await runCycles(1)
    await client.setActiveConversation('conv-ok')
    await vi.advanceTimersByTimeAsync(0)

    expect(r.putAttempts()).toBeGreaterThanOrEqual(1)
    expect(errors).toEqual([])
    client.stop()
  })

  it('sends the connection-id header the server keys the subscription on', async () => {
    // If this header is ever dropped (or renamed without updating the CORS
    // allow-list), the subscription is unreachable — which is the whole bug.
    const r = rig(async () => ({ ok: true, status: 204 }) as Response)
    const client = createChatStreamClient({})
    client.start()
    await runCycles(1)

    const put = r.fetchMock.mock.calls.find(([url]) => url === SUBSCRIPTION_URL)
    expect(put, 'the client must PUT the subscription').toBeTruthy()
    const init = put![1] as { method: string; headers: Record<string, string> }
    expect(init.method).toBe('PUT')
    expect(init.headers['X-Chat-Stream-Connection-Id']).toBe('conn-1')
    client.stop()
  })
})
