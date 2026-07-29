/**
 * Conversations THIS tab created whose FIRST turn has not completed yet.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Several surfaces ask the server a question whose answer is already knowable
 * for a conversation this tab just created, because such a conversation cannot
 * have any pre-existing per-conversation state:
 *
 *  - `BackgroundRunsFooter` probed `GET /api/background/runs` on every
 *    conversation mount even though it renders nothing unless runs exist — the
 *    live-UI audit measured that as an `irrelevant` fetch on `compose-send`.
 *  - `SummarizationStatusPill` read `GET /api/conversations/{id}/summary` when
 *    the composer re-mounted on the `/` → `/chat/{id}` navigation, which for a
 *    brand-new conversation can only ever answer "no summary".
 *
 * ── The window is NARROW, and that is load-bearing ──────────────────────────
 * "Provably empty" is true only until the conversation's FIRST TURN COMPLETES —
 * after that the server may have written a summary, and a sub-agent run may
 * exist. So the mark is REMOVED at the end of every turn
 * (`chat/.../applyStreamFrame.ts`, where `finalizingTurn` is set), and from then
 * on both surfaces ask normally.
 *
 * Without that expiry the elision is a real defect rather than an optimisation:
 * `BackgroundRuns.releaseConversationScope` DELETES a conversation's cached
 * slice on unmount, so a permanently-marked conversation would, after one
 * navigate-away-and-back, show no footer and no route to its Tasks panel for the
 * rest of the session; and the single-entry summary cache rotates on any
 * conversation switch, so its boundary marker would go blank just as
 * permanently. (Both were found by the blind audit — see LEDGER L-1/L-2.)
 *
 * Anything that appears INSIDE the window still reaches those surfaces:
 * background runs arrive on `sync:workflow_run` (the footer retains its scope on
 * mount even when it skips the probe), and the summary is read by the
 * summarization extension's `afterStreamComplete` hook — which fires at the same
 * moment the mark is removed.
 *
 * ── Why a module-level Set and not store state ──────────────────────────────
 * Nothing renders it; it is a request-elision guard. This mirrors
 * `BackgroundRuns.store`'s own module-local `inFlight` set, which documents the
 * same reasoning ("keeping it out of the reactive state avoids re-rendering
 * every subscriber twice per fetch"). It lives in `core/` rather than in one
 * feature module because two independent modules consume it — same placement
 * rule as `core/permissions` and `core/llmModelCatalog`.
 *
 * Session-scoped by construction: a reload drops it, and a reloaded tab has no
 * knowledge of what it created, so it correctly falls back to asking.
 */

/**
 * Upper bound on remembered ids. A tab that creates thousands of conversations
 * must not grow this without limit; past the cap the OLDEST id is forgotten and
 * that conversation simply probes once more — i.e. the pre-change behaviour,
 * which is the safe direction to fail in. Named (not inline) so it can be
 * promoted to a setting later without a rewrite, mirroring `PANEL_PAGE_SIZE`.
 */
export const SESSION_CREATED_CAP = 500

/** Insertion-ordered, so the first key is always the oldest entry. */
const created = new Set<string>()

/** Remember that this tab created `conversationId`. Idempotent. */
export function noteSessionCreatedConversation(conversationId: string): void {
  if (!conversationId) return
  if (created.has(conversationId)) return
  if (created.size >= SESSION_CREATED_CAP) {
    const oldest = created.values().next().value
    if (oldest !== undefined) created.delete(oldest)
  }
  created.add(conversationId)
}

/**
 * Drop the mark. Called at the END OF EVERY TURN: from that moment the
 * conversation can have server-side state, so the surfaces must ask again.
 * Idempotent, and a no-op for an id that was never marked.
 */
export function forgetSessionCreatedConversation(conversationId: string): void {
  created.delete(conversationId)
}

/**
 * True while `conversationId` is one this tab created AND no turn has completed
 * in it yet — i.e. while it is provably free of server-side per-conversation
 * state. False for everything else, which is the safe default (ask the server).
 */
export function isSessionCreatedConversation(conversationId: string): boolean {
  return created.has(conversationId)
}

/** Test seam: forget everything (module state outlives a test otherwise). */
export function __resetSessionCreatedForTests(): void {
  created.clear()
}

// NO EventBus subscription here, deliberately. An earlier revision registered a
// `conversation.created` listener from the background module's `initialize()`;
// the blind audit showed it was provably INERT (LEDGER L-6): the store's
// `createConversation` is the sole creation path, it marks the id synchronously
// before `set({ conversation })`, and BOTH `conversation.created` emitters run
// strictly after that — so the listener could never mark anything the direct
// call had missed. It also made this module's behaviour depend on an unrelated
// feature module being in the load wave. Marking stays where the fact is
// produced (`chat/.../createConversation.ts`) and un-marking where it expires
// (`chat/.../applyStreamFrame.ts`).
