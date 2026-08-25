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
  it('mid-turn: clears every flag that would wedge the turn, and says so', async () => {
    const { state, get, set } = harness()

    await makeReportStreamSubscriptionError(set, get)(MESSAGE)

    // Rendered by ConversationPane as `chat-conversation-error-alert`.
    expect(state.error).toContain(MESSAGE)
    // The spinner stops…
    expect(state.isStreaming).toBe(false)
    // …the composer re-enables…
    expect(state.sending).toBe(false)
    // …and nothing is left claiming to be mid-turn.
    expect(state.streamingMessage).toBeNull()
    expect(state.streamingMessageId).toBeNull()
    expect(state.streamingAbortController).toBeNull()
    expect(state.finalizingTurn).toBe(false)
    // A turn WAS in flight, so this advice is true.
    expect(state.error).toMatch(/still being generated/i)
  })

  it('at rest: does NOT mark a completed reply as interrupted', async () => {
    // The primary trigger is a subscription failing when a conversation is
    // OPENED, with nothing generating. Applying the turn-failure reset there set
    // `lastTurnInterrupted: true`, which MessageList renders as an "interrupted"
    // badge on the last assistant message — decorating a reply that completed
    // normally, possibly days ago (audit FIX-2).
    const { state, get, set } = harness({
      sending: false,
      isStreaming: false,
      streamingMessage: null,
      streamingMessageId: null,
      streamingAbortController: null,
    })

    await makeReportStreamSubscriptionError(set, get)(MESSAGE)

    expect(state.error).toContain(MESSAGE)
    expect(state.lastTurnInterrupted).toBe(false)
    // …and the advice does not claim a reply is being generated, because none is.
    expect(state.error).not.toMatch(/still being generated/i)
    expect(state.error).toMatch(/reload to reconnect/i)
  })

  it('never renders a blank alert', async () => {
    // Not about the message text: the property is that this action cannot put an
    // empty string on `error`, which would render a visible, useless banner.
    const { state, get, set } = harness()
    await makeReportStreamSubscriptionError(set, get)('')
    expect((state.error ?? '').trim().length).toBeGreaterThan(0)
  })

  it('a FINALIZING turn still counts as in flight', async () => {
    // `finalizingTurn` means the `complete` frame landed but the persisted tail
    // has not been swapped in — still a live turn. The first version treated it
    // as "at rest", so the banner branch left `finalizingTurn: true` set, which
    // MessageList renders as the finalizing affordance (audit round 2).
    const { state, get, set } = harness({
      sending: false,
      isStreaming: false,
      finalizingTurn: true,
    })
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect(state.finalizingTurn).toBe(false)
    expect(state.error).toMatch(/still being generated/i)
  })

  it('the live delivery failure REPLACES a stale earlier error', async () => {
    // The first version kept the pre-existing text and dropped this one. With
    // the client reporting only once (the defect above), that meant the user was
    // never told the real, ongoing problem (audit FIX-3). The delivery failure is
    // the live and actionable one, so it wins.
    const { state, get, set } = harness({ error: 'provider unavailable' })
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect(state.error).toContain(MESSAGE)
    expect(state.isStreaming).toBe(false)
    expect(state.sending).toBe(false)
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
