import { ApiClient } from '@/api-client'
import type { LlmProviderGet, LlmProviderSet } from '../state'

/**
 * Result of `POST /api/llm-models/{id}/validate`.
 *
 * The handler returns a raw `serde_json::Value`, so the generated client types
 * the response as `unknown` — this is the narrowing, kept here (one place) with
 * the two shapes the backend actually emits:
 *   remote → 200 `{ queued: false, valid: bool }`
 *   local  → 202 `{ queued: true, tier, message }` (the real verdict arrives
 *            later on the model's `validation_status`, via `sync:llm_model`)
 */
export type ValidateModelResult = {
  queued: boolean
  valid?: boolean
  message?: string
}

function narrow(raw: unknown): ValidateModelResult {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    queued: o.queued === true,
    valid: typeof o.valid === 'boolean' ? o.valid : undefined,
    message: typeof o.message === 'string' ? o.message : undefined,
  }
}

export default (set: LlmProviderSet, _get: LlmProviderGet) =>
  async (modelId: string): Promise<ValidateModelResult> => {
    set(state => ({
      validatingModels: { ...state.validatingModels, [modelId]: true },
    }))
    try {
      const raw = await ApiClient.LlmModel.validate({ model_id: modelId })
      set(state => ({
        validatingModels: { ...state.validatingModels, [modelId]: false },
      }))
      return narrow(raw)
    } catch (error) {
      set(state => ({
        error: error instanceof Error ? error.message : 'Failed to validate model',
        validatingModels: { ...state.validatingModels, [modelId]: false },
      }))
      throw error
    }
  }
