import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/**
 * Clear the orchestration error so a Retry starts from a clean state.
 *
 * Only the step's OWN error is cleared — a failed `DownloadInstance` is server
 * state and stays where it is; the next attempt supersedes it.
 */
export default (set: DefaultModelStepSet, _get: DefaultModelStepGet) => (): void => {
  set(draft => {
    draft.error = null
    draft.runtimeUnavailable = false
  })
}
