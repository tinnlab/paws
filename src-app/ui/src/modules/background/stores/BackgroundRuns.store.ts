import { enableMapSet } from 'immer'
import { Permissions } from '@/api-client/permissions'
import { ApiClient } from '@/api-client'
import { type BackgroundRunCancelAck, type BackgroundRunDetail, type BackgroundRunSummary, type RunNote } from '@/api-client/types'
import { hasPermissionNow } from '@/core/permissions'
import { defineStore, registerLazyStore } from '@ziee/framework/store-kit'

// `runDetailLoading` below is a `Set<string>` (mirrors `FileVersions.store`'s
// per-id loading set); immer needs MapSet support enabled to draft it.
enableMapSet()

/**
 * Terminal run statuses (mirrors the backend `WorkflowRunStatus::is_terminal`).
 * Cancel and steer both 409 on a terminal run, so both affordances are gated on
 * `!isTerminalRunStatus(status)`.
 */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
export const isTerminalRunStatus = (status: string): boolean =>
  TERMINAL_STATUSES.has(status)

/**
 * How many runs the in-conversation Tasks panel pulls per request (DEC-5/DEC-7).
 * A named constant, not an inline literal, so it can be promoted to a setting
 * later without a rewrite. The server independently clamps `per_page` to `1..=500`.
 */
export const PANEL_PAGE_SIZE = 20

/**
 * The user's background sub-agent / sandbox-exec runs (ITEM-8), keyed BY
 * CONVERSATION. Server-paginated over `GET /api/background/runs`; refetches live
 * on `sync:workflow_run` (the backbone emits it — `Audience::owner` — on every
 * background-run state change) so statuses move to their terminal badge without a
 * manual reload.
 *
 * **Why keyed and not one shared list.** `GET /api/background/runs` scopes
 * DISJOINTLY: no `conversation_id` returns only the conversation-LESS runs, one
 * returns only that conversation's. A single shared `runs` array therefore cannot
 * serve two surfaces at once — and the `sync:workflow_run` handler, which must
 * refetch on every run state change, would have to pick ONE scope and blank the
 * other. Keying by conversation lets the handler refetch each open scope with its
 * own id, and lets two split panes on two conversations coexist. (Keying by id
 * mirrors this store's own `detailsByRun` / `notesByRun`.)
 *
 * Mirrors `McpToolCalls.store` (paginated + sync-subscribed + self-gated).
 */
const BackgroundRunsDef = defineStore('BackgroundRuns', {
  immer: true,
  state: {
    /** Accumulated runs per conversation id (page 1..N appended, newest-first). */
    runsByConversation: {} as Record<string, BackgroundRunSummary[]>,
    /** Server-reported total for that conversation's scope (drives "N of M"). */
    totalByConversation: {} as Record<string, number>,
    /** Highest page fetched per conversation (so Load-more asks for the next). */
    pageByConversation: {} as Record<string, number>,
    loadingByConversation: {} as Record<string, boolean>,
    errorByConversation: {} as Record<string, string | null>,
    /**
     * Pending steering notes keyed by run id, loaded on demand when a row's
     * steer composer is opened (avoids an N-fetch fan-out across the page).
     */
    notesByRun: {} as Record<string, RunNote[]>,
    /**
     * Full run detail (incl. `final_output_json`) keyed by run id, fetched
     * lazily when a row's result view is expanded (`GET /api/background/runs/{id}`)
     * and cached — a terminal run's result is immutable, so it's fetched once.
     */
    detailsByRun: {} as Record<string, BackgroundRunDetail>,
    /** Run ids whose detail request is in flight (drives the per-row `Spin`). */
    runDetailLoading: new Set<string>(),
    /** Per-run detail-fetch error message (rendered inline; never swallowed). */
    detailErrorByRun: {} as Record<string, string>,
  },
  actions: (set, get) => {
    /**
     * Load ONE conversation's background runs (the in-chat Tasks panel + the
     * end-of-conversation footer both read this slice).
     *
     * `page` 1 REPLACES the slice (a fresh read of the newest page — this is what
     * the sync handler re-issues); `page > 1` APPENDS (Load-more). Sending
     * `conversation_id` is what makes the read disjoint: without it the endpoint
     * returns the conversation-LESS runs, which are a different surface entirely.
     */
    const loadConversationRuns = async (
      conversationId: string,
      page = 1,
    ): Promise<void> => {
      // no-403 invariant: gate on the SAME permission the endpoint enforces.
      if (!hasPermissionNow(Permissions.BackgroundUse)) return
      try {
        set(draft => {
          draft.loadingByConversation[conversationId] = true
          draft.errorByConversation[conversationId] = null
        })
        const response = await ApiClient.Background.listRuns({
          page,
          per_page: PANEL_PAGE_SIZE,
          // The disjoint scope. Never omit it here.
          conversation_id: conversationId,
        })
        set(draft => {
          const previous = draft.runsByConversation[conversationId] ?? []
          draft.runsByConversation[conversationId] =
            page <= 1 ? response.runs : [...previous, ...response.runs]
          draft.totalByConversation[conversationId] = response.total
          draft.pageByConversation[conversationId] = response.page
          draft.loadingByConversation[conversationId] = false
        })
      } catch (error) {
        console.error('Background runs load failed:', conversationId, error)
        set(draft => {
          draft.loadingByConversation[conversationId] = false
          // Never clear an already-loaded slice on a refetch failure — the user
          // keeps seeing the last good list with the error surfaced beside it.
          draft.errorByConversation[conversationId] =
            error instanceof Error
              ? error.message
              : 'Failed to load this conversation’s tasks'
        })
      }
    }

    /** Load-more: fetch the page after the highest one already held. */
    const loadMoreConversationRuns = async (conversationId: string): Promise<void> => {
      const next = (get().pageByConversation[conversationId] ?? 1) + 1
      await loadConversationRuns(conversationId, next)
    }

    const loadNotes = async (runId: string): Promise<void> => {
      if (!hasPermissionNow(Permissions.BackgroundUse)) return
      try {
        const notes = await ApiClient.Background.listRunNotes({ run_id: runId })
        set(draft => {
          draft.notesByRun[runId] = notes
        })
      } catch (error) {
        // Non-fatal: the steer composer still works without the pending list.
        console.error('Background run notes load failed:', error)
      }
    }

    /**
     * Lazily fetch a single run's full detail (incl. `final_output_json`) for the
     * inline result view, keyed + cached by run id. Called when a row's result
     * view is expanded. Idempotent: a cached detail or an in-flight request is a
     * no-op, so re-expanding never refetches (a terminal run's result is fixed).
     * A failure is recorded to `detailErrorByRun` (rendered inline) and clears the
     * loading flag, so a later expand retries cleanly.
     */
    const loadRunDetail = async (runId: string): Promise<void> => {
      // no-403 invariant: gate on the SAME permission the endpoint enforces.
      if (!hasPermissionNow(Permissions.BackgroundUse)) return
      const current = get()
      if (current.detailsByRun[runId] || current.runDetailLoading.has(runId)) return
      set(draft => {
        const ls = new Set(draft.runDetailLoading)
        ls.add(runId)
        draft.runDetailLoading = ls
        delete draft.detailErrorByRun[runId]
      })
      try {
        const detail = await ApiClient.Background.getRun({ run_id: runId })
        set(draft => {
          draft.detailsByRun[runId] = detail
          const ls = new Set(draft.runDetailLoading)
          ls.delete(runId)
          draft.runDetailLoading = ls
        })
      } catch (error) {
        set(draft => {
          draft.detailErrorByRun[runId] =
            error instanceof Error ? error.message : 'Failed to load the result'
          const ls = new Set(draft.runDetailLoading)
          ls.delete(runId)
          draft.runDetailLoading = ls
        })
        console.error('Background run detail load failed:', runId, error)
      }
    }

    /**
     * Refetch page 1 of EVERY conversation scope currently held, each with its
     * own `conversation_id`. Bounded by the conversations whose panel/footer this
     * session actually opened (one per pane), so it can never fan out unbounded.
     *
     * An unscoped refetch is deliberately NOT issued here: under the endpoint's
     * disjoint semantics that would return the conversation-LESS runs and blank
     * every open panel on the first run state change — i.e. exactly when the user
     * is watching. See TEST-7.
     */
    const refreshTrackedConversations = (): void => {
      for (const conversationId of Object.keys(get().runsByConversation)) {
        void loadConversationRuns(conversationId, 1)
      }
    }

    return {
      loadConversationRuns,
      loadMoreConversationRuns,
      refreshTrackedConversations,
      loadNotes,
      loadRunDetail,
      /**
       * Cancel a non-terminal run. The server flips the row + emits
       * `sync:workflow_run` (→ the row refreshes to `cancelled`); we also refetch
       * that run's own conversation scope immediately as a backstop. Throws on
       * failure so the UI layer toasts it (the store carries no per-mutation
       * error state).
       */
      cancelRun: async (runId: string): Promise<BackgroundRunCancelAck> => {
        const ack = await ApiClient.Background.cancelRun({ run_id: runId })
        refreshTrackedConversations()
        return ack
      },
      /**
       * Queue a steering note to a non-terminal run. Throws (e.g. 409 on a run
       * that finished between render and submit) so the UI layer toasts it;
       * refreshes that run's pending-note list on success.
       */
      postNote: async (runId: string, note: string): Promise<RunNote> => {
        const created = await ApiClient.Background.postRunNote({
          run_id: runId,
          note,
        })
        await loadNotes(runId)
        return created
      },
      clearConversationError: (conversationId: string): void =>
        set(draft => {
          draft.errorByConversation[conversationId] = null
        }),
    }
  },
  init: ({ on, actions }) => {
    // Live refresh: on any owner-scoped background-run state change and on SSE
    // reconnect, refetch EVERY conversation scope currently held — each with its
    // own conversation_id. Self-gated inside `loadConversationRuns`
    // (no-403-on-reconnect for a role without `background::use`).
    const reload = (): void => {
      actions.refreshTrackedConversations()
    }
    on('sync:workflow_run', reload)
    on('sync:reconnect', reload)
  },
})

export const BackgroundRuns = registerLazyStore(BackgroundRunsDef)
export const useBackgroundRunsStore = BackgroundRunsDef.store
