/**
 * Shared, request-coalesced LLM model catalog.
 *
 * WHY: `GET /api/llm-models` was fetched by three independent stores on a single
 * app load (memory-admin twice — unfiltered + `capability=text_embedding` — and
 * summarization-admin once with `capability=chat`), producing the live-ui-audit
 * `duplicate request: GET /api/llm-models fired 3× within step "(load)"`
 * finding. Nothing about those three needs three round-trips: they all want a
 * slice of the SAME list.
 *
 * This module fetches the model list ONCE and hands every caller the rows to
 * filter. Two mechanisms:
 *   1. in-flight coalescing — overlapping callers share the same promise;
 *   2. a short freshness TTL — callers that land microseconds APART (three
 *      separate store inits do not necessarily overlap) still share one fetch.
 *
 * Deliberately a plain module, not a store: the consumers live in five different
 * modules and reading another module's store is the documented anti-pattern
 * (CODING_GUIDELINES §9). This is a fetch utility, so it introduces no
 * cross-module state coupling.
 */
import { ApiClient } from '@/api-client'
import type { LlmModel } from '@/api-client/types'
import { createCoalescedLoader, type CoalescedLoader } from '@/core/coalescedLoader'
import { useEventBusStore } from '@ziee/framework/events'

// Re-exported so a caller needs ONE import for "load the catalog, then filter it".
export { filterByCapability, type ModelCapabilityName } from '@/core/llmModelCapabilities'

/**
 * Freshness window. Long enough to collapse one page-load burst, far shorter
 * than any human edit-a-model-then-open-a-picker loop. A model mutation
 * additionally invalidates the catalog immediately via `sync:llm_model`, so
 * this TTL is a coalescing window, not the staleness bound.
 */
export const CATALOG_TTL_MS = 2000

/** Rows fetched per request while walking the list. */
export const CATALOG_PAGE_SIZE = 200

/**
 * Safety stop on the page walk. 10 × 200 = 2000 models is far beyond any real
 * deployment; the bound exists so a server bug that mis-reports `total` cannot
 * turn a picker load into an unbounded request loop.
 */
export const CATALOG_MAX_PAGES = 10

/**
 * Fetch the model list, following pagination until the server's `total` is
 * reached (bounded by `CATALOG_MAX_PAGES`).
 *
 * The walk is REQUIRED for correctness, not thoroughness: the server applies
 * `?capability=` BEFORE paginating (`llm_model/handlers/models.rs` retains, then
 * slices), so the old per-caller `?capability=X&perPage=200` returned up to 200
 * MATCHING models. Fetching only the first 200 rows of the UNFILTERED list and
 * filtering client-side would silently drop any embedder/reranker/chat model
 * ranked past row 200 on a large deployment. Walking to `total` restores exact
 * parity, and costs exactly ONE request on any deployment with ≤200 models.
 */
async function fetchAllModels(): Promise<LlmModel[]> {
  const first = await ApiClient.LlmModel.list({ page: 1, perPage: CATALOG_PAGE_SIZE })
  const models = [...(first.models ?? [])]
  const total = typeof first.total === 'number' ? first.total : models.length

  for (let page = 2; models.length < total && page <= CATALOG_MAX_PAGES; page += 1) {
    const next = await ApiClient.LlmModel.list({ page, perPage: CATALOG_PAGE_SIZE })
    const rows = next.models ?? []
    if (rows.length === 0) break
    models.push(...rows)
  }
  return models
}

/**
 * The deployment's LLM models.
 *
 * Rejects exactly like the underlying `ApiClient` call, so each caller keeps its
 * own error handling (and its own permission self-gate — this helper does NOT
 * gate, because different callers hold different permissions).
 */
export const loadLlmModelCatalog: CoalescedLoader<LlmModel[]> = createCoalescedLoader(
  fetchAllModels,
  CATALOG_TTL_MS,
)

/**
 * Drop the cached catalog so the next read re-fetches.
 *
 * Wired below to the `llm_model` sync entity, so any model create / update /
 * delete (from this device or another) invalidates every picker's shared view
 * immediately rather than after the TTL.
 */
export function invalidateLlmModelCatalog(): void {
  loadLlmModelCatalog.invalidate()
}

// Module-level, once per app: the catalog is a process-wide cache, so its
// invalidation belongs with it rather than being duplicated into each consuming
// store. `sync:<entity>` is the notify-and-refetch signal; we only DROP the
// cache — the next reader refetches through the normal permission-checked
// endpoint, so no data rides this subscription.
useEventBusStore.getState().on('sync:llm_model', () => {
  invalidateLlmModelCatalog()
})
