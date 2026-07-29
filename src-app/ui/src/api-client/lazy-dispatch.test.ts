import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLazyDispatcher } from '../../../../sdk/packages/framework/src/lazy-dispatch.ts'

/**
 * TEST-4 (ITEM-4) — store-kit's lazy action dispatcher.
 *
 * NOTE ON THE SIGNATURE: the dispatcher takes the module IMPORT and the impl
 * BUILD as two separate stages, because their failures need opposite policies (a
 * transient chunk 404 must be retried and never memoized; a deterministic
 * factory throw must be memoized so it cannot loop). These specs pass an
 * identity builder where the distinction is irrelevant, and drive the two stages
 * explicitly where it is.
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

test('TEST-4: the CHUNK is fetched once no matter how many callers race it', async () => {
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
  }, impl => impl)

  const a = dispatch()
  const b = dispatch()
  const c = dispatch()
  assert.equal(action.bodyCalls, 0, 'nothing can have run yet — the chunk is loading')

  releaseChunk()
  action.releaseWork()
  await Promise.all([a, b, c])

  assert.equal(loaderCalls, 1, 'the chunk is fetched exactly once')
  // Every caller's body DOES run: the dispatcher deliberately does NOT merge
  // cold-window calls (it cannot tell a read from a mutation, and merging would
  // silently drop a duplicate create/delete). The duplicate NETWORK requests are
  // removed one layer down, by the transport's GET coalescer.
  assert.equal(action.bodyCalls, 3)
  // …and the action's OWN guard then does its job: only the first got past it.
  assert.equal(
    action.pastGuard,
    1,
    "the action's in-flight guard is reachable once the body runs",
  )
})

test('TEST-4: once the chunk has resolved, dispatch is unchanged (each call runs)', async () => {
  const action = makeGuardedAction()
  action.releaseWork()
  const dispatch = createLazyDispatcher(async () => action.impl, impl => impl)

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

test('TEST-4: EVERY cold-window call reaches the body — no silent merge', async () => {
  // The load-bearing case: two calls carrying DIFFERENT callbacks. A key built
  // with JSON.stringify would collapse both to "[null]" (JSON.stringify does not
  // throw on a function) and the second callback would never fire.
  const fired: string[] = []
  let releaseChunk!: () => void
  const chunk = new Promise<void>(res => {
    releaseChunk = res
  })
  const dispatch = createLazyDispatcher(async () => {
    await chunk
    return async (cb: () => void) => cb()
  }, impl => impl)

  const a = dispatch(() => fired.push('a'))
  const b = dispatch(() => fired.push('b'))
  releaseChunk()
  await Promise.all([a, b])
  assert.deepEqual(fired.sort(), ['a', 'b'], 'both callbacks must be invoked')
})

test('TEST-4: two identical cold-window MUTATION dispatches both run', async () => {
  // A double-clicked create/delete must not be silently swallowed by the
  // dispatcher — that is a dropped user intent, not a saved request.
  let creates = 0
  let releaseChunk!: () => void
  const chunk = new Promise<void>(res => {
    releaseChunk = res
  })
  const dispatch = createLazyDispatcher(async () => {
    await chunk
    return async (_id: string) => {
      creates++
    }
  }, impl => impl)
  const a = dispatch('same-id')
  const b = dispatch('same-id')
  releaseChunk()
  await Promise.all([a, b])
  assert.equal(creates, 2)
})

test('TEST-4: a TRANSIENT chunk failure is retried — it does not brick the action', async () => {
  // Widened after a live-UI audit: this used to fail EXACTLY ONCE, which is the
  // only case the old one-retry policy survived. A real blip (or any deploy
  // while the tab is open) fails repeatedly, and the rejection was then memoized
  // for the whole session — every later dispatch failed without re-importing.
  // The property is "no number of transient failures bricks the action", so the
  // spec now fails through a whole dispatch's retry budget and beyond.
  let attempts = 0
  const dispatch = createLazyDispatcher(async () => {
    attempts++
    // Fails through TWO whole dispatch retry budgets (3 attempts each).
    if (attempts <= 6) throw new Error('chunk 404')
    return async () => 'ok'
  }, impl => impl)
  await assert.rejects(dispatch(), /chunk 404/)
  const attemptsAfterFirstDispatch = attempts
  assert.ok(
    attemptsAfterFirstDispatch > 1,
    'one dispatch must retry a failing import before giving up',
  )
  await assert.rejects(dispatch(), /chunk 404/)
  assert.equal(await dispatch(), 'ok', 'a transient chunk failure must not brick the action')
})

test('TEST-4: a DETERMINISTIC resolve failure is memoized — no unbounded retry loop', async () => {
  // A throw from the action FACTORY is an authoring bug, not a blip. Retrying it
  // forever would turn one bug into an unbounded loop for a component that
  // dispatches from a render/effect, so after the single retry it fails fast.
  //
  // This now drives the BUILD stage explicitly. It used to throw from the single
  // combined loader, which conflated it with a chunk-download failure — and that
  // conflation is precisely why a transient blip inherited the memoize-forever
  // policy meant only for authoring bugs.
  let builds = 0
  const dispatch = createLazyDispatcher(
    async () => ({}),
    () => {
      builds++
      throw new Error('factory blew up')
    },
  )
  for (let i = 0; i < 5; i++) await assert.rejects(dispatch(), /factory blew up/)
  assert.equal(builds, 2, 'one retry, then the rejection is memoized')
})

test('TEST-4: preload warms the chunk without invoking the body', async () => {
  const action = makeGuardedAction()
  action.releaseWork()
  let loaderCalls = 0
  const dispatch = createLazyDispatcher(async () => {
    loaderCalls++
    return action.impl
  }, impl => impl)
  await dispatch.preload()
  assert.equal(loaderCalls, 1)
  assert.equal(action.bodyCalls, 0, 'preload must not invoke the action')
})
