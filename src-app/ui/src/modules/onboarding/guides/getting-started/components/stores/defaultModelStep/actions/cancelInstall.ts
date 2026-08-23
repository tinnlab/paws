import { LlmModelDownload } from '@/modules/llm-provider/stores/llmModelDownload'
import { activeDefaultModelDownload } from '../viewState'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/**
 * Cancel the weights download the user started from this step.
 *
 * Only the weights leg is cancellable — the runtime leg has no cancel endpoint
 * and is small enough (tens of MB) that offering a control we cannot honour
 * would be worse than not offering one.
 *
 * Cancelling is safe with respect to INV-4 by construction on the server: the
 * `llm_models` row is created only after a download COMPLETES, so a cancel can
 * never leave a half-installed model behind.
 */
export default (set: DefaultModelStepSet, _get: DefaultModelStepGet) =>
  async (): Promise<void> => {
    const active = activeDefaultModelDownload(LlmModelDownload.$.downloads)
    if (!active) return
    set(draft => {
      draft.cancelError = null
    })
    try {
      await LlmModelDownload.cancelLlmModelDownload(active.id)
    } catch (e: unknown) {
      // NOT `error`: the download is still running, so the view is still
      // `downloading` — where the install-failure alert is not rendered. Writing
      // it to `error` would show the user nothing at the moment they need it,
      // and then resurface this text later under "The model couldn't be
      // installed", attached to a Retry that restarts the whole transfer.
      set(draft => {
        draft.cancelError =
          e instanceof Error
            ? `The download couldn't be cancelled: ${e.message}`
            : "The download couldn't be cancelled."
      })
    }
  }
