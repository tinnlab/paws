import { ApiClient } from '@/api-client'
import type { RuntimeEngine } from '../../../types'
import { emitRuntimeModelUsageChanged } from '../../../events/emitters'
import actFactory from './_act'
import loadStatusFactory from './loadStatus'
import loadUsageFactory from './loadUsage'
import type { RuntimeModelUsageGet, RuntimeModelUsageSet } from '../state'

/**
 * Clear a model's `failed` latch — `POST /local-runtime/models/{id}/clear-failed`.
 *
 * `auto_start` gives up after 5 crashes in 60s and latches the model `failed`;
 * nothing clears that latch except this call or a server restart. With no UI, a
 * model that flapped once was stuck until an operator restarted the whole
 * server — this is the recovery control.
 *
 * Refreshes both the usage snapshot and the model's status so the row reflects
 * the reset (`state: "stopped"`) without the operator re-probing.
 */
export default (set: RuntimeModelUsageSet, get: RuntimeModelUsageGet) => {
  const act = actFactory(set)
  const loadUsage = loadUsageFactory(set, get)
  const loadStatus = loadStatusFactory(set, get)
  return async (engine: RuntimeEngine, modelId: string) => {
    const resp = await act(modelId, () =>
      ApiClient.LocalRuntime.clearFailed({ model_id: modelId }),
    )
    await loadUsage(engine)
    await loadStatus(modelId)
    await emitRuntimeModelUsageChanged(modelId)
    return resp
  }
}
