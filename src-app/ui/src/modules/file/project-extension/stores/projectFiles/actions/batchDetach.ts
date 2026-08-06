import { ApiClient } from '@/api-client'
import { emitProjectFileDetached } from '@/modules/file/project-extension/events'
import type { ProjectFilesGet, ProjectFilesSet } from '../state'

/**
 * Multi-select sibling of `detachFile` — same membership-only contract, so the
 * same rule applies: never `ApiClient.File.delete` here. A per-item failure is
 * recorded and the loop continues, so one 404 can't strand the rest of the
 * selection.
 */
export default (set: ProjectFilesSet, get: ProjectFilesGet) =>
  async (projectId: string) => {
    const ids = Array.from(get().selectedFileIds)
    if (ids.length === 0) return
    set({ detaching: true, error: null })
    for (const fileId of ids) {
      try {
        await ApiClient.Project.detachFile({ id: projectId, file_id: fileId })
        await emitProjectFileDetached(projectId, fileId)
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : `Failed to remove ${fileId} from this project`,
        })
      }
    }
    set(state => {
      state.detaching = false
      state.selectedFileIds.clear()
    })
  }
