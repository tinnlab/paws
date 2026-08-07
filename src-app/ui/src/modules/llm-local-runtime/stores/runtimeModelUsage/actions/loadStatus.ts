import { ApiClient } from '@/api-client'
import actFactory from './_act'
import type { RuntimeModelUsageGet, RuntimeModelUsageSet } from '../state'

/**
 * Fetch one model's runtime STATE — `GET /local-runtime/models/{id}/status`.
 *
 * Distinct from `loadInstance`: an instance row only exists while a process is
 * up, so a crashed/`failed` model has no instance and the UI could not tell
 * "never started" from "gave up after five crashes". This is the only endpoint
 * that answers that, and it had no caller.
 */
export default (set: RuntimeModelUsageSet, _get: RuntimeModelUsageGet) => {
  const act = actFactory(set)
  return async (modelId: string) => {
    const status = await act(modelId, () =>
      ApiClient.LocalRuntime.getStatus({ model_id: modelId }),
    )
    set(state => ({ statuses: new Map(state.statuses).set(modelId, status) }))
    return status
  }
}
