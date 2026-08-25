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
 */
export default (set: ChatSet, getRaw: () => ChatInitialState) => {
  const get = getRaw as unknown as () => ChatState
  return async () => {
    if (get().error === SUBSCRIPTION_ERROR_MESSAGE) set({ error: null })
  }
}
