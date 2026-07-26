import { filterByCapability, loadLlmModelCatalog } from '@/core/llmModelCatalog'
import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import type {
  SummarizationAdminGet,
  SummarizationAdminSet,
  SummarizationModelRow,
} from '../state'

export default (set: SummarizationAdminSet, _get: SummarizationAdminGet) =>
  async () => {
    // The picker lists `/api/llm-models` (requires LlmModelsRead). A user who
    // only holds summarization::settings::read can VIEW but must not trigger
    // that fetch (would 403 — no-403 self-gating rule). Skip quietly.
    if (!hasPermissionNow(Permissions.LlmModelsRead)) {
      set(s => {
        s.availableModels = []
        s.loadingModels = false
      })
      return
    }
    set(s => {
      s.loadingModels = true
    })
    try {
      // Any chat-capable model can summarize — pass `chat` (an earlier draft
      // passed `text_completion`, which the backend rejects with 400).
      // Shared catalog + the same `capabilities.chat === true` rule the server
      // applies to `?capability=chat` — one fetch shared with the other pickers.
      const models = filterByCapability(await loadLlmModelCatalog(), 'chat')
      const rows: SummarizationModelRow[] = models.map(m => ({
        id: m.id,
        name: m.name,
        display_name: m.display_name,
        provider_id: m.provider_id,
      }))
      set(s => {
        s.availableModels = rows
        s.loadingModels = false
      })
    } catch (error) {
      set(s => {
        s.error = error instanceof Error ? error.message : 'Failed to load models'
        s.loadingModels = false
      })
    }
  }
