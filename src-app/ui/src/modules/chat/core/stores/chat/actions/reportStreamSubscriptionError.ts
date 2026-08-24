import type { ChatSet, ChatInitialState, ChatState } from '@/modules/chat/core/stores/chat'
import { buildSendFailureState } from '@/modules/chat/core/stores/chat/sendFailureState'

/**
 * The chat-token stream could not be SCOPED to this pane's conversation, so no
 * live token can ever arrive on it.
 *
 * Reported by `ChatStreamClient` once its consecutive-failure limit is reached,
 * and again periodically while it stays broken. The failure it reports used to
 * be silent: a CORS preflight refusal makes `fetch` REJECT rather than return a
 * status, so it missed the client's `!resp.ok` branch and was swallowed by a
 * `console.warn`. The connection then stayed open and healthy but scoped to
 * nothing — the server matched no connection when publishing frames, so
 * `applyStreamFrame` never saw `complete`, `isStreaming` never cleared, and
 * `reloadOpen` bails while it is true, meaning the pane could not self-heal
 * either. The user got a spinner that only a page reload resolved.
 *
 * ## Two things this must get right (audit FIX-2 / FIX-3)
 *
 * **Only reset a turn that is actually in flight.** `buildSendFailureState` is
 * the one recovery shape a failed turn resets to, and it sets
 * `lastTurnInterrupted: true` — which `MessageList` renders as an "interrupted"
 * badge on the last assistant message. Applying it unconditionally decorated a
 * fully-persisted, completed reply as interrupted whenever a subscription failed
 * at conversation OPEN, which is the most common trigger. So the reset is
 * applied only when `sending` or `isStreaming` is true; otherwise there is no
 * turn to recover and only the banner is raised.
 *
 * **Say something true.** The advice differs by case: mid-turn, the reply really
 * is still being generated and saved, so "reload to see it" is actionable; at
 * rest, it would be a lie. The client supplies only the part it can know.
 */
export default (set: ChatSet, getRaw: () => ChatInitialState) => {
  const get = getRaw as unknown as () => ChatState
  return async (message: string) => {
    const state = get()
    const turnInFlight = state.sending || state.isStreaming

    const text = turnInFlight
      ? `${message} The reply is still being generated and saved — reload to see it.`
      : `${message} Replies will not appear until this is resolved — reload to reconnect.`

    if (!turnInFlight) {
      // Nothing to recover; raising the turn-failure reset here is what falsely
      // marked an old, completed reply as interrupted.
      set({ error: text })
      return
    }

    // A turn IS in flight and can never be delivered: clear every flag that
    // would otherwise leave it claiming to generate forever. The delivery
    // failure wins over any earlier error text — it is the live, actionable one,
    // and keeping a stale message here is how the user ends up never being told
    // the real ongoing problem.
    set({ ...buildSendFailureState(new Error(text)), error: text })
  }
}
