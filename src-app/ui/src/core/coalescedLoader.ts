/**
 * Generic request coalescer: make N near-simultaneous readers of the same
 * remote value share ONE request.
 *
 * Extracted from `llmModelCatalog.ts` so the contract — the actual fix for the
 * live-ui-audit `duplicate request` finding — is unit-testable without loading
 * the generated `ApiClient` (which cannot resolve under the node test loader).
 * Reusable by any other "several stores want the same list on boot" case.
 */

export interface CoalescedLoader<T> {
  /** Read the value, sharing an in-flight request and a fresh cached one. */
  (opts?: { force?: boolean }): Promise<T>
  /**
   * Drop the cached value AND abandon any in-flight request, so the next read
   * genuinely re-fetches. (Clearing only the cache would hand the next reader
   * the still-registered pre-invalidation promise, which would then repopulate
   * the cache with exactly the value invalidation meant to drop.)
   */
  invalidate: () => void
}

/**
 * Wrap a fetcher so concurrent AND near-simultaneous callers share one request.
 *
 * A rejection is NOT cached: the next caller retries.
 *
 * Superseded requests never write the cache. `force` and `invalidate()` bump a
 * generation counter, and a request only stores its result while it is still
 * the current generation — otherwise a slow pre-`force` fetch resolving late
 * would overwrite the fresher value AND re-stamp its timestamp, keeping stale
 * data alive for a whole extra TTL.
 */
export function createCoalescedLoader<T>(
  fetcher: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): CoalescedLoader<T> {
  let cache: { value: T; at: number } | null = null
  let inflight: Promise<T> | null = null
  let generation = 0

  /** Drop cache + in-flight slot and mark anything already in flight stale. */
  const reset = () => {
    cache = null
    inflight = null
    generation += 1
  }

  const load = (opts?: { force?: boolean }): Promise<T> => {
    if (opts?.force) {
      reset()
    } else {
      if (cache && now() - cache.at < ttlMs) return Promise.resolve(cache.value)
      if (inflight) return inflight
    }

    const myGeneration = generation
    const request = fetcher()
      .then(value => {
        // A force/invalidate that happened while this was in flight makes this
        // result stale by definition — hand it to OUR callers, but do not let
        // it become the cached answer for anyone else.
        if (myGeneration === generation) cache = { value, at: now() }
        return value
      })
      .finally(() => {
        // Only clear the slot if it is still OURS.
        if (inflight === request) inflight = null
      })

    inflight = request
    return request
  }

  load.invalidate = reset
  return load as CoalescedLoader<T>
}
