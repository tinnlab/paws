import { EventBus } from '@ziee/framework/stores'

/**
 * Conversations THIS tab created during THIS session.
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
 * Anything that appears LATER still reaches those surfaces: background runs
 * arrive on `sync:workflow_run` (the footer retains its scope on mount), and the
 * summary is re-read by the summarization extension's `afterStreamComplete` hook
 * at the end of each turn. Only the provably-empty question is skipped; a
 * conversation loaded FROM the server always asks, which is what lets a reload
 * surface state this tab never saw created.
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

/** True when this tab created `conversationId` during this session. */
export function isSessionCreatedConversation(conversationId: string): boolean {
  return created.has(conversationId)
}

/** Test seam: forget everything (module state outlives a test otherwise). */
export function __resetSessionCreatedForTests(): void {
  created.clear()
}

let subscribed = false

/**
 * Start recording `conversation.created` into the set. Idempotent — every
 * consumer may call it, and exactly one subscription is ever registered.
 *
 * Called from the `background` module's `initialize()`, which is the earliest
 * point that reliably precedes any send: `sendMessage` emits
 * `conversation.created` and only THEN awaits the chat-extension lifecycle, and
 * a lazily-instantiated store is later still. `background` is a core module (no
 * `shouldLoad`), so it is registered in the first wave for every user — which is
 * what makes this tracking unconditional even though the surfaces that read it
 * live in other modules.
 */
export function ensureSessionCreatedTracking(): void {
  if (subscribed) return
  subscribed = true
  EventBus.on(
    'conversation.created',
    event => noteSessionCreatedConversation(event.data.conversation.id),
    'session-created-conversations',
  )
}
