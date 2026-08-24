/**
 * TEST-7 — an undeliverable stream must leave the turn in a TERMINAL state.
 *
 * When `ChatStreamClient` reports that it cannot scope its connection to a
 * conversation, no live token can ever arrive on it. Clearing `error` alone
 * would not be enough, and neither would clearing the flags alone:
 *
 *   - `isStreaming` left true is worse than a stuck spinner — `reloadOpen` in
 *     `stores/chat/index.ts` BAILS while it is true, so the pane cannot even
 *     self-heal on the next reconnect. That is why "only a reload shows it".
 *   - `sending` left true keeps the composer disabled, so the user cannot retry.
 *
 * The action therefore reuses `buildSendFailureState` — the one recovery shape a
 * failed turn resets to — rather than hand-rolling a second, subtly different
 * one. `sendFailureState.ts`'s own header warns that a half-recovery is exactly
 * how a store ends up permanently wedged.
 */
import { describe, expect, it } from 'vitest'

import makeReportStreamSubscriptionError from './actions/reportStreamSubscriptionError'

interface State {
  error: string | null
  sending: boolean
  isStreaming: boolean
  streamingMessage: unknown
  streamingAbortController: unknown
  streamingMessageId: string | null
  finalizingTurn: boolean
  lastTurnInterrupted: boolean
}

function harness(over: Partial<State> = {}) {
  const state: State = {
    error: null,
    // Mid-turn: what the store looks like the moment the reply is generating.
    sending: true,
    isStreaming: true,
    streamingMessage: { id: 'm1' },
    streamingAbortController: new AbortController(),
    streamingMessageId: 'm1',
    finalizingTurn: false,
    lastTurnInterrupted: false,
    ...over,
  }
  const get = (() => state) as never
  const set = ((patch: Partial<State> | ((s: State) => Partial<State> | void)) => {
    const next = typeof patch === 'function' ? patch(state) : patch
    if (next) Object.assign(state, next)
  }) as never
  return { state, get, set }
}

const MESSAGE = 'Live updates are not reaching this conversation.'

describe('TEST-7: reportStreamSubscriptionError reaches a terminal state', () => {
  it('surfaces the message and clears every flag that would wedge the turn', async () => {
    const { state, get, set } = harness()

    await makeReportStreamSubscriptionError(set, get)(MESSAGE)

    // Rendered by ConversationPane as `chat-conversation-error-alert`.
    expect(state.error).toBe(MESSAGE)
    // The spinner stops…
    expect(state.isStreaming).toBe(false)
    // …the composer re-enables…
    expect(state.sending).toBe(false)
    // …and nothing is left claiming to be mid-turn.
    expect(state.streamingMessage).toBeNull()
    expect(state.streamingMessageId).toBeNull()
    expect(state.streamingAbortController).toBeNull()
    expect(state.finalizingTurn).toBe(false)
  })

  it('never renders a blank alert', async () => {
    // An empty `error` string would render an empty banner — visible, useless.
    const { state, get, set } = harness()
    await makeReportStreamSubscriptionError(set, get)('')
    expect(state.error).toBeTruthy()
  })

  it('does not clobber an error the turn already surfaced', async () => {
    // A stream that cannot subscribe is downstream of whatever failed first;
    // the first cause is the one worth showing.
    const { state, get, set } = harness({ error: 'provider unavailable' })
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect(state.error).toBe('provider unavailable')
    // …but the flags are still cleared, or the turn stays wedged.
    expect(state.isStreaming).toBe(false)
    expect(state.sending).toBe(false)
  })
})
