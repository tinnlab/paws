import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLazyDispatcher } from '../../../../sdk/packages/framework/src/lazy-dispatch.ts'

/**
 * TEST-10 — the two shared-infra fixes.
 *
 * (a) ITEM-8: `notification-ui`'s `load` action was the only list action in the
 *     tree with NO in-flight guard, so each of its consumers (the bell widget,
 *     the toast listener, the inbox page) drove its own
 *     `GET /api/notifications` on the same boot.
 * (b) ITEM-10: `registerModule` built a SECOND `createStoreProxy` for a store
 *     that had already self-registered via `registerLazyStore`, giving it an
 *     independent `storeInitialized` flag + ref count — so its `init` (and every
 *     `sync:*` listener it registers) could run twice. `stores.ts` documents
 *     that proxy as the SOLE owner of the lifecycle.
 */

// ── (a) the notification load guard ─────────────────────────────────────────
// Drives the REAL action factory. Only the external boundaries are faked: the
// injected REST surface (via the store's own `setNotificationDeps` seam) and the
// permission view (via the framework's `setAuthView` seam). The action body, its
// guard, and the immer-style set/get are real.

import loadNotifications from '../../../../sdk/packages/notification-ui/src/store/actions/load.ts'
import { setNotificationDeps } from '../../../../sdk/packages/notification-ui/src/store/_deps.ts'
import { useModuleSystemStore } from '../../../../sdk/packages/framework/src/module-system/store.ts'

test('TEST-10a: two concurrent load() calls produce ONE list request', async () => {
  // The permission boundary is stubbed by the unit-test resolver (the barrel
  // re-exports JSX); the action body + its guard are the real thing.
  let listCalls = 0
  let release!: () => void
  const done = new Promise<void>(r => {
    release = r
  })
  setNotificationDeps({
    api: {
      list: async () => {
        listCalls++
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
  const b = load()
  release()
  await Promise.all([a, b])
  assert.equal(listCalls, 1, 'the second concurrent caller must be dropped by the guard')

  // …and once settled, a later load DOES run (a guard, not a cache).
  await load()
  assert.equal(listCalls, 2)
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
  const dispatch = createLazyDispatcher(async () => {
    loads++
    return async () => 'ok'
  })
  await Promise.all([dispatch(), dispatch(), dispatch()])
  await dispatch()
  assert.equal(loads, 1, 'the action chunk is fetched exactly once')
})
