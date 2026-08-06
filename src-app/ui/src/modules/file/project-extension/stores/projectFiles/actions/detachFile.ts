import { ApiClient } from '@/api-client'
import { emitProjectFileDetached } from '@/modules/file/project-extension/events'
import type { ProjectFilesGet, ProjectFilesSet } from '../state'

/**
 * DETACH — drops the project↔file membership only.
 *
 * This must NEVER call `ApiClient.File.delete`: that endpoint destroys the file
 * in the user's whole LIBRARY, so removing a file from one project silently
 * deleted it from every OTHER project it was attached to (and from the
 * conversations referencing it). `Project.detachFile` is documented as "Does NOT
 * delete the underlying file" and is the only correct call from a
 * project-scoped list — the same membership-only removal the sibling
 * knowledge-base panel performs via `KnowledgeBase.removeDocument`.
 */
export default (set: ProjectFilesSet, _get: ProjectFilesGet) =>
  async (projectId: string, fileId: string) => {
    try {
      set({ detaching: true, error: null })
      await ApiClient.Project.detachFile({ id: projectId, file_id: fileId })
      await emitProjectFileDetached(projectId, fileId)
      set({ detaching: false })
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to remove file from project',
        detaching: false,
      })
      throw error
    }
  }
