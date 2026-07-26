/**
 * Request-batching loader for "which project is conversation X in?".
 *
 * WHY: a conversation list renders one membership badge per row, and each badge
 * asks this question on mount. With the per-id endpoint that turned a 20-40 row
 * sidebar into 20-40 `GET /api/projects/by-conversation/{id}` requests in one
 * burst — the `n+1` pattern the live-ui-audit measures (and, on a rate-limited
 * deployment, enough traffic to 429 the app's own boot calls). The burst is
 * worst exactly where it hurts most: `ConversationCard` seeds its lazy trailing
 * as already-hovered when `(hover: none)` matches, so on a TOUCH device every
 * visible row asks at once.
 *
 * This collects every id asked for inside one short window and answers them all
 * with a single `POST /api/projects/by-conversations`.
 *
 * Deliberately a plain module (not a store): the projects chat-extension needs
 * a SYNCHRONOUSLY readable membership cache for `conversationHref` /
 * `conversationBackHref`, which a store's async init cannot provide.
 */

/**
 * Fixed collection window, in ms, opened by the FIRST pending id.
 *
 * A window, NOT a debounce: later ids join the open window, they never extend
 * it — under continuous scrolling a debounce would starve the badges forever.
 * 20 ms (~1.2 animation frames) covers one virtualized mount wave while staying
 * imperceptible. See DECISIONS.md DEC-4.
 */
export const BATCH_WINDOW_MS = 20

/**
 * Server-side cap on ids per call (`MAX_CONVERSATIONS_PER_LOOKUP` in
 * `project/types.rs`; over-cap answers 422 with `TOO_MANY_CONVERSATION_IDS`).
 * The loader chunks at this size so a very large window can never trip it.
 */
export const BATCH_MAX_IDS = 200

/**
 * What one id resolved to.
 *
 * `failed` distinguishes "the server told us this conversation has no project"
 * (`value: null, failed: false` — a real, cacheable answer) from "we never got
 * an answer" (`failed: true`). The caller MUST NOT cache a failed lookup:
 * batching means one bad request would otherwise mislabel up to
 * `BATCH_MAX_IDS` filed conversations as unfiled, permanently, with no retry.
 */
export interface BatchResult<T> {
  value: T | null
  failed: boolean
}

export interface BatchLoaderOptions<T> {
  /**
   * Resolve a chunk of ids. MUST return an entry for every id that HAS a value;
   * ids absent from the returned map resolve as `{value: null, failed: false}`
   * (the "unfiled" answer). A rejection — or a synchronous throw — resolves
   * every id in that chunk as `{value: null, failed: true}`; a caller's promise
   * is never left pending, or a membership badge would spin forever.
   */
  fetchChunk: (ids: string[]) => Promise<Map<string, T>>
  /** Test seam: override the window length. */
  windowMs?: number
  /** Test seam: override the chunk size. */
  maxIds?: number
}

export interface BatchLoader<T> {
  /** Queue `id` for the next batch. Never rejects. */
  load: (id: string) => Promise<BatchResult<T>>
}

/**
 * Build a batching loader. Concurrent `load()` calls for the SAME id inside one
 * window share a single promise, so this also subsumes the per-id in-flight
 * dedup the caller used to do by hand.
 */
export function createBatchLoader<T>(opts: BatchLoaderOptions<T>): BatchLoader<T> {
  const windowMs = opts.windowMs ?? BATCH_WINDOW_MS
  const maxIds = opts.maxIds ?? BATCH_MAX_IDS

  // id → the resolvers waiting on it in the CURRENTLY OPEN window.
  let pending = new Map<string, ((result: BatchResult<T>) => void)[]>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.size === 0) return
    const batch = pending
    pending = new Map()

    const ids = [...batch.keys()]
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += maxIds) chunks.push(ids.slice(i, i + maxIds))

    // A per-chunk outcome: either a resolved map, or the whole chunk failed.
    // `Promise.resolve().then(...)` so a fetcher that throws SYNCHRONOUSLY is
    // caught here too — a sync throw escaping this map would abort `flush`
    // inside a timer callback and leave every resolver pending forever.
    const settled = chunks.map(chunk =>
      Promise.resolve()
        .then(() => opts.fetchChunk(chunk))
        .then(found => ({ chunk, found, failed: false }))
        .catch(() => ({ chunk, found: new Map<string, T>(), failed: true })),
    )

    void Promise.all(settled).then(results => {
      const found = new Map<string, T>()
      const failedIds = new Set<string>()
      for (const r of results) {
        for (const [k, v] of r.found) found.set(k, v)
        if (r.failed) for (const id of r.chunk) failedIds.add(id)
      }
      // Settle EVERY id in the batch exactly once. A resolver that throws must
      // not prevent the rest from settling, so each call is isolated.
      for (const [id, resolvers] of batch) {
        const result: BatchResult<T> = {
          value: found.get(id) ?? null,
          failed: failedIds.has(id),
        }
        for (const resolve of resolvers) {
          try {
            resolve(result)
          } catch {
            /* a resolver cannot be allowed to strand its siblings */
          }
        }
      }
    })
  }

  return {
    load(id: string) {
      return new Promise<BatchResult<T>>(resolve => {
        const existing = pending.get(id)
        if (existing) {
          existing.push(resolve)
        } else {
          pending.set(id, [resolve])
        }
        if (timer === null) timer = setTimeout(flush, windowMs)
      })
    },
  }
}
