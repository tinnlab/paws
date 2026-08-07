import { ApiClient } from '@/api-client'
import { emitLlmProviderUpdated } from '@/modules/llm-provider/events'
import type { LlmProviderGet, LlmProviderSet } from '../state'

/**
 * Rotate a LOCAL provider's proxy token — `POST /llm-providers/{id}/rotate-proxy-token`.
 *
 * The token authenticates OpenAI-compatible clients against the same-port proxy
 * at `/api/local-llm/v1/*`. It is stored write-only (the provider GET never
 * returns it), so the returned `plaintext_api_key` is the ONLY moment it exists
 * client-side — the caller must show it once and say so. The store deliberately
 * does not keep it: parking a live credential in a Zustand store would leak it
 * into every devtools snapshot for the rest of the session.
 *
 * Shape copied from `refreshProviderModels` (per-provider in-flight map keyed by
 * provider id, error captured on the store, rethrown for the caller's toast).
 */
export default (set: LlmProviderSet, _get: LlmProviderGet) =>
  async (providerId: string): Promise<string> => {
    set(state => ({
      rotatingProxyToken: { ...state.rotatingProxyToken, [providerId]: true },
    }))
    try {
      const resp = await ApiClient.LlmProvider.rotateProxyToken({
        provider_id: providerId,
      })
      set(state => ({
        providers: state.providers.map(p =>
          p.id === providerId
            ? { ...p, ...resp.provider, llm_models: p.llm_models }
            : p,
        ),
        rotatingProxyToken: { ...state.rotatingProxyToken, [providerId]: false },
      }))
      try {
        await emitLlmProviderUpdated(resp.provider)
      } catch (eventError) {
        console.error('Failed to emit llm provider updated event:', eventError)
      }
      return resp.plaintext_api_key
    } catch (error) {
      set(state => ({
        error:
          error instanceof Error ? error.message : 'Failed to rotate proxy token',
        rotatingProxyToken: { ...state.rotatingProxyToken, [providerId]: false },
      }))
      throw error
    }
  }
