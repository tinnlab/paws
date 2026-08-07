import { ApiClient } from '@/api-client'
import type { CitationsSet } from '../state'

/**
 * Unlink ONE entry from a project's reference list.
 *
 * Deliberately NOT `Citations.delete` (`DELETE /api/citations/{id}`), which
 * destroys the entry in the library and therefore in every other project that
 * references it. The project panel is project-scoped, so its removal affordance
 * must be membership-scoped too — the same distinction the sibling project-files
 * panel got wrong and had to be fixed for.
 */
export default (set: CitationsSet, _get: () => never) => {
  return async (projectId: string, entryId: string): Promise<void> => {
    set(s => {
      s.detaching = true
      s.error = null
    })
    try {
      await ApiClient.Citations.detachFromProject({
        project_id: projectId,
        entry_id: entryId,
      })
      set(s => {
        s.detaching = false
      })
    } catch (error) {
      set(s => {
        s.detaching = false
        s.error = error instanceof Error ? error.message : 'Remove failed'
      })
      throw error
    }
  }
}
