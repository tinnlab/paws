import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  __resetRailLiveSourceForTests,
  clearRailLiveSourceIfOwnedBy,
  getRailLiveStep,
  railLiveVersion,
  setRailLiveSource,
  subscribeRailLive,
  type RailLiveSource,
} from '@/modules/chat/core/rail/liveSteps'

/**
 * FIX_ROUND-5 — the rail live source shipped its defensive branches untested.
 *
 * `transport.test.ts` pins the ELICITATION seam's identical behaviour, and its
 * own header claimed this file's precedent "is unit-tested through exactly this
 * reset helper". That was false: there was no spec for `liveSteps.ts` at all, so
 * reverting its refuse-the-install guard turned nothing red. Both seams are
 * registered from the SAME mcp `initialize` two statements apart; they are only
 * genuinely symmetric if they are pinned symmetrically.
 */

function stubSource(fail: { subscribe?: boolean; unsubscribe?: boolean } = {}) {
  const listeners = new Set<() => void>()
  let unsubscribed = 0
  const src: RailLiveSource = {
    get: id => (id === 'known' ? { status: 'running' } : null),
    subscribe: onChange => {
      if (fail.subscribe) throw new Error('subscribe')
      listeners.add(onChange)
      return () => {
        unsubscribed += 1
        listeners.delete(onChange)
        if (fail.unsubscribe) throw new Error('unsubscribe')
      }
    },
  }
  return {
    src,
    notify: () => {
      for (const l of listeners) l()
    },
    unsubscribeCount: () => unsubscribed,
    listenerCount: () => listeners.size,
  }
}

async function quiet<T>(fn: () => T | Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

test.beforeEach(() => __resetRailLiveSourceForTests())
test.after(() => __resetRailLiveSourceForTests())

test('degrades to null with NO source installed', () => {
  assert.equal(getRailLiveStep('known'), null)
})

test('a registered source answers, and its changes bump the version', () => {
  const { src, notify } = stubSource()
  let notified = 0
  const unsub = subscribeRailLive(() => {
    notified += 1
  })

  const before = railLiveVersion()
  setRailLiveSource(src, 'mcp')
  assert.equal(getRailLiveStep('known')?.status, 'running')
  assert.equal(getRailLiveStep('unknown'), null)
  assert.ok(railLiveVersion() > before)
  assert.equal(notified, 1)

  notify()
  assert.equal(notified, 2, 'a source-side change must reach the seam')
  unsub()
  notify()
  assert.equal(notified, 2, 'unsubscribe must actually detach')
})

test('re-registering DETACHES the previous source', () => {
  const first = stubSource()
  const second = stubSource()
  setRailLiveSource(first.src, 'mcp')
  setRailLiveSource(second.src, 'mcp')
  assert.equal(first.unsubscribeCount(), 1)
  assert.equal(first.listenerCount(), 0)
  assert.equal(second.listenerCount(), 1)
})

test('teardown is OWNER-SCOPED', () => {
  const { src, unsubscribeCount } = stubSource()
  setRailLiveSource(src, 'mcp')

  clearRailLiveSourceIfOwnedBy('js-tool')
  assert.equal(getRailLiveStep('known')?.status, 'running', 'a different owner must not detach it')
  assert.equal(unsubscribeCount(), 0)

  clearRailLiveSourceIfOwnedBy('mcp')
  assert.equal(getRailLiveStep('known'), null)
  assert.equal(unsubscribeCount(), 1)
})

test('a throwing subscribe REFUSES the install rather than half-installing', async () => {
  const { src } = stubSource({ subscribe: true })
  await quiet(() => setRailLiveSource(src, 'mcp'))
  // The pre-fix behaviour installed the source with no change subscription —
  // every rail step frozen at the status it first read — and let the throw abort
  // the rest of the registering extension's wiring.
  assert.equal(getRailLiveStep('known'), null, 'a source that cannot notify must not be installed')
})

test('a throwing unsubscribe does not block the next install, or the test reset', async () => {
  const first = stubSource({ unsubscribe: true })
  const second = stubSource()
  setRailLiveSource(first.src, 'mcp')
  await quiet(() => setRailLiveSource(second.src, 'mcp'))
  assert.equal(getRailLiveStep('known')?.status, 'running', 'the second source must be installed')

  const third = stubSource({ unsubscribe: true })
  setRailLiveSource(third.src, 'mcp')
  await quiet(() => __resetRailLiveSourceForTests())
  assert.equal(getRailLiveStep('known'), null, 'the reset must complete despite a throwing unsubscribe')
})
