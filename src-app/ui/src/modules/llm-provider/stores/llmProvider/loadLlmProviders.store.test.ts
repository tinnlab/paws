/**
 * TEST-16 [covers: ITEM-16] — `loadLlmProviders(force)` must actually force.
 *
 * ## The defect
 *
 * The guard was `if ((state.isInitialized && !force) || state.loading) return`.
 * The `|| state.loading` clause short-circuits **even when `force` is true**,
 * and returns an already-resolved promise. Every `sync:*` handler on this store
 * calls `loadLlmProviders(true)`, so a realtime frame arriving while another
 * load was outstanding was dropped silently, with no retry.
 *
 * That is the third instance of the family PR #12 fixed twice — server state is
 * correct, the client never hears — and it had already been worked around at
 * one call site by bypassing this store entirely.
 *
 * ## Both halves, deliberately
 *
 * The naive fix is to delete the `loading` clause, which trades a dropped
 * refresh for a request storm: every sync frame in a burst would issue its own
 * fetch. So this pins BOTH properties, and the second one is what stops the
 * first being "fixed" carelessly:
 *
 *  (a) a forced call issued DURING a load resolves against data fetched AFTER
 *      that load — it is not dropped, and it is not merely joined to the
 *      in-flight request (joining would resolve against pre-change data, which
 *      for a `sync:` frame is the same bug wearing a hat);
 *  (b) concurrent NON-forced calls still collapse into a single request, and a
 *      burst of forced calls collapses into ONE queued re-run.
 *
 * Runner: vitest (`vitest.config.ts` includes `src/**\/*.store.test.ts`).
 *
 *   npx vitest run src/modules/llm-provider/stores/llmProvider/loadLlmProviders.store.test.ts
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

// The action self-gates on both read permissions; grant them for every case
// here (the permission gate itself is not what this file is about).
vi.mock('@/core/permissions', () => ({
  hasPermissionNow: () => true,
}))

import { ApiClient } from '@/api-client'
import makeLoadLlmProviders from './actions/loadLlmProviders'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** A minimal provider row, tagged so a test can tell WHICH fetch produced it. */
const providerRow = (tag: string) => ({
  id: `p-${tag}`,
  name: tag,
  provider_type: 'custom',
  enabled: true,
  built_in: false,
})

/** Build a store double + the action bound to it. */
function makeAction() {
  let state: Record<string, unknown> = {
    providers: [],
    isInitialized: false,
    loading: false,
    error: null,
  }
  const set = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch }
  }
  const get = () => state as never
  const load = makeLoadLlmProviders(set as never, get as never)
  return { load, snapshot: () => state }
}

/** Provider-list responses, one per call, each tagged by call index. */
let listCalls: number
let gate: Deferred<void>[]

beforeEach(() => {
  listCalls = 0
  gate = []
  // Reset the module-level in-flight handles between cases by letting every
  // prior promise settle first (each test awaits its own work, so nothing is
  // outstanding here) — the handles null themselves out in `finally`.

  vi.spyOn(ApiClient.LlmProvider, 'list').mockImplementation(async () => {
    const index = listCalls++
    // Each call blocks on its own gate so a test controls the interleaving
    // exactly, with no timers and no sleeping — this is what keeps the
    // assertions deterministic instead of racy.
    if (gate[index]) await gate[index].promise
    return {
      providers: [providerRow(`call${index}`)],
      total: 1,
      page: 1,
      per_page: 50,
    } as never
  })

  vi.spyOn(ApiClient.LlmModel, 'list').mockResolvedValue({
    models: [],
    total: 0,
    page: 1,
    per_page: 100,
  } as never)
})

describe('loadLlmProviders — forced refresh vs in-flight load', () => {
  test('TEST-16a: a forced call issued DURING a load is not dropped, and sees fresh data', async () => {
    const { load, snapshot } = makeAction()

    // Call 0 is held open; call 1 resolves freely.
    gate[0] = deferred<void>()

    const first = load() // starts call 0, blocks
    // Let the action reach its awaited fetch.
    await Promise.resolve()

    // The sync handler's call — arrives while call 0 is still outstanding.
    const forced = load(true)

    // Release the first load; the queued re-run then issues call 1.
    gate[0].resolve()
    await first
    await forced

    // The forced call must have caused a SECOND fetch...
    expect(listCalls, 'a forced call during a load must re-fetch').toBe(2)
    // ...and the store must hold what that second fetch returned. Joining the
    // in-flight request instead would leave `call0` here, which is the subtler
    // way to lose a sync refresh.
    const providers = snapshot().providers as { name: string }[]
    expect(providers.map(p => p.name), 'the store holds the LATEST fetch').toEqual([
      'call1',
    ])
  })

  test('TEST-16b: concurrent NON-forced calls collapse into a single request', async () => {
    const { load } = makeAction()
    gate[0] = deferred<void>()

    const a = load()
    await Promise.resolve()
    const b = load()
    const c = load()

    gate[0].resolve()
    await Promise.all([a, b, c])

    expect(listCalls, 'de-duplication must survive the fix').toBe(1)
  })

  test('TEST-16c: a BURST of forced calls during one load collapses into ONE re-run', async () => {
    const { load } = makeAction()
    gate[0] = deferred<void>()

    const first = load()
    await Promise.resolve()

    // Five sync frames landing together — the shape a reconnect produces.
    const forced = [load(true), load(true), load(true), load(true), load(true)]

    gate[0].resolve()
    await first
    await Promise.all(forced)

    // One initial + exactly one coalesced re-run. Deleting the `loading` guard
    // outright would make this 6.
    expect(listCalls, 'a burst must not become a request storm').toBe(2)
  })

  test('TEST-16d: with nothing in flight, a non-forced call still no-ops once initialised', async () => {
    const { load } = makeAction()

    await load()
    expect(listCalls).toBe(1)

    await load() // already initialised, not forced → no fetch
    expect(listCalls, 'the initialised short-circuit is preserved').toBe(1)

    await load(true) // forced → fetches
    expect(listCalls, 'force still forces when nothing is in flight').toBe(2)
  })
})
