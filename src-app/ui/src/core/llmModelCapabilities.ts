/**
 * Pure, dependency-free helpers for reasoning about a model's capabilities.
 *
 * Separate from `llmModelCatalog.ts` (which pulls in the generated `ApiClient`)
 * so the server-parity filter can be unit-tested directly.
 */
import type { LlmModel, ModelCapabilities } from '@/api-client/types'

/**
 * A boolean capability flag as the API spells it (`capabilities.<name>`).
 *
 * DERIVED from the generated `ModelCapabilities` rather than hand-listed, so a
 * capability added, renamed, or removed by an OpenAPI regen changes this union
 * (and breaks the build at any stale call site) instead of drifting silently.
 * Non-boolean members such as `context_length` are excluded by construction.
 */
export type ModelCapabilityName = {
  [K in keyof ModelCapabilities]-?: boolean extends NonNullable<ModelCapabilities[K]>
    ? K
    : never
}[keyof ModelCapabilities]

/**
 * Client-side equivalent of the server's `?capability=` filter.
 *
 * The server does `capabilities.<cap>` → `as_bool()` → `unwrap_or(false)`
 * (`llm_model/handlers/models.rs`), i.e. ONLY an explicit `true` keeps the
 * model; absent / false / non-boolean all exclude it. This reproduces that rule
 * exactly — see `loadLlmModelCatalog`, which walks every page so the SET this
 * filter runs over is the same set the server would have filtered.
 */
export function filterByCapability(
  models: LlmModel[],
  capability: ModelCapabilityName,
): LlmModel[] {
  return models.filter(
    m => (m.capabilities as Record<string, unknown> | undefined)?.[capability] === true,
  )
}
