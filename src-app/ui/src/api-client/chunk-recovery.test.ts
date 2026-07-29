import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  __resetStaleBuildForTests,
  clearStaleBuild,
  installChunkLoadRecovery,
  isStaleBuild,
  markStaleBuild,
} from '../../../../sdk/packages/framework/src/chunk-recovery.ts'

/**
 * TEST-11 — the `vite:preloadError` observer.
 *
 * Lives in the APP tree (importing the SDK source relatively, like its sibling
 * `lazy-dispatch.test.ts`) because that is the only tree a runner reaches:
 * `test:unit` globs `src/**\/*.test.ts` relative to `src-app/ui`, and no sdk
 * package has a test script. Authored under `sdk/packages/framework/src/` this
 * would never execute — and the assertion below is the one thing standing
 * between a future edit and a silent regression.
 *
 * `vite:preloadError` only fires against a real BUILT bundle (dev has no
 * `__vitePreload`), so the listener is driven through an injected EventTarget;
 * its whole contract is observable there.
 *
 * The must-NOT-preventDefault assertion is load-bearing, not pedantry. Vite's
 * helper ends `baseModule().catch(handlePreloadError)`, and `handlePreloadError`
 * rethrows ONLY when the event was not defaultPrevented — so preventing the
 * default makes the import promise RESOLVE WITH `undefined` instead of
 * rejecting. The caller then reads `.default` off `undefined`, the dispatcher's
 * retry never runs (nothing rejected), and the failure is silent again. An
 * earlier draft of this module did call preventDefault and the e2e's
 * "recovers after the blip clears" leg failed with exactly that TypeError.
 */

/** Minimal EventTarget double that records listeners + preventDefault calls. */
function makeTarget() {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn)
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0
    },
    fire(type: string, payload?: unknown) {
      let prevented = false
      const event = {
        type,
        payload,
        preventDefault: () => {
          prevented = true
        },
      } as unknown as Event
      for (const fn of listeners.get(type) ?? []) fn(event)
      return prevented
    },
  }
}

function quiet(fn: () => void) {
  const original = console.warn
  console.warn = () => {}
  try {
    fn()
  } finally {
    console.warn = original
  }
}

beforeEach(() => __resetStaleBuildForTests())

test('TEST-11: a preloadError marks the build stale and is NOT preventDefaulted', () => {
  const target = makeTarget()
  const uninstall = installChunkLoadRecovery(target as never)
  try {
    assert.equal(target.count('vite:preloadError'), 1)
    assert.equal(isStaleBuild(), false)

    let prevented = false
    quiet(() => {
      prevented = target.fire('vite:preloadError', {
        message: 'Unable to preload CSS/JS',
      })
    })

    assert.equal(
      prevented,
      false,
      'the event must NOT be preventDefaulted — that would make the import promise resolve with `undefined` instead of rejecting, silently defeating both the dispatcher retry and the caller error handling',
    )
    assert.equal(
      isStaleBuild(),
      true,
      'the page is now running against a build the server no longer fully serves',
    )
  } finally {
    uninstall()
  }
})

test('TEST-11b: installing twice for the SAME target registers exactly one listener', () => {
  const target = makeTarget()
  const a = installChunkLoadRecovery(target as never)
  const b = installChunkLoadRecovery(target as never)
  try {
    assert.equal(target.count('vite:preloadError'), 1)
  } finally {
    a()
    b()
  }
})

test('TEST-11b2: a DIFFERENT target still gets its own listener', () => {
  // The guard is per-target (a WeakSet), not a module-scope boolean: a single
  // flag meant one caller that never uninstalled silently disabled installation
  // for everything after it in the same process — including later specs — while
  // handing back a no-op uninstall indistinguishable from a real one.
  const a = makeTarget()
  const b = makeTarget()
  const ua = installChunkLoadRecovery(a as never)
  const ub = installChunkLoadRecovery(b as never)
  try {
    assert.equal(a.count('vite:preloadError'), 1)
    assert.equal(b.count('vite:preloadError'), 1)
  } finally {
    ua()
    ub()
  }
})

test('TEST-11c: uninstall removes the listener and re-arms a later install', () => {
  const target = makeTarget()
  installChunkLoadRecovery(target as never)()
  assert.equal(target.count('vite:preloadError'), 0)

  quiet(() => target.fire('vite:preloadError'))
  assert.equal(isStaleBuild(), false, 'an uninstalled listener must not mark anything')

  const again = installChunkLoadRecovery(target as never)
  try {
    assert.equal(
      target.count('vite:preloadError'),
      1,
      'uninstalling must release the per-target guard, not wedge it',
    )
  } finally {
    again()
  }
})

test('TEST-11d: with no event target (SSR / node) install is a harmless no-op', () => {
  const uninstall = installChunkLoadRecovery(undefined)
  assert.equal(typeof uninstall, 'function')
  uninstall()
  assert.equal(isStaleBuild(), false)
})

test('TEST-11e: the mark is idempotent, and CLEARED by a successful load', () => {
  assert.equal(isStaleBuild(), false)
  markStaleBuild()
  markStaleBuild()
  assert.equal(isStaleBuild(), true)

  // Not permanently sticky. An earlier draft never reset it, which contradicted
  // the dispatcher's own thesis (an import failure is TRANSIENT) and had a real
  // cost: one 300ms blip during boot latched the flag for the whole session,
  // which disabled store-kit's lazy-action prefetch for every store registered
  // afterwards even though the network had recovered.
  clearStaleBuild()
  assert.equal(isStaleBuild(), false)
})
