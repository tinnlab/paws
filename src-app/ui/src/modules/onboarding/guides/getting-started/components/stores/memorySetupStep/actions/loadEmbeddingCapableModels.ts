import { filterByCapability, loadLlmModelCatalog } from '@/core/llmModelCatalog'
import type { EmbeddingCapableModel } from '../state'
import type { MemorySetupStepGet, MemorySetupStepSet } from '../state'

export default (set: MemorySetupStepSet, _get: MemorySetupStepGet) =>
  async () => {
    set(draft => {
      draft.loading = true
      draft.error = null
    })
    try {
      // Shared catalog + the same `capabilities.text_embedding === true` rule
      // the server applies to `?capability=text_embedding`.
      const embedders = filterByCapability(await loadLlmModelCatalog(), 'text_embedding')
      const models: EmbeddingCapableModel[] = embedders.map(m => ({
        id: m.id,
        name: m.name,
        display_name: m.display_name,
        provider_id: m.provider_id,
      }))
      set(draft => {
        draft.availableModels = models
        draft.loading = false
      })
    } catch (e: any) {
      set(draft => {
        draft.error = e?.message || 'Failed to load embedding-capable models'
        draft.loading = false
      })
    }
  }
