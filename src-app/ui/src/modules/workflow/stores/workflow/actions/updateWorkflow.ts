import { ApiClient } from '@/api-client'
import type { UpdateWorkflow } from '@/api-client/types'
import type { Workflow, WorkflowGet, WorkflowSet } from '../state'

/**
 * Edit a user-scope workflow's METADATA (display name / description / tags /
 * enabled) — `PUT /api/workflows/{id}`.
 *
 * Deliberately separate from the builder's `Workflow.updateDefinition`, which
 * replaces the bundle. This is the only way to disable a workflow or rename it
 * without re-authoring its steps, and it had no caller at all: skills shipped
 * the equivalent, workflows didn't.
 *
 * Mirrors `skill/actions/updateSkill.ts` down to the `operationsLoading` keying.
 */
export default (set: WorkflowSet, _get: WorkflowGet) => {
  return async (id: string, data: UpdateWorkflow): Promise<Workflow> => {
    set(draft => {
      draft.operationsLoading[id] = true
      draft.error = null
    })
    try {
      const updated = await ApiClient.Workflow.update({ id, ...data })
      set(draft => {
        const idx = draft.workflows.findIndex(w => w.id === id)
        if (idx >= 0) draft.workflows[idx] = updated
        delete draft.operationsLoading[id]
      })
      return updated
    } catch (error) {
      set(draft => {
        delete draft.operationsLoading[id]
        draft.error =
          error instanceof Error ? error.message : 'Failed to update workflow'
      })
      throw error
    }
  }
}
