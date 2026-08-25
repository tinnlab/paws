import type { ChatSet, ChatInitialState } from '@/modules/chat/core/stores/chat'

/**
 * The chat-token stream could not be SCOPED to this pane's conversation, so no
 * live token can arrive on it. Raise the banner.
 *
 * Reported by `ChatStreamClient` once its consecutive-failure limit is reached,
 * again periodically while it stays broken, and again whenever a new turn starts
 * on a stream already known to be broken. The failure it reports used to be
 * silent: a CORS preflight refusal makes `fetch` REJECT rather than return a
 * status, so it missed the client's `!resp.ok` branch and was swallowed by a
 * `console.warn`. The connection then stayed open and healthy but scoped to
 * nothing, and the user got a spinner that only a page reload resolved.
 *
 * ## This raises the banner and touches NOTHING else — deliberately (audit round 3)
 *
 * It used to also apply `buildSendFailureState`, the turn-failure reset. Three
 * audit rounds found three separate defects in that coupling, each a variant of
 * the same mistake — inferring "the turn is over" from a stream that has merely
 * stopped delivering:
 *
 *   - applied at conversation-open, it badged a reply that completed days ago as
 *     `interrupted`;
 *   - applied during the `complete`→persisted handoff (`finalizingTurn`), it
 *     badged a reply that had just finished and was on screen;
 *   - applied from the per-turn re-arm, it fired inside `sendMessage`'s own
 *     setup and reset a turn that had not yet been POSTed — re-enabling the
 *     composer and badging the previous reply at the instant the user pressed
 *     send.
 *
 * The reset was never what the invariant asked for. INV-4 says a delivery failure
 * must not present as "still working"; a visible banner naming the failure and
 * the remedy is exactly that, and it is true in every state without having to
 * guess at the turn's. Terminating a turn's UI state on a deadline is the
 * separate product decision the owner explicitly descoped (DEC-9), and inventing
 * a private version of it here is what generated the churn.
 */
export default (set: ChatSet, _getRaw: () => ChatInitialState) => {
  return async (message: string) => set({ error: message })
}
