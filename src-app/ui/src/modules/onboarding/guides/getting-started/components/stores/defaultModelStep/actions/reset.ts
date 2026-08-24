import { defaultModelStepState } from '../state'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/**
 * Clear the step's orchestration state when the wizard is left.
 *
 * Store-kit's `__destroy__` tears down listeners but does NOT restore initial
 * state, and the wizard already resets its two sibling step stores on unmount.
 * Without this, a failure from one visit (`error`, `runtimeKey`) survives and
 * re-renders "The model couldn't be installed" on a later, unrelated visit to
 * the step — an error message about an attempt the user never made.
 *
 * Only this store's own state is cleared. The download stores are deliberately
 * untouched: a transfer in flight must survive leaving the wizard (INV-6).
 */
export default (set: DefaultModelStepSet, _get: DefaultModelStepGet) => (): void => {
  set(() => ({ ...defaultModelStepState }))
}
