import { ApiClient } from '@/api-client'
import type { ConversationSummarizationGet, ConversationSummarizationSet } from '../state'

export default (set: ConversationSummarizationSet, get: ConversationSummarizationGet) =>
  async (conversationId: string, opts?: { force?: boolean }) => {
    // In-flight guard: two triggers can legitimately land in the same tick — the
    // pill's open/switch effect and the extension's `afterStreamComplete` hook —
    // and without this they would both reach the wire. The audit counts
    // REQUESTS, so this is the backstop that makes "one read per turn" hold even
    // under that race.
    //
    // `force` exists because a same-URL de-dup is only safe when both callers
    // want the same FRESHNESS. The turn-end read does not: if an open read
    // issued a moment earlier (pre-write) is still on the wire, silently
    // adopting its answer would leave the pre-turn summary on screen with
    // nothing left to correct it. So the turn-end caller passes `force` and
    // always performs its own round-trip. (Mirrors `Auth.refreshCurrentUser`'s
    // `{ force: true }` opt-out of its freshness window.)
    const inFlight = get()
    if (
      !opts?.force &&
      inFlight.loading &&
      inFlight.requestedConversationId === conversationId
    )
      return
    set(s => {
      // Drop stale `current` when loading a different conversation.
      if (s.current && s.current.conversationId !== conversationId) s.current = null
      s.requestedConversationId = conversationId
      s.loading = true
      s.error = null
    })
    try {
      const summary = await ApiClient.Summarization.getConversationSummary({ id: conversationId })
      // Switched while in flight → drop.
      if (get().requestedConversationId !== conversationId) {
        set(s => { s.loading = false })
        return
      }
      set(s => {
        s.current = { conversationId, summary }
        s.loading = false
      })
    } catch (error) {
      if (get().requestedConversationId !== conversationId) {
        set(s => { s.loading = false })
        return
      }
      set(s => {
        s.error = error instanceof Error ? error.message : 'Failed to load summary'
        s.loading = false
      })
    }
  }
