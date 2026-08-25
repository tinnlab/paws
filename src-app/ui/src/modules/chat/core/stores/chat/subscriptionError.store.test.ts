/**
 * TEST-7 — an undeliverable stream must be SURFACED.
 *
 * When `ChatStreamClient` reports that it cannot scope its connection to a
 * conversation, no live token can ever arrive on it, and the user is otherwise
 * left with an unexplained spinner that only a reload resolves.
 *
 * What the action does is raise the banner — and nothing else. Coupling the
 * report to the turn's state produced a defect in three consecutive audit
 * rounds, every one the same mistake: inferring "the turn is over" from a stream
 * that had merely stopped delivering. Terminating a stalled turn is a deadline,
 * which is the product decision the owner explicitly descoped; these tests pin
 * that the action stays out of it.
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

  it('what lands on the banner names the problem AND the remedy', async () => {
    // Asserted on what the ACTION puts on `error`, not on the constant in
    // isolation: a test that only inspects an import passes with the action
    // deleted (audit round 4). The two clauses are what make the banner
    // actionable rather than merely present.
    const { state, get, set } = harness()
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    expect((state.error ?? '').trim().length).toBeGreaterThan(0)
    expect(state.error).toMatch(/live updates/i)
    expect(state.error).toMatch(/reload/i)
    // …and it never claims a turn is in flight, in any state it can be shown in.
    expect(state.error).not.toMatch(/still being (generated|saved)/i)
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

  it('does NOT clear while a turn is still open', async () => {
    // The stream coming back does not bring back the tokens it dropped: a turn
    // that was mid-flight keeps `isStreaming` true, will never get its `complete`
    // frame, and `reloadOpen` bails on it. Clearing the banner then leaves a
    // spinner running with no explanation — the one state INV-4 forbids outright,
    // and reachable only once the banner became the sole signal (audit round 4).
    const { state, get, set } = harness({ sending: false, isStreaming: true })
    await makeReportStreamSubscriptionError(set, get)(MESSAGE)
    await makeClearStreamSubscriptionError(set, get)()
    expect(state.error).toBe(MESSAGE)

    // …and it DOES clear once that turn is over.
    state.isStreaming = false
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
