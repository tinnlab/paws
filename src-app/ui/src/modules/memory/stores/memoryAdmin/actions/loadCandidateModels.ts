import { filterByCapability, loadLlmModelCatalog } from '@/core/llmModelCatalog'
import type { MemoryAdminGet, MemoryAdminSet } from '../state'

const toRow = (m: import('@/api-client/types').LlmModel) => ({
  id: m.id,
  name: m.name,
  display_name: m.display_name,
  provider_id: m.provider_id,
  capabilities: m.capabilities,
})

export default (set: MemoryAdminSet, _get: MemoryAdminGet) => async () => {
  set(s => {
    s.loadingModels = true
  })
  try {
    // ONE fetch through the shared catalog (was two: unfiltered + a
    // server-side `capability=text_embedding` filter). The embedding filter is
    // applied client-side with the SAME rule the server uses, so both pickers
    // show identical rows for one round-trip instead of two.
    const all = await loadLlmModelCatalog()
    set(s => {
      // Extraction picker = all models MINUS embedders ("not an embedder"
      // rather than "is chat", so a chat model with no capability flag
      // still appears).
      // Both lists use the SAME predicate (`capabilities.text_embedding ===
      // true`, the server's rule) so a model with a non-boolean flag cannot
      // fall out of both pickers.
      const embedders = new Set(filterByCapability(all, 'text_embedding'))
      s.availableModels = all.filter(m => !embedders.has(m)).map(toRow)
      s.embeddingModels = [...embedders].map(toRow)
      s.loadingModels = false
    })
  } catch (error) {
    set(s => {
      s.error = error instanceof Error ? error.message : 'Failed to load models'
      s.loadingModels = false
    })
  }
}
