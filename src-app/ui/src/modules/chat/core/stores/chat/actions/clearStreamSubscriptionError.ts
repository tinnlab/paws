import type { ChatSet, ChatInitialState, ChatState } from '@/modules/chat/core/stores/chat'

/** The exact prefix `ChatStreamClient` reports; see `reportStreamSubscriptionError`. */
const SUBSCRIPTION_ERROR_PREFIX = 'Live updates are not reaching this conversation.'

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
 * Clears ONLY the banner this feature raised. A `startsWith` check, not a blanket
 * `error: null`: an unrelated failure (a provider error, a failed history fetch)
 * has nothing to do with the stream coming back, and silently wiping it would be
 * the same class of bug in the other direction.
 */
export default (set: ChatSet, getRaw: () => ChatInitialState) => {
  const get = getRaw as unknown as () => ChatState
  return async () => {
    const current = get().error
    if (current?.startsWith(SUBSCRIPTION_ERROR_PREFIX)) set({ error: null })
  }
}
