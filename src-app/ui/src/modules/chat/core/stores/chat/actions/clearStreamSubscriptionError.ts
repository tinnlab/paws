import type { ChatSet, ChatInitialState, ChatState } from '@/modules/chat/core/stores/chat'

import { SUBSCRIPTION_ERROR_MESSAGE } from '@/modules/chat/core/stream/ChatStreamClient'

/**
 * The chat-token stream subscribed successfully after having reported that it
 * could not, so delivery is working again.
 *
 * Without this the banner outlives the condition it describes: a transient
 * outage that reached the failure limit left the user staring at "live updates
 * are not reaching this conversation" on a conversation that was, by then,
 * receiving them again — and nothing clears `error` except the user dismissing
 * it, a new send, or a cache-miss conversation load (audit round 2).
 *
 * Clears ONLY the banner this feature raised — compared against the client's own
 * exported constant, not a re-spelled copy of it. A previous version kept a
 * second literal here; rewording the message would then have stopped the clear
 * ever matching, with every test still green (audit round 3).
 *
 * An equality check, not a blanket `error: null`: an unrelated failure (a
 * provider error, a failed history fetch) has nothing to do with the stream
 * coming back, and silently wiping it would be the same class of bug in the
 * other direction.
 *
 * ## And NOT while a turn is still open (audit round 4)
 *
 * The stream coming back does not bring back the tokens it dropped. A turn that
 * was mid-flight during the outage will never receive its `complete` frame, so
 * `isStreaming` stays true and `reloadOpen` cannot self-heal it. Clearing the
 * banner then produces the one state INV-4 forbids outright — a spinner running
 * with no explanation and no way back — and it was reachable ONLY after the
 * banner became the sole signal. So the advice stays up for exactly as long as
 * the turn it applies to; the next turn clears `error` on its own.
 */
export default (set: ChatSet, getRaw: () => ChatInitialState) => {
  const get = getRaw as unknown as () => ChatState
  return async () => {
    const state = get()
    if (state.error !== SUBSCRIPTION_ERROR_MESSAGE) return
    if (state.sending || state.isStreaming || state.finalizingTurn) return
    set({ error: null })
  }
}
