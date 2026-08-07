import type { StoreSet } from '@ziee/framework/store-kit'
import type {
  HealthCheckResponse,
  InstanceResponse,
  InstanceStatusResponse,
  VersionUsageResponse,
} from '@/api-client/types'
import type { RuntimeEngine } from '../../types'

export const runtimeModelUsageState = {
  // Per-engine usage snapshot (versions + the models that resolve to each).
  usage: new Map<RuntimeEngine, VersionUsageResponse>(),
  // Per-engine load-in-flight.
  loading: new Map<RuntimeEngine, boolean>(),
  // Per-model action-in-flight (start/stop/restart/swap), keyed by model id.
  acting: new Map<string, boolean>(),
  // Per-model running-instance detail, lazily loaded. `null` = fetched, none.
  instances: new Map<string, InstanceResponse | null>(),
  // Per-model runtime STATE (`stopped` / `starting` / `running` / `failed`),
  // which the usage snapshot's boolean `running` cannot express — `failed` is
  // the one an operator has to see, because auto-start gives up after 5 crashes
  // in 60s and the model then sits latched until the latch is cleared.
  statuses: new Map<string, InstanceStatusResponse>(),
  // Per-model result of the last on-demand health probe.
  health: new Map<string, HealthCheckResponse>(),
  error: null as string | null,
}

export type RuntimeModelUsageState = typeof runtimeModelUsageState
export type RuntimeModelUsageSet = StoreSet<RuntimeModelUsageState>
export type RuntimeModelUsageGet = () => RuntimeModelUsageState
