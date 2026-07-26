import { filterByCapability, loadLlmModelCatalog } from '@/core/llmModelCatalog'
import type { FileRagAdminSet } from '../state'
import toRow from './_toRow'

export default (set: FileRagAdminSet) =>
  async () => {
    try {
      const models = filterByCapability(await loadLlmModelCatalog(), 'rerank')
      set(s => {
        s.rerankerModels = models.map(toRow)
      })
    } catch {
      /* non-fatal — the reranker section shows the hub nudge when empty */
    }
  }
