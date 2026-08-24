import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_CAPABILITIES,
} from '@/modules/onboarding/guides/getting-started/defaultModel'
import { LlmModelDownload } from '@/modules/llm-provider/stores/llmModelDownload'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'
import ensureLocalProviderFactory from './ensureLocalProvider'
import ensureRuntimeFactory from './ensureRuntime'

/**
 * Install the default local model, end to end.
 *
 * Three legs in order — enable a local provider to install into, provision the
 * llama.cpp runtime that will serve it, then download the weights. The order
 * matters: the first two are cheap and are the difference between "a file on
 * disk" and "a working model" (INV-2), so failing them AFTER a 5.68 GB transfer
 * would waste the user's bandwidth to reach the same dead end.
 *
 * This returns as soon as the weights transfer has been REGISTERED. It does not
 * await the transfer: the download runs server-side, its progress is read from
 * `LlmModelDownload`, and awaiting it here would tie a multi-GB transfer to the
 * lifetime of a wizard step the user is free to leave (INV-6 / DEC-9).
 */
export default (set: DefaultModelStepSet, get: DefaultModelStepGet) => {
  const ensureLocalProvider = ensureLocalProviderFactory(set, get)
  const ensureRuntime = ensureRuntimeFactory(set, get)

  return async (): Promise<void> => {
    // Re-entrancy guard. The install button is hidden while an orchestration
    // runs, but a double-click can land two calls before the first render, and
    // two concurrent runs would each enable the provider and race the runtime
    // leg's `setDefaultVersion`. Only the weights leg is de-duplicated, and only
    // server-side (`find_existing_in_progress`), so this is the guard for the
    // other two legs.
    if (get().installing) return

    set(draft => {
      draft.installing = true
      draft.error = null
      draft.runtimeUnavailable = false
      draft.stage = 'provider'
    })

    try {
      const { providerId, problem } = await ensureLocalProvider()
      if (!providerId) {
        throw new Error(
          problem ??
            'No local provider is available to install into. An administrator can add or enable one in Settings → LLM Providers.',
        )
      }

      set(draft => {
        draft.stage = 'runtime'
      })
      const runtime = await ensureRuntime()
      if (runtime === 'unavailable') {
        // Surfaced as its own state, not an error. Stopping here is deliberate:
        // a 5.68 GB download that nothing can serve is worse than an honest
        // "no runtime available for this machine".
        set(draft => {
          draft.installing = false
          draft.stage = 'idle'
        })
        return
      }
      if (runtime === 'failed') {
        throw new Error(
          'The local runtime could not be installed, so the model would have nothing to run on.',
        )
      }

      set(draft => {
        draft.stage = 'model'
      })
      await LlmModelDownload.downloadLlmModelFromRepository({
        provider_id: providerId,
        repository_id: DEFAULT_MODEL.repositoryId,
        // Relative to the repository row's ORG-SCOPED base — the server joins
        // the two, so this must NOT be org-qualified.
        repository_path: DEFAULT_MODEL.repositoryPath,
        repository_branch: DEFAULT_MODEL.repositoryBranch,
        main_filename: DEFAULT_MODEL.mainFilename,
        name: DEFAULT_MODEL.name,
        display_name: DEFAULT_MODEL.displayName,
        description: DEFAULT_MODEL.description,
        file_format: DEFAULT_MODEL.fileFormat,
        capabilities: { ...DEFAULT_MODEL_CAPABILITIES },
        parameters: {},
        engine_type: DEFAULT_MODEL.engineType,
        engine_settings: {},
      })
    } catch (e: unknown) {
      set(draft => {
        draft.error = e instanceof Error ? e.message : 'The install could not be started.'
      })
    } finally {
      set(draft => {
        draft.installing = false
        draft.stage = 'idle'
      })
    }
  }
}
