import { ApiClient } from '@/api-client'
import actFactory from './_act'
import type { RuntimeModelUsageGet, RuntimeModelUsageSet } from '../state'

/**
 * Probe a running model's engine — `GET /local-runtime/models/{id}/health`.
 *
 * "The process is up" (what the row's dot shows) and "the engine answers" are
 * different things: a wedged llama-server stays `running` while every request
 * times out. This is the check that distinguishes them.
 */
export default (set: RuntimeModelUsageSet, _get: RuntimeModelUsageGet) => {
  const act = actFactory(set)
  return async (modelId: string) => {
    const health = await act(modelId, () =>
      ApiClient.LocalRuntime.healthCheck({ model_id: modelId }),
    )
    set(state => ({ health: new Map(state.health).set(modelId, health) }))
    return health
  }
}
