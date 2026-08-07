import { ApiClient } from '@/api-client'
import type { CitationsSet } from '../state'

/**
 * Add existing library entries to a project's reference list.
 *
 * Membership only — the entries stay in the library and in every other project
 * they are linked to. The backend attaches in ONE transaction and answers with
 * the number actually inserted (already-linked ids are skipped), so the caller
 * reports the server's count, never `entryIds.length`.
 */
export default (set: CitationsSet, _get: () => never) => {
  return async (projectId: string, entryIds: string[]): Promise<number> => {
    if (entryIds.length === 0) return 0
    set(s => {
      s.attaching = true
      s.error = null
    })
    try {
      const resp = await ApiClient.Citations.attachToProject({
        project_id: projectId,
        entry_ids: entryIds,
      })
      set(s => {
        s.attaching = false
      })
      return resp.count ?? 0
    } catch (error) {
      set(s => {
        s.attaching = false
        s.error = error instanceof Error ? error.message : 'Attach failed'
      })
      throw error
    }
  }
}
