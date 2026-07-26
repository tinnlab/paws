import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLazyDispatcher } from '../../../../sdk/packages/framework/src/lazy-dispatch.ts'

/**
 * TEST-4 (ITEM-4) — store-kit's lazy action dispatcher.
 *
 * A lazy action's body — and therefore its OWN in-flight guard
 * (`if (state.loading) return`) — cannot run until its chunk resolves, so two
 * synchronous callers used to both slip past every guard and issue the same
 * request twice. That is the upstream cause of the duplicate boot fetches the
 * network audit reported.
 *
 * The fix must close that window WITHOUT changing steady state: once the impl is
 * resolved, every call must still run the body (so repeated mutations repeat).
 */

/** A store-shaped action with the guard every list action in the app carries. */
function makeGuardedAction() {
  const state = { loading: false }
  let bodyCalls = 0
  let pastGuard = 0
  let releaseWork!: () => void
  const workDone = new Promise<void>(res => {
    releaseWork = res
  })
  const impl = async (..._args: unknown[]) => {
    bodyCalls++
    if (state.loading) return 'dropped-by-guard'
    pastGuard++
    state.loading = true
    await workDone
    state.loading = false
    return 'loaded'
  }
  return {
    impl,
    releaseWork,
    get bodyCalls() {
      return bodyCalls
    },
    get pastGuard() {
      return pastGuard
    },
  }
}

test('TEST-4: two synchronous calls during the chunk-load window invoke the body ONCE', async () => {
  const action = makeGuardedAction()
  let releaseChunk!: () => void
  const chunk = new Promise<void>(res => {
    releaseChunk = res
  })
  let loaderCalls = 0
  const dispatch = createLazyDispatcher(async () => {
    loaderCalls++
    await chunk
    return action.impl
  })

  const a = dispatch()
  const b = dispatch()
  const c = dispatch()
  assert.equal(action.bodyCalls, 0, 'nothing can have run yet — the chunk is loading')

  releaseChunk()
  action.releaseWork()
  const results = await Promise.all([a, b, c])

  assert.equal(loaderCalls, 1, 'the chunk is fetched once (unchanged behaviour)')
  assert.equal(action.bodyCalls, 1, 'the three cold callers share ONE invocation')
  assert.equal(action.pastGuard, 1, "the action's own in-flight guard is now reachable")
  assert.deepEqual(results, ['loaded', 'loaded', 'loaded'])
})

test('TEST-4: once the chunk has resolved, dispatch is unchanged (each call runs)', async () => {
  const action = makeGuardedAction()
  action.releaseWork()
  const dispatch = createLazyDispatcher(async () => action.impl)

  await dispatch() // warms the impl
  assert.equal(action.bodyCalls, 1)

  await dispatch()
  await dispatch()
  assert.equal(
    action.bodyCalls,
    3,
    'steady state must be byte-identical to before — repeated calls repeat',
  )
})

test('TEST-4: cold calls with DIFFERENT arguments are not merged', async () => {
  const seen: unknown[] = []
  let releaseChunk!: () => void
  const chunk = new Promise<void>(res => {
    releaseChunk = res
  })
  const dispatch = createLazyDispatcher(async () => {
    await chunk
    return async (n: unknown) => {
      seen.push(n)
    }
  })

  const a = dispatch(1)
  const b = dispatch(2)
  const c = dispatch(1)
  releaseChunk()
  await Promise.all([a, b, c])
  assert.deepEqual(seen.sort(), [1, 2], 'same-arg merged, different-arg kept')
})

test('TEST-4: non-serializable args are never merged (equivalence unprovable)', async () => {
  let calls = 0
  let releaseChunk!: () => void
  const chunk = new Promise<void>(res => {
    releaseChunk = res
  })
  const dispatch = createLazyDispatcher(async () => {
    await chunk
    return async () => {
      calls++
    }
  })
  const cyclic: any = {}
  cyclic.self = cyclic
  const a = dispatch(cyclic)
  const b = dispatch(cyclic)
  releaseChunk()
  await Promise.all([a, b])
  assert.equal(calls, 2)
})

test('TEST-4: preload warms the chunk without invoking the body', async () => {
  const action = makeGuardedAction()
  action.releaseWork()
  let loaderCalls = 0
  const dispatch = createLazyDispatcher(async () => {
    loaderCalls++
    return action.impl
  })
  await dispatch.preload()
  assert.equal(loaderCalls, 1)
  assert.equal(action.bodyCalls, 0, 'preload must not invoke the action')
})
