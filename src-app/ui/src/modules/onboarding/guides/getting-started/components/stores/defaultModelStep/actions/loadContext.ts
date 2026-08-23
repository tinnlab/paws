import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import { LlmModelDownload } from '@/modules/llm-provider/stores/llmModelDownload'
import { ModelPicker } from '@/modules/user-llm-providers/modelPicker'
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
 * A FAILURE here is recorded, not swallowed. Without the context the step
 * cannot tell "not installed" from "could not find out", and defaulting to the
 * former invites the user to re-download 5.68 GB they may already have.
 */
export default (set: DefaultModelStepSet, _get: DefaultModelStepGet) =>
  async (): Promise<void> => {
    set(draft => {
      draft.loading = true
      draft.contextUnavailable = false
    })
    try {
      await Promise.all([
        // The picker's own provider list is what "already installed" is derived
        // from. No permission guard here — `loadProviders` self-gates on
        // `user_llm_providers::read`, which is the repo's convention for these
        // shell-eager loads (the gate lives in the action, not the call site),
        // and duplicating it would mean maintaining the permission twice.
        ModelPicker.loadProviders(),
        hasPermissionNow(Permissions.RuntimeVersionRead)
          ? RuntimeDownloadProgress.loadActive()
          : Promise.resolve(),
        // Touch the download store so its lazy `init` (which subscribes to
        // progress for anything already running) has fired by the time the
        // step renders.
        Promise.resolve(LlmModelDownload.$.downloads),
      ])
    } catch {
      set(draft => {
        draft.contextUnavailable = true
      })
    } finally {
      set(draft => {
        draft.loading = false
      })
    }
  }
