import type { ChatSet, ChatInitialState, ChatState } from '@/modules/chat/core/stores/chat'
import { buildSendFailureState } from '@/modules/chat/core/stores/chat/sendFailureState'

/**
 * The chat-token stream could not be SCOPED to this pane's conversation, so no
 * live token can ever arrive on it.
 *
 * Reported by `ChatStreamClient` after `SUBSCRIPTION_FAILURE_LIMIT` consecutive
 * failed subscription PUTs. The failure it reports used to be silent: a CORS
 * preflight refusal makes `fetch` REJECT rather than return a status, so it
 * missed the client's `!resp.ok` branch and was swallowed by a `console.warn`.
 * The connection then stayed open and healthy but scoped to nothing — the server
 * matched no connection when publishing frames, so `applyStreamFrame` never saw
 * `complete`, `isStreaming` never cleared, and `reloadOpen` bails while it is
 * true, meaning the pane could not self-heal either. The user got a spinner that
 * only a page reload resolved.
 *
 * Reuses `buildSendFailureState` — the ONE recovery shape a failed turn resets
 * to — rather than hand-rolling a second, subtly-different one; that module's
 * own header warns that a half-recovery (`sending` cleared, `isStreaming` left
 * true) is how a store ends up permanently wedged. `error` lands on the existing
 * banner `ConversationPane` already renders as `chat-conversation-error-alert`,
 * so no new render state is introduced.
 *
 * Idempotent-ish by construction: the client reports once per failure run, and a
 * repeat here would only rewrite the same terminal state.
 */
export default (set: ChatSet, getRaw: () => ChatInitialState) => {
  const get = getRaw as unknown as () => ChatState
  return async (message: string) => {
    // Don't clobber an error the turn already surfaced — the first cause is the
    // useful one, and a stream that cannot subscribe is downstream of it.
    const existing = get().error
    const patch = buildSendFailureState(new Error(message))
    set(existing ? { ...patch, error: existing } : patch)
  }
}
