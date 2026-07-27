import { ApiClient } from '@/api-client'
import type { LlmRepositoryGet, LlmRepositorySet } from '../state'
import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'

/**
 * In-flight de-duplication handle.
 *
 * The old guard was `if (state.loading) return` — a BARE return, so a concurrent
 * caller got an already-resolved promise and raced ahead of the fetch that was
 * still in flight. That is only safe when the store is loaded eagerly at boot;
 * once the store became LAZY (`registerLazyStore`), its own `init()` fires
 * `loadLlmRepositories()` on FIRST access — and the first access is frequently
 * the very caller that then `await`s the action to guarantee the list is
 * populated. The hub download gate is exactly that shape:
 *
 *   await LlmRepositoryStore.loadLlmRepositories()   // returns instantly (loading=true)
 *   const { repositories } = LlmRepositoryStore.$    // still []
 *   repositories.find(r => r.url === registryUrl)    // undefined
 *   → "Repository Not Configured" instead of the real gate modal
 *
 * Returning the PENDING promise instead of `undefined` keeps the de-duplication
 * (still exactly one HTTP request) while making `await` mean what every caller
 * already assumed it meant. Stored module-side rather than in state because the
 * store is immer-backed and a Promise must not be frozen/serialised.
 */
let inFlight: Promise<void> | null = null

export default (set: LlmRepositorySet, get: LlmRepositoryGet) =>
  async (page?: number, pageSize?: number): Promise<void> => {
    if (!hasPermissionNow(Permissions.LlmRepositoriesRead)) return
    const state = get()
    // Join the in-flight load rather than returning a resolved promise while the
    // real fetch is still outstanding.
    if (state.loading && inFlight) return inFlight
    const nextPage = page ?? state.currentPage
    const nextPageSize = pageSize ?? state.pageSize

    const run = async () => {
      try {
        set({ loading: true, error: null })
        const response = await ApiClient.LlmRepository.list({
          page: nextPage,
          per_page: nextPageSize,
        })
        set({
          repositories: response.repositories,
          total: response.total,
          currentPage: response.page,
          pageSize: response.per_page,
          isInitialized: true,
          loading: false,
        })
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to load repositories',
          loading: false,
        })
        throw error
      } finally {
        inFlight = null
      }
    }

    inFlight = run()
    return inFlight
  }
