/**
 * When must the conversation-summary read-model be re-read?
 *
 * Extracted as a PURE predicate so the answer is unit-testable without mounting
 * the pill (the effect that calls it is three lines; the policy is the part that
 * was wrong).
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 * The trigger used to be `useEffect(…, [conversation?.id, messages.size])`, i.e.
 * "re-read whenever the message count changes". One send changes the count three
 * to four times — the optimistic user bubble, the temp→real id swap, the
 * assistant placeholder, the tail reconcile — so the live-UI audit measured
 * `GET /api/conversations/{id}/summary` firing **3–4× inside a single step** at
 * every viewport and theme (`network/duplicate` + `network/excess`).
 *
 * The server rewrites the summary in exactly ONE place: its `after_llm_call`
 * hook (`server/src/modules/summarization/chat_extension`). So there are exactly
 * two moments worth a read:
 *
 *   1. **A turn finished** — driven by the summarization chat-extension's
 *      `afterStreamComplete` hook, which the stream handler invokes ONCE per
 *      completed turn in the owning pane. (The obvious-looking alternative,
 *      watching `Chat.isStreaming` fall to false, was measured on the live rig
 *      and is WRONG: navigating from `/` to `/chat/{id}` mid-send runs
 *      `loadConversation`, which sets `isStreaming:false` transiently, so the
 *      flag produces TWO falling edges per send and the audit still reported a
 *      duplicate.)
 *   2. **A conversation was opened or switched to** — this predicate, evaluated
 *      by the pill on mount / id change.
 *
 * ── Why the in-flight GET coalescer does not cover this ─────────────────────
 * `sdk/packages/framework/src/api-client/inflight.ts` joins two callers that
 * issue the SAME read *while one is already on the wire*, in the same freshness
 * epoch. Neither condition held:
 *   1. the calls were SEQUENTIAL, not concurrent — each was triggered by the
 *      previous response landing and re-rendering the pill, so there was never a
 *      second caller during an unsettled request; and
 *   2. the `POST /api/conversations/{id}/messages` that ran between them calls
 *      `bumpFetchEpoch()`, which by design makes any surviving entry unjoinable.
 * Coalescing is a de-duplicator, "deliberately NOT a cache" (its own header), so
 * making it swallow this would mean reintroducing the staleness class it exists
 * to avoid. The fix belongs at the trigger, which is here.
 */

export interface SummaryTriggerState {
  /** The conversation the pill is showing, or null on a new-chat pane. */
  conversationId: string | null
  /** Whether that conversation is mid-turn right now. */
  streaming: boolean
  /**
   * Whether THIS tab created the conversation in this session
   * (`core/sessionCreatedConversations`). Such a conversation provably has no
   * pre-existing summary, so the open read has nothing to fetch.
   */
  createdInThisSession: boolean
}

/**
 * True when the pill should read the summary because a conversation was opened
 * or switched to and the store does not already hold that conversation's
 * summary.
 *
 * `loadedConversationId` — the conversation whose summary the store currently
 * holds OR is currently fetching. It is what makes a MOUNT idempotent, and that
 * turned out to be load-bearing: a send re-mounts the composer (`NewChatPage`
 * and `ConversationPage` each render their own `<ChatInput/>`, so the whole
 * `toolbar_status` row is torn down and rebuilt across the `/` → `/chat/{id}`
 * navigation), and a fresh instance has no memory of the previous one. Keying
 * the mount read on the STORE rather than on component-local state is what
 * collapses those re-mounts to a single request — measured on the live rig,
 * component-local de-duplication alone still left 3 reads per send.
 *
 * Never true mid-stream: a read taken while the turn is running would return the
 * PREVIOUS turn's summary, and `afterStreamComplete` re-reads at the end anyway.
 *
 * Never true for a conversation this tab CREATED either. That case is not
 * hypothetical — it is what the last duplicate turned out to be: navigating from
 * `/` to `/chat/{id}` mid-send runs `loadConversation`, which sets
 * `isStreaming:false` transiently, so the re-mounted pill briefly sees an idle
 * conversation it has never loaded and reads a summary that cannot exist yet.
 * The `afterStreamComplete` read a moment later is then the second request the
 * audit counted.
 */
export function shouldLoadSummaryOnOpen(
  state: SummaryTriggerState,
  loadedConversationId: string | null,
): boolean {
  if (!state.conversationId) return false
  if (state.streaming) return false
  if (state.createdInThisSession) return false
  return loadedConversationId !== state.conversationId
}
