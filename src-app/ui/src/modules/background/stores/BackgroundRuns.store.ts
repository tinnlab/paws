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
     * MOUNT REFCOUNT per conversation — how many live footers/panels are showing
     * that conversation right now. This, NOT the data map, is what the live
     * refresh iterates: the data map accumulates a key for every conversation the
     * session ever opened (the footer mounts in all of them), so refreshing over
     * it would fire one request per visited conversation on EVERY run state
     * change. Refcounting bounds the fan-out to what is actually on screen
     * (1 footer + at most 1 panel per open pane) and, because it is written on
     * MOUNT rather than on a successful load, it also covers a scope whose first
     * load FAILED — which the data map cannot, since it only gains a key on
     * success.
     */
    activeScopes: {} as Record<string, number>,
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
     * In-flight `conversationId#page` keys. Module-local rather than store state:
     * it is a request-dedup guard, not something any component renders, so keeping
     * it out of the reactive state avoids re-rendering every subscriber twice per
     * fetch. (`loadRunDetail`'s `runDetailLoading` IS state because the card
     * renders a per-row spinner from it.)
     */
    const inFlight = new Set<string>()

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
      // In-flight dedup: the footer and the panel both load page 1 on mount for
      // the same conversation, and the panel remounts on every right-panel tab
      // switch — without this each of those is a duplicate round-trip.
      // (Mirrors `loadRunDetail`'s `runDetailLoading` guard.)
      const key = `${conversationId}#${page}`
      if (inFlight.has(key)) return
      inFlight.add(key)
      try {
        set(draft => {
          draft.loadingByConversation[conversationId] = true
          draft.errorByConversation[conversationId] = null
        })
        // A page-1 REFRESH must re-read the whole window the user already has,
        // otherwise a sync event mid-session collapses an expanded list back to
        // the first page (and Load-more visibly reappears) while they watch.
        const pagesHeld = page === 1 ? (get().pageByConversation[conversationId] ?? 1) : 1
        const perPage = PANEL_PAGE_SIZE * Math.max(1, page === 1 ? pagesHeld : 1)
        const response = await ApiClient.Background.listRuns({
          page,
          per_page: perPage,
          // The disjoint scope. Never omit it here.
          conversation_id: conversationId,
        })
        set(draft => {
          if (page <= 1) {
            draft.runsByConversation[conversationId] = response.runs
          } else {
            // De-duplicate on append: the server pages with OFFSET over a
            // `created_at DESC` order, so a run created between two page fetches
            // shifts the window and can repeat a row — which would otherwise
            // produce duplicate React keys and a wrong "Showing N of M".
            const previous = draft.runsByConversation[conversationId] ?? []
            const seen = new Set(previous.map(r => r.id))
            draft.runsByConversation[conversationId] = [
              ...previous,
              ...response.runs.filter(r => !seen.has(r.id)),
            ]
          }
          draft.totalByConversation[conversationId] = response.total
          // Track pages in PANEL_PAGE_SIZE units, so a widened refresh read
          // (per_page = N × PANEL_PAGE_SIZE) still reports N pages held.
          draft.pageByConversation[conversationId] =
            page <= 1 ? Math.max(1, Math.ceil(response.runs.length / PANEL_PAGE_SIZE)) : page
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
      } finally {
        inFlight.delete(key)
      }
    }

    /** Load-more: fetch the page after the highest one already held. */
    const loadMoreConversationRuns = async (conversationId: string): Promise<void> => {
      const next = (get().pageByConversation[conversationId] ?? 1) + 1
      await loadConversationRuns(conversationId, next)
    }

    /**
     * Register/unregister a live consumer (a mounted footer or panel) for one
     * conversation. The live-refresh set is derived from THIS, not from the data
     * map — see `activeScopes`. Returns nothing; callers pair them in an effect's
     * setup/cleanup.
     */
    const retainConversationScope = (conversationId: string): void =>
      set(draft => {
        draft.activeScopes[conversationId] = (draft.activeScopes[conversationId] ?? 0) + 1
      })

    const releaseConversationScope = (conversationId: string): void =>
      set(draft => {
        const next = (draft.activeScopes[conversationId] ?? 0) - 1
        if (next > 0) draft.activeScopes[conversationId] = next
        else {
          delete draft.activeScopes[conversationId]
          // Drop the cached slice for a conversation nothing is showing any more,
          // so a long session cannot accumulate one list per conversation visited.
          delete draft.runsByConversation[conversationId]
          delete draft.totalByConversation[conversationId]
          delete draft.pageByConversation[conversationId]
          delete draft.loadingByConversation[conversationId]
          delete draft.errorByConversation[conversationId]
        }
      })

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
     * Refetch EVERY conversation scope that a live footer/panel is showing, each
     * with its own `conversation_id`.
     *
     * The set is `activeScopes` (mount-refcounted), NOT the data map. The footer
     * occupies `message_list_footer`, so it mounts in every conversation the user
     * opens and the data map gains a key for each — refreshing over THAT would
     * fire one request per conversation visited on every run state change, forever.
     * Refcounting bounds it to what is on screen and also covers a scope whose
     * first load failed (the data map only gains a key on success, so a failed
     * scope would never be retried by `sync:reconnect` — the very mechanism that
     * exists to recover it).
     *
     * The refresh reads page 1 with a WIDENED `per_page` covering the pages the
     * user has already loaded (see `loadConversationRuns`), so a live event cannot
     * silently collapse an expanded list back to its first page.
     *
     * An unscoped refetch is deliberately NOT issued: under the endpoint's disjoint
     * semantics that would return the conversation-LESS runs and blank every open
     * panel. See TEST-7.
     */
    const refreshTrackedConversations = async (): Promise<void> => {
      await Promise.all(
        Object.keys(get().activeScopes).map(id => loadConversationRuns(id, 1)),
      )
    }

    return {
      loadConversationRuns,
      loadMoreConversationRuns,
      refreshTrackedConversations,
      retainConversationScope,
      releaseConversationScope,
      loadNotes,
      loadRunDetail,
      /**
       * Cancel a non-terminal run. The server flips the row + emits
       * `sync:workflow_run` (→ the row refreshes to `cancelled`); we AWAIT a
       * refresh of every on-screen scope as a backstop, so a caller that awaits
       * `cancelRun` is guaranteed an up-to-date list on return (the card clears
       * its `cancelling` spinner on that promise). Throws on failure so the UI
       * layer toasts it (the store carries no per-mutation error state).
       */
      cancelRun: async (runId: string): Promise<BackgroundRunCancelAck> => {
        const ack = await ApiClient.Background.cancelRun({ run_id: runId })
        await refreshTrackedConversations()
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
    }
  },
  init: ({ on, actions }) => {
    // Live refresh: on any owner-scoped background-run state change and on SSE
    // reconnect, refetch EVERY conversation scope currently held — each with its
    // own conversation_id. Self-gated inside `loadConversationRuns`
    // (no-403-on-reconnect for a role without `background::use`).
    const reload = (): void => {
      void actions.refreshTrackedConversations()
    }
    on('sync:workflow_run', reload)
    on('sync:reconnect', reload)
  },
})

export const BackgroundRuns = registerLazyStore(BackgroundRunsDef)
export const useBackgroundRunsStore = BackgroundRunsDef.store
