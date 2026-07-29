import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLazyDispatcher } from '../../../../sdk/packages/framework/src/lazy-dispatch.ts'

/**
 * TEST-10 — the two shared-infra items.
 *
 * (a) ITEM-8: `notification-ui`'s `load` action must NOT carry a bare
 *     `if (loading) return` guard. It reads `page`/`perPage`/`unreadOnly` from
 *     state, and `setPage`/`setUnreadOnly` mutate those and then call it — so a
 *     bare drop would discard a page change or filter toggle (leaving the UI on
 *     the new selection with the old items) and would equally discard the
 *     `sync:notification` / `sync:reconnect` reload, silently breaking
 *     notify-and-refetch. The duplicate that motivated a guard is removed at the
 *     transport instead, where only literally-identical concurrent GETs join.
 * (b) ITEM-10: `registerModule` built a SECOND `createStoreProxy` for a store
 *     that had already self-registered via `registerLazyStore`, giving it an
 *     independent `storeInitialized` flag + ref count — so its `init` (and every
 *     `sync:*` listener it registers) could run twice. `stores.ts` documents
 *     that proxy as the SOLE owner of the lifecycle.
 */

// ── (a) the notification load action ────────────────────────────────────────
// Drives the REAL action factory. Only the external boundary is faked: the
// injected REST surface (via the store's own `setNotificationDeps` seam).

import loadNotifications from '../../../../sdk/packages/notification-ui/src/store/actions/load.ts'
import { setNotificationDeps } from '../../../../sdk/packages/notification-ui/src/store/_deps.ts'
import { useModuleSystemStore } from '../../../../sdk/packages/framework/src/module-system/store.ts'

test('TEST-10a: a reload with DIFFERENT intent is never dropped', async () => {
  // The permission boundary is stubbed by the unit-test resolver (the barrel
  // re-exports JSX); the action body + its guard are the real thing.
  let listCalls = 0
  let release!: () => void
  const done = new Promise<void>(r => {
    release = r
  })
  const seenParams: { page: number }[] = []
  setNotificationDeps({
    api: {
      list: async (p: { page: number }) => {
        listCalls++
        seenParams.push(p)
        await done
        return { items: [], total: 0, unread: 0 }
      },
    },
    readPermission: 'notifications::read',
  } as never)

  const state: Record<string, unknown> = {
    loading: false,
    page: 1,
    perPage: 30,
    unreadOnly: false,
    items: [],
  }
  const set = (updater: unknown) => {
    if (typeof updater === 'function') (updater as (d: unknown) => void)(state)
    else Object.assign(state, updater)
  }
  const get = () => state

  const load = loadNotifications(set as never, get as never)
  const a = load()
  // A page change / filter toggle / sync-driven reload issued WHILE the first
  // load is in flight must still reach the network — dropping it would leave the
  // UI showing the new selection with the previous page's items, and would break
  // notify-and-refetch for `sync:notification`.
  state.page = 2
  const b = load()
  release()
  await Promise.all([a, b])
  assert.equal(
    listCalls,
    2,
    'the action must NOT carry a bare in-flight guard — de-duplication of the ' +
      'IDENTICAL concurrent case belongs at the transport, which can tell them apart',
  )
  assert.deepEqual(
    seenParams.map(p => p.page),
    [1, 2],
    'each load must carry its own intent',
  )
})

// ── (b) single-owner store proxy ────────────────────────────────────────────
// Drives the REAL module-system reducer.

test('TEST-10b: registerModule REUSES an already-registered proxy', () => {
  const ms = useModuleSystemStore.getState()

  // A store that self-registered its proxy (what `registerLazyStore` does at
  // import time — `stores.ts` documents that proxy as the SOLE owner of
  // init-on-first-access + ref-counted destroy).
  const selfRegistered = { __marker: 'the-one-true-proxy' }
  ms.registerStore('Notifications', selfRegistered)
  assert.equal(
    useModuleSystemStore.getState().stores.Notifications,
    selfRegistered,
  )

  // …and a module that ALSO declares it in its `stores:` array.
  ms.registerModule({
    metadata: { name: 'notification-test', version: '1', description: '' },
    registerStores: () => [
      { name: 'Notifications', store: makeFakeZustandStore() },
    ],
  } as never)

  assert.equal(
    useModuleSystemStore.getState().stores.Notifications,
    selfRegistered,
    'the module registration must NOT replace the live proxy with a second one ' +
      '(a second proxy has its own storeInitialized + ref count, so `init` — and ' +
      'every sync:* listener it registers — could run twice)',
  )

  // A store NOT already registered still gets its proxy built (no regression).
  ms.registerModule({
    metadata: { name: 'fresh-test', version: '1', description: '' },
    registerStores: () => [{ name: 'FreshOnly', store: makeFakeZustandStore() }],
  } as never)
  assert.ok(
    useModuleSystemStore.getState().stores.FreshOnly,
    'a first-time store registration still creates its proxy',
  )
})

/** The minimum surface `createStoreProxy` touches when it is merely built. */
function makeFakeZustandStore() {
  const api: any = () => undefined
  api.getState = () => ({})
  api.setState = () => undefined
  api.subscribe = () => () => undefined
  return api
}

// ── the dispatcher used by every store, sanity-bound here too ───────────────

test('TEST-10: the shared dispatcher keeps its chunk memoization', async () => {
  let loads = 0
  // Two-stage loader: the chunk IMPORT and the impl BUILD have opposite failure
  // policies, so the dispatcher takes them separately. This spec only cares
  // about memoization, so the build stage is identity.
  const dispatch = createLazyDispatcher(async () => {
    loads++
    return async () => 'ok'
  }, impl => impl)
  await Promise.all([dispatch(), dispatch(), dispatch()])
  await dispatch()
  assert.equal(loads, 1, 'the action chunk is fetched exactly once')
})
