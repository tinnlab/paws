import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import { LlmModelDownload } from '@/modules/llm-provider/stores/llmModelDownload'
import { LlmProvider as LlmProviderStore } from '@/modules/llm-provider/stores/llmProvider'
import { RuntimeDownloadProgress } from '@/modules/llm-local-runtime/stores/runtimeDownloadProgress'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/**
 * Populate the stores this step DERIVES its view from, on mount.
 *
 * This loads nothing of its own — it just makes sure the shared stores are
 * warm, so a step entered for the first time (or re-entered after the user went
 * off to look at settings) shows the true current state rather than an empty
 * one that fills in later. `RuntimeDownloadProgress.loadActive()` is what
 * re-attaches to a runtime download already in flight; `LlmModelDownload`'s own
 * store `init` does the same for weights transfers.
 *
 * Each load is permission-gated so a user without the admin reads does not
 * generate 403s just by walking through Onboarding.
 */
export default (set: DefaultModelStepSet, _get: DefaultModelStepGet) =>
  async (): Promise<void> => {
    set(draft => {
      draft.loading = true
    })
    try {
      const canReadProviders = hasPermissionNow({
        allOf: [Permissions.LlmProvidersRead, Permissions.LlmModelsRead],
      })
      await Promise.all([
        canReadProviders ? LlmProviderStore.loadLlmProviders() : Promise.resolve(),
        hasPermissionNow(Permissions.RuntimeVersionRead)
          ? RuntimeDownloadProgress.loadActive()
          : Promise.resolve(),
        // Touch the download store so its lazy `init` (which subscribes to
        // progress for anything already running) has fired by the time the
        // step renders.
        Promise.resolve(LlmModelDownload.$.downloads),
      ])
    } finally {
      set(draft => {
        draft.loading = false
      })
    }
  }
