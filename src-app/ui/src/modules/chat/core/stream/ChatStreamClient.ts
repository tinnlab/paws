import { getAuthToken, getBaseUrl } from '@ziee/framework/api-client/core'
import type { ChatStreamFrame, SSEChatStreamEvent } from '@/api-client/types'
import { useEventBusStore } from '@ziee/framework/events/store'
import './types'

// Live chat-token SSE client. A thin bridge (mirrors `core/sync/SyncClient`):
// opens the per-user `GET /api/chat/stream` and re-emits each generation frame
// onto the client EventBus as `chat:token` (`{conversation_id, event}`). The
// Chat store routes it. The device tells the server WHICH conversation's tokens
// it wants via `setActiveConversation` (a `PUT` echoing the handshake
// connection id), so the stream is server-scoped to the open conversation.
//
// This lives under the chat module (NOT `core/`) because it serves only chat;
// `core/sync` stays in core because it is cross-cutting across every entity.
//
// PER-INSTANCE (ITEM-6): `createChatStreamClient()` returns an INDEPENDENT client
// — its own connection, epoch, backoff, connection-id and subscribed
// conversation. Each split pane owns one, so two panes never fight over a single
// `desiredConversationId` (each holds a dedicated connection scoped to its own
// conversation; the backend registry supports N connections per user). The
// single-pane / primary-pane store creates exactly one, so its behaviour is
// unchanged.

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const STABLE_AFTER_MS = 3_000
// Consecutive failed subscription PUTs before the owner is told the stream is
// undeliverable. The connect loop keeps retrying underneath with the backoff
// above, so this only decides WHEN the user is told — hence a small number: at
// 1s/2s/4s the report lands within ~7s of a hard failure, while a single
// transient blip stays silent. Fixed constant, alongside its three neighbours
// (DEC-4).
const SUBSCRIPTION_FAILURE_LIMIT = 3
// After the first report, re-report every N FURTHER consecutive failures, so a
// permanently-undeliverable stream can say so again on the next turn instead of
// going quiet forever (audit FIX-1). By the time this matters the connect loop's
// backoff has saturated at MAX_BACKOFF_MS, so 5 further failures is minutes
// apart — loud enough to be seen, far too slow to be a banner storm.
const SUBSCRIPTION_REREPORT_EVERY = 5
/**
 * What the client knows and can always truthfully say. Deliberately NOT
 * "the reply is still being generated": whether a turn is in flight is the
 * STORE's knowledge, not this client's, and the most common trigger is a
 * conversation being opened with nothing generating at all. The store appends
 * the situational advice.
 */
const SUBSCRIPTION_ERROR_MESSAGE =
  'Live updates are not reaching this conversation.'

/** An independent chat-token SSE client bound to one conversation at a time. */
export interface ChatStreamClient {
  /** Start the stream (idempotent). Call when a user is authenticated. */
  start(): void
  /** Stop the stream. Call on logout / user-switch / pane teardown. */
  stop(): void
  /** Scope this client's stream to one conversation (or `null` for none). */
  setActiveConversation(conversationId: string | null): Promise<void>
}

/**
 * Handlers a pane's store wires to ITS client (ITEM-35). Frames are delivered
 * DIRECTLY to the owning pane instead of the global `chat:token` EventBus, so two
 * panes on the SAME conversation (compare-two-branches) each process only their
 * own connection's frames — the global bus made both stores apply BOTH clients'
 * frames, doubling/garbling live text. Omit them (single-pane legacy) → the
 * client falls back to the global EventBus emit, unchanged.
 */
export interface ChatStreamHandlers {
  onFrame?: (conversationId: string, event: unknown) => void
  onReconnect?: () => void
  /**
   * The stream could not be SCOPED to a conversation after
   * `SUBSCRIPTION_FAILURE_LIMIT` consecutive attempts, so no live token can ever
   * arrive on it. Reported at the limit and then every
   * `SUBSCRIPTION_REREPORT_EVERY` further consecutive failures; a success resets
   * the count. It re-arms rather than firing once because the next turn clears
   * the banner and re-enters the spinning state (see
   * `onSubscriptionAttemptFailed`).
   *
   * This exists because the failure it reports was previously SILENT. A CORS
   * preflight refusal makes `fetch` REJECT — a network error, not a status — so
   * it missed the `!resp.ok` branch below and landed in a `catch` that only
   * logged a warning. The connection then sat open and healthy, scoped to
   * nothing, forever: `publish_frame` matched no connection, `applyStreamFrame`
   * never saw `complete`, `isStreaming` never cleared, and `reloadOpen` bails
   * while it is true — so the pane could not even self-heal. The user saw a
   * spinner that only a page reload resolved.
   */
  onSubscriptionError?: (message: string) => void
  /**
   * A subscription succeeded after `onSubscriptionError` had fired, so delivery
   * is working again. Without this the banner outlives the condition: a
   * transient outage that reached the limit leaves the user staring at "live
   * updates are not reaching this conversation" on a conversation that is now
   * receiving them (audit round 2).
   */
  onSubscriptionRecovered?: () => void
}

/** Create an independent chat-token SSE client (see the per-instance note). */
export function createChatStreamClient(
  handlers?: ChatStreamHandlers,
): ChatStreamClient {
  let started = false
  let epoch = 0
  let activeAbort: AbortController | null = null
  let backoffMs = INITIAL_BACKOFF_MS

  // The server-assigned id from the latest `connected` handshake (echoed on the
  // subscription PUT), and the conversation this client currently wants. Both
  // survive reconnects: a new connection re-PUTs the desired subscription.
  let connectionId: string | null = null
  let desiredConversationId: string | null = null
  // Consecutive failed subscription PUTs. Reset by a successful PUT and by
  // `stop()`; see `onSubscriptionAttemptFailed`.
  let subscriptionFailures = 0
  // The failure count at which the owner was last told. `-1` = never told in
  // this run. Compared as a DELTA rather than with `%`: the counter is not
  // guaranteed to advance by exactly one (two `putSubscription` calls can be in
  // flight at once — the handshake fires one while `setActiveConversation` fires
  // another), and a modulo silently SKIPS a report it steps over (audit round 2).
  let lastReportedAtFailure = -1

  function start(): void {
    if (started) return
    started = true
    backoffMs = INITIAL_BACKOFF_MS
    const myEpoch = ++epoch
    void connectLoop(myEpoch)
  }

  function stop(): void {
    started = false
    epoch++
    activeAbort?.abort()
    activeAbort = null
    connectionId = null
    desiredConversationId = null
    subscriptionFailures = 0
    lastReportedAtFailure = -1
  }

  function setActiveConversation(conversationId: string | null): Promise<void> {
    if (desiredConversationId === conversationId) {
      // The store calls this at the start of EVERY turn, and `sendMessage`
      // clears `error` just before it — so on the same conversation this is the
      // moment a known-broken stream must speak up again, or the user spends the
      // whole turn watching a spinner with no banner. The connect loop's own
      // re-report interval cannot cover it: by then the backoff has saturated at
      // 30s, putting the next report up to `REREPORT_EVERY * 30s` away (audit
      // round 2). We cannot usefully re-ATTEMPT here — `connectionId` is null
      // while the loop is mid-backoff — so we re-TELL instead of pretending.
      if (subscriptionFailures >= SUBSCRIPTION_FAILURE_LIMIT) reportSubscriptionFailure()
      return Promise.resolve()
    }
    desiredConversationId = conversationId
    return putSubscription()
  }

  /** Tell the owner delivery is broken, and remember that we did. */
  function reportSubscriptionFailure(): void {
    lastReportedAtFailure = subscriptionFailures
    console.error(
      `[chat-stream] subscription failed ${subscriptionFailures}×; ` +
        'live updates are not reaching this conversation',
    )
    handlers?.onSubscriptionError?.(SUBSCRIPTION_ERROR_MESSAGE)
  }

  /**
   * A subscription attempt failed. Every failure means this connection is NOT
   * scoped to a conversation, so it can never deliver a token — treat them all
   * the same way regardless of whether the transport gave us a status:
   *
   *   - drop the connection id and abort the live stream, so the connect loop
   *     reconnects with a fresh handshake and re-PUTs (the pre-existing non-2xx
   *     behaviour);
   *   - once the failures stop being plausibly transient, TELL SOMEONE — and
   *     keep being able to tell them again.
   *
   * The `catch` half used to only `console.warn`, which is how a permanent,
   * total delivery failure presented as an ordinary spinner.
   *
   * ## Why re-arming matters (audit FIX-1, found by two independent angles)
   *
   * The first version of this reported on `subscriptionFailures === LIMIT`, i.e.
   * exactly once, and the counter only reset on a SUCCESSFUL PUT. For the case
   * this whole invariant exists for — a subscription that can never succeed —
   * the counter climbed past the limit and `=== LIMIT` was never true again. So:
   * the banner appeared once, `sendMessage` then cleared `error` and set
   * `isStreaming: true` at the start of the very next turn, nothing could report
   * again, and the second message reverted to the exact infinite spinner this
   * branch exists to remove. INV-4 held for one occurrence per page load.
   *
   * Re-arming on an interval fixes that without turning the banner into a
   * per-retry storm: the report fires at the limit and then every
   * `SUBSCRIPTION_REREPORT_EVERY` further failures, which — because the connect
   * loop's backoff has saturated at 30s by then — is minutes apart, not seconds.
   */
  function onSubscriptionAttemptFailed(reason: string): void {
    connectionId = null
    activeAbort?.abort()
    subscriptionFailures += 1
    if (subscriptionFailures < SUBSCRIPTION_FAILURE_LIMIT) {
      console.warn(`[chat-stream] subscription failed (${reason}); forcing reconnect`)
      return
    }
    const sinceLastReport = subscriptionFailures - lastReportedAtFailure
    if (lastReportedAtFailure >= 0 && sinceLastReport < SUBSCRIPTION_REREPORT_EVERY) return

    console.warn(`[chat-stream] subscription failure reason: ${reason}`)
    reportSubscriptionFailure()
  }

  async function putSubscription(): Promise<void> {
    if (!connectionId) return // re-sent once the next `connected` handshake lands
    const token = getAuthToken()
    if (!token) return
    const baseUrl = await getBaseUrl()
    try {
      const resp = await fetch(`${baseUrl}/api/chat/stream/subscription`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Chat-Stream-Connection-Id': connectionId,
        },
        body: JSON.stringify({ conversation_id: desiredConversationId }),
      })
      if (!resp.ok) {
        // A non-2xx PUT: a stale connection id, 401, or 429 under the per-user
        // cap.
        onSubscriptionAttemptFailed(`HTTP ${resp.status}`)
        return
      }
      // Recovered. Tell the owner if we had told them it was broken, so a
      // banner cannot outlive the condition it describes.
      if (lastReportedAtFailure >= 0) {
        lastReportedAtFailure = -1
        handlers?.onSubscriptionRecovered?.()
      }
      subscriptionFailures = 0
    } catch (error) {
      // A REJECTION, not a status — the transport never got a response. A CORS
      // preflight refusal lands here (measured: WebKitGTK reports
      // `TypeError: Load failed`), and so does a genuine network drop. The
      // former is permanent and total; the latter clears on reconnect. Both are
      // "this connection is not subscribed", so both take the same path, and the
      // failure COUNT is what distinguishes them.
      onSubscriptionAttemptFailed(String(error))
    }
  }

  async function connectLoop(myEpoch: number): Promise<void> {
    while (started && myEpoch === epoch) {
      try {
        await connectOnce(myEpoch)
      } catch (error) {
        if (!started || myEpoch !== epoch) break
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('[chat-stream] stream ended; reconnecting', error)
        }
      }
      if (!started || myEpoch !== epoch) break
      await delay(backoffMs)
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    }
  }

  async function connectOnce(myEpoch: number): Promise<void> {
    const token = getAuthToken()
    if (!token) return

    const baseUrl = await getBaseUrl()
    if (!started || myEpoch !== epoch) return

    const abort = new AbortController()
    activeAbort = abort

    const response = await fetch(`${baseUrl}/api/chat/stream`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal: abort.signal,
    })

    if (!started || myEpoch !== epoch) {
      abort.abort()
      return
    }
    if (!response.ok || !response.body) {
      throw new Error(`[chat-stream] subscribe failed: ${response.status}`)
    }

    const stabilityTimer = globalThis.setTimeout(() => {
      backoffMs = INITIAL_BACKOFF_MS
    }, STABLE_AFTER_MS)

    const reader = response.body.getReader()
    const decoder = new globalThis.TextDecoder()
    let buffer = ''
    let currentEvent = ''

    try {
      while (started && myEpoch === epoch) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r\n|\n/)
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.trim() === '') {
            currentEvent = ''
            continue
          }
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6)
            let parsed: unknown = raw
            try {
              parsed = JSON.parse(raw)
            } catch {
              // keep as string
            }
            handleFrame(currentEvent, parsed)
          }
        }
      }
    } finally {
      globalThis.clearTimeout(stabilityTimer)
    }
  }

  function handleFrame(event: string, data: unknown): void {
    if (event === 'connected') {
      const id = (data as { connectionId?: string } | null)?.connectionId
      if (typeof id === 'string') {
        connectionId = id
        // Re-apply the desired subscription under the new connection id, and let
        // the open conversation reconcile (it may have advanced while we were
        // disconnected). Both fire only on a genuine (re)connect handshake.
        void putSubscription()
        // Direct per-pane reconnect (ITEM-35), else the global bus (legacy).
        if (handlers?.onReconnect) handlers.onReconnect()
        else
          void useEventBusStore
            .getState()
            .emit({ type: 'chat:stream-reconnect', data: {} })
      }
      return
    }

    if (!data || typeof data !== 'object') return

    // Two shapes cross this stream:
    //  1. enveloped generation frames `{conversationId, event}` (started /
    //     content / complete / error) — carry their own conversation id;
    //  2. raw extension events `{type, …}` (titleUpdated, mcpToolStart, …) — no
    //     envelope; they belong to whatever conversation THIS connection is
    //     subscribed to (the server only delivered them because we're subscribed).
    const frame = data as Partial<ChatStreamFrame> & { type?: string }
    if (frame.conversationId && frame.event) {
      // Direct per-pane delivery (ITEM-35), else the global bus (legacy).
      if (handlers?.onFrame) handlers.onFrame(frame.conversationId, frame.event)
      else
        void useEventBusStore.getState().emit({
          type: 'chat:token',
          data: { conversation_id: frame.conversationId, event: frame.event },
        })
    } else if (
      desiredConversationId &&
      (typeof frame.type === 'string' || event)
    ) {
      // Raw extension event. It is routed downstream by `data.type`; if a
      // hand-built event omitted `type` (some MCP notifications do), fall back to
      // the SSE `event:` name so it still dispatches instead of silently dropping.
      const payload =
        typeof frame.type === 'string'
          ? (data as SSEChatStreamEvent)
          : ({
              ...(data as object),
              type: event,
            } as unknown as SSEChatStreamEvent)
      if (handlers?.onFrame) handlers.onFrame(desiredConversationId, payload)
      else
        void useEventBusStore.getState().emit({
          type: 'chat:token',
          data: { conversation_id: desiredConversationId, event: payload },
        })
    }
  }

  return { start, stop, setActiveConversation }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}
