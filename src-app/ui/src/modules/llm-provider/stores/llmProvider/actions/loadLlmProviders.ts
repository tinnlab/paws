import { ApiClient } from '@/api-client'
import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import { sortProviders } from '@/modules/llm-provider/sortProviders'
import type { LlmProviderGet, LlmProviderSet } from '../state'

/**
 * In-flight de-duplication + forced-refresh coalescing.
 *
 * ## The bug this replaces
 *
 * The guard used to be:
 *
 *     if ((state.isInitialized && !force) || state.loading) return
 *
 * The `|| state.loading` clause short-circuits **even when `force` is true**, and
 * it returns an already-resolved promise. Every `sync:*` handler on this store
 * calls `loadLlmProviders(true)`, so a realtime frame that landed while another
 * load was outstanding was **dropped on the floor, silently, with no retry** —
 * the store kept whatever it had until something else happened to reload it.
 * That is the same "the server is right and the client never hears" family as
 * the two defects PR #12 fixed, and it was already worked around at one call
 * site (`onboarding/.../ensureLocalProvider.ts`) by bypassing this store
 * entirely and reading the API directly, with a comment naming all three
 * silent-return cases.
 *
 * ## Why joining the in-flight load is NOT sufficient for a forced call
 *
 * The sibling fix in `llmRepository/actions/loadLlmRepositories.ts` returns the
 * pending promise so concurrent callers share one request. That is right for
 * de-duplication, but it is WRONG for `force`: a `sync:llm_provider` frame means
 * "the server state just changed", and the in-flight request may have been
 * issued BEFORE that change — so joining it resolves against pre-change data and
 * the refresh is still effectively lost, just less visibly.
 *
 * So the two cases are handled differently, on purpose:
 *
 *  - **not forced, load in flight** → return the in-flight promise. Exactly one
 *    HTTP round-trip, and `await` means what callers assume it means.
 *  - **forced, load in flight** → run again AFTER it settles. Multiple forced
 *    calls arriving during one load collapse into a SINGLE queued re-run, so a
 *    burst of sync frames cannot turn into a burst of requests.
 *
 * Held module-side rather than in state because the store is immer-backed and a
 * Promise must not be frozen.
 */
let inFlight: Promise<void> | null = null
/** The single queued re-run that a forced call schedules behind `inFlight`. */
let queuedForced: Promise<void> | null = null

export default (set: LlmProviderSet, get: LlmProviderGet) =>
  async (force = false): Promise<void> => {
    // Loads providers AND each provider's models — gate on BOTH reads so a
    // sub-admin holding only one perm doesn't 403 on the other during resync.
    if (!hasPermissionNow({ allOf: [Permissions.LlmProvidersRead, Permissions.LlmModelsRead] })) {
      return
    }

    const fetchAll = async () => {
      try {
        set({ loading: true, error: null })
        const response = await ApiClient.LlmProvider.list({ page: 1, per_page: 50 })
        const providers = sortProviders(response.providers)
        // Set providers immediately without models.
        set({
          providers: providers.map(p => ({ ...p, llm_models: [] })),
          isInitialized: true,
          loading: false,
        })
        // Fetch models for each provider in parallel.
        const modelPromises = providers.map(async provider => {
          try {
            const modelsResponse = await ApiClient.LlmModel.list({
              providerId: provider.id,
              page: 1,
              perPage: 100,
            })
            return { providerId: provider.id, models: modelsResponse.models }
          } catch (error) {
            console.error(`Failed to load models for provider ${provider.id}:`, error)
            return { providerId: provider.id, models: [] }
          }
        })
        const results = await Promise.allSettled(modelPromises)
        const providersWithModels = providers.map(provider => {
          const result = results.find(
            r => r.status === 'fulfilled' && r.value.providerId === provider.id,
          )
          const models = result?.status === 'fulfilled' ? result.value.models : []
          return { ...provider, llm_models: models }
        })
        set({ providers: providersWithModels })
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to load providers',
          loading: false,
        })
        throw error
      }
    }

    const start = (): Promise<void> => {
      const run = fetchAll().finally(() => {
        if (inFlight === run) inFlight = null
      })
      inFlight = run
      return run
    }

    if (inFlight) {
      // A load is already outstanding.
      //
      // A NON-forced caller joins it — one HTTP round-trip, and `await` means
      // what callers assume. It is deliberately made non-rejecting: before this
      // rewrite the `|| state.loading` guard returned an already-resolved
      // promise, so a joiner could never throw. `createLlmModel` awaits exactly
      // this call after a successful POST, so letting an unrelated concurrent
      // refresh's failure propagate would surface "Failed to create model" for
      // a model that WAS created. The load's own error is still recorded on
      // `state.error` by `fetchAll`.
      if (!force) return inFlight.catch(() => undefined)
      if (queuedForced) return queuedForced

      // Forced + in flight → re-run AFTER the current load settles, because the
      // in-flight request may predate the change this call is reacting to.
      //
      // `queuedForced` is cleared when the re-run STARTS, not when it finishes.
      // Clearing it in `.finally()` left a window with both handles non-null:
      // a forced call arriving while the queued re-run's HTTP request was
      // already outstanding took the `if (queuedForced)` branch and was
      // coalesced into a request issued BEFORE its own change — the precise
      // failure this branch exists to avoid, just one layer further in. Now
      // such a call sees `queuedForced === null`, falls through to schedule its
      // own re-run behind the current one, and is not lost.
      //
      // `.catch(() => undefined)` on the WAIT is deliberate: a failed
      // predecessor must not cancel the refresh the caller asked for.
      const queued = inFlight.catch(() => undefined).then(() => {
        queuedForced = null
        return start()
      })
      queuedForced = queued
      return queued
    }

    // Nothing in flight. Skip only when already initialised and not forced.
    if (get().isInitialized && !force) return
    return start()
  }
