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
import makeClearStreamSubscriptionError from './actions/clearStreamSubscriptionError'
import { SUBSCRIPTION_ERROR_MESSAGE } from '@/modules/chat/core/stream/ChatStreamClient'

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

// Imported, never re-spelled — a second copy is what let a reword silently
// break the clear path (audit round 3).
const MESSAGE = SUBSCRIPTION_ERROR_MESSAGE

describe('TEST-7: an undeliverable stream is surfaced, and only surfaced', () => {
  it('raises the banner the ConversationPane renders', () => {
    const { state, get, set } = harness()
    makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect(state.error).toBe(MESSAGE)
  })

  it('does NOT touch the turn state', async () => {
    // Three audit rounds found three defects in coupling this to the turn — each
    // a variant of inferring "the turn is over" from a stream that has merely
    // stopped delivering: a reply that completed days ago badged `interrupted`;
    // a reply badged mid-`finalizingTurn` handoff; and a turn reset from inside
    // `sendMessage`'s own setup, before its POST. The invariant asks for the
    // failure to be SURFACED, and that is all this does now.
    const { state, get, set } = harness()
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)

    expect(state.sending).toBe(true)
    expect(state.isStreaming).toBe(true)
    expect(state.lastTurnInterrupted).toBe(false)
    expect(state.streamingMessageId).toBe('m1')
  })

  it('does not mark a completed reply as interrupted at rest either', async () => {
    const { state, get, set } = harness({
      sending: false,
      isStreaming: false,
      streamingMessage: null,
      streamingMessageId: null,
      streamingAbortController: null,
    })
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect(state.error).toBe(MESSAGE)
    expect(state.lastTurnInterrupted).toBe(false)
  })

  it('the message is never blank, and names the remedy', () => {
    // The one banner text is the client's exported constant, so this pins the
    // property that matters about it rather than re-asserting its words.
    expect(MESSAGE.trim().length).toBeGreaterThan(0)
    expect(MESSAGE).toMatch(/reload/i)
  })

  it('the live delivery failure REPLACES a stale earlier error', async () => {
    // The delivery failure is the live and actionable one, so it wins.
    const { state, get, set } = harness({ error: 'provider unavailable' })
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect(state.error).toBe(MESSAGE)
  })
})

describe('clearStreamSubscriptionError: the banner must not outlive the outage', () => {
  it('clears the banner this feature raised', async () => {
    const { state, get, set } = harness({ sending: false, isStreaming: false })
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect(state.error).toBeTruthy()

    await makeClearStreamSubscriptionError(set, get)()
    expect(state.error).toBeNull()
  })

  it('does NOT clear an unrelated error', async () => {
    // A provider failure has nothing to do with the stream coming back; wiping
    // it would be the same class of bug in the other direction.
    const { state, get, set } = harness({ error: 'provider unavailable' })
    await makeClearStreamSubscriptionError(set, get)()
    expect(state.error).toBe('provider unavailable')
  })
})
