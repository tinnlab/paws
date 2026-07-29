import { filterByCapability, loadLlmModelCatalog } from '@/core/llmModelCatalog'
import type { FileRagAdminSet } from '../state'
import toRow from './_toRow'

export default (set: FileRagAdminSet) =>
  async () => {
    set(s => {
      s.loadingModels = true
    })
    try {
      // Filtered to `text_embedding` so the picker isn't crowded by chat
      // models (same rationale as the memory admin store) — now through the
      // shared catalog, so it costs no extra round-trip.
      const models = filterByCapability(await loadLlmModelCatalog(), 'text_embedding')
      set(s => {
        s.embeddingModels = models.map(toRow)
        s.loadingModels = false
      })
    } catch (error) {
      set(s => {
        s.error = error instanceof Error ? error.message : 'Failed to load models'
        s.loadingModels = false
      })
    }
  }
