import { defineStore, registerLazyStore } from '@ziee/framework/store-kit'
import { defaultModelStepState, type DefaultModelStepState } from './state'
import type { Actions } from './actions.gen'

/**
 * Store for the Onboarding "Local Model" step.
 *
 * It holds ORCHESTRATION state only (which leg is running, and any error the
 * orchestration itself produced). Transfer state — bytes, percent, status — is
 * never copied here: it is read live from `LlmModelDownload` and
 * `RuntimeDownloadProgress`, so a download started from this step keeps running
 * and stays visible when the user walks away (INV-6), and the step re-attaches
 * to it simply by re-deriving on the next render (DEC-9).
 */
const DefaultModelStepDef = defineStore<DefaultModelStepState, Actions>(
  'DefaultModelStep',
  {
    immer: true,
    state: defaultModelStepState,
    actions: import.meta.glob('./actions/*.ts'),
  },
)

export const DefaultModelStep = registerLazyStore(DefaultModelStepDef)
export const useDefaultModelStepStore = DefaultModelStepDef.store

// Raw store for direct access (Stores proxy uses this).
export { DefaultModelStepDef }
