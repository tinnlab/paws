import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  __resetElicitationTransportForTests,
  clearElicitationTransportIfOwnedBy,
  elicitationExists,
  elicitationStatus,
  elicitationVersion,
  hasElicitationTransport,
  elicitationBlockedReason,
  registerElicitation,
  resolveElicitationVia,
  setElicitationTransport,
  subscribeElicitation,
  type ElicitationTransport,
} from '@/modules/chat/core/elicitation/transport'

/**
 * FIX_ROUND-3 — the seam shipped with no test at all.
 *
 * Every behaviour asserted below is a contract the module's own doc-comment
 * makes and that nothing else in the tree exercises: the e2e path only ever runs
 * with a healthy transport installed, so the degrade-when-absent, wrong-owner and
 * throwing-provider branches — i.e. all of the defensive code — were unreachable
 * from any test. (An earlier draft of this note claimed the precedent
 * `chat/core/rail/liveSteps.ts` was already unit-tested through the same reset
 * helper. It was not — there was no spec for it at all. FIX_ROUND-5 added
 * `liveSteps.test.ts`, so the two seams are now pinned symmetrically as well as
 * written symmetrically.)
 */

/** A recording stub. `fail` makes each provider entry point throw. */
function stubTransport(fail: Partial<Record<keyof ElicitationTransport, boolean>> = {}) {
  const listeners = new Set<() => void>()
  const entries = new Map<string, 'pending' | 'accepted' | 'declined' | 'cancelled'>()
  let unsubscribed = 0
  const t: ElicitationTransport = {
    has: id => {
      if (fail.has) throw new Error('has')
      return entries.has(id)
    },
    status: id => {
      if (fail.status) throw new Error('status')
      return entries.get(id)
    },
    register: init => {
      if (fail.register) throw new Error('register')
      entries.set(init.elicitation_id, 'pending')
      for (const l of listeners) l()
    },
    resolve: async (id, action) => {
      if (fail.resolve) throw new Error('resolve')
      entries.set(id, action === 'accept' ? 'accepted' : 'declined')
      for (const l of listeners) l()
    },
    subscribe: onChange => {
      if (fail.subscribe) throw new Error('subscribe')
      listeners.add(onChange)
      return () => {
        unsubscribed += 1
        listeners.delete(onChange)
      }
    },
  }
  return { t, entries, unsubscribeCount: () => unsubscribed, listenerCount: () => listeners.size }
}

/**
 * Silence the module's deliberate diagnostics for one call.
 *
 * BOTH channels (FIX_ROUND-5): the no-transport paths log at `warn` and the
 * throwing-provider paths at `error`, so stubbing only `error` let the warnings
 * leak into the suite output — the helper stopped doing what its name says on
 * the very path it was written for.
 */
async function quiet<T>(fn: () => T | Promise<T>): Promise<T> {
  const originalError = console.error
  const originalWarn = console.warn
  console.error = () => {}
  console.warn = () => {}
  try {
    return await fn()
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

test.beforeEach(() => __resetElicitationTransportForTests())
test.after(() => __resetElicitationTransportForTests())

test('degrades cleanly with NO transport installed — never throws, reports "unknown"', async () => {
  assert.equal(hasElicitationTransport(), false)
  assert.equal(elicitationExists('e1'), false)
  assert.equal(elicitationStatus('e1'), undefined)
  // The consumer injects its card unconditionally after registering, so a
  // dropped registration must be REPORTED, not swallowed as success.
  assert.equal(await quiet(() => registerElicitation({ elicitation_id: 'e1', message: 'm' })), false)
  assert.equal(await quiet(() => resolveElicitationVia('e1', 'accept')), false)
})

test('a registered transport carries has/status/register/resolve', async () => {
  const { t, entries } = stubTransport()
  setElicitationTransport(t, 'mcp')

  assert.equal(hasElicitationTransport(), true)
  assert.equal(elicitationExists('e1'), false)
  assert.equal(registerElicitation({ elicitation_id: 'e1', message: 'go' }), true)
  assert.equal(elicitationExists('e1'), true)
  assert.equal(elicitationStatus('e1'), 'pending')
  assert.equal(await resolveElicitationVia('e1', 'accept'), true)
  assert.equal(entries.get('e1'), 'accepted')
})

test('provider changes bump the version and notify subscribers', () => {
  const { t } = stubTransport()
  let notified = 0
  const unsub = subscribeElicitation(() => {
    notified += 1
  })

  const atStart = elicitationVersion()
  setElicitationTransport(t, 'mcp')
  assert.equal(notified, 1, 'installing a transport is itself a change')
  registerElicitation({ elicitation_id: 'e1', message: 'go' })
  assert.equal(notified, 2, 'a provider-side change must reach the seam')
  assert.ok(elicitationVersion() > atStart, 'version must be monotonic for useSyncExternalStore')

  unsub()
  registerElicitation({ elicitation_id: 'e2', message: 'go' })
  assert.equal(notified, 2, 'unsubscribe must actually detach')
})

test('re-registering DETACHES the previous transport (no leaked subscription)', () => {
  const first = stubTransport()
  const second = stubTransport()
  setElicitationTransport(first.t, 'mcp')
  assert.equal(first.listenerCount(), 1)

  setElicitationTransport(second.t, 'mcp')
  assert.equal(first.unsubscribeCount(), 1, 'the first transport must be unsubscribed')
  assert.equal(first.listenerCount(), 0)
  assert.equal(second.listenerCount(), 1)

  // Idempotent: setting the SAME transport again is a no-op, not a churn.
  setElicitationTransport(second.t, 'mcp')
  assert.equal(second.unsubscribeCount(), 0)
})

test('teardown is OWNER-SCOPED — another extension unregistering cannot detach it', () => {
  const { t, unsubscribeCount } = stubTransport()
  setElicitationTransport(t, 'mcp')

  clearElicitationTransportIfOwnedBy('js-tool')
  assert.equal(hasElicitationTransport(), true, 'a different owner must not detach it')
  assert.equal(unsubscribeCount(), 0)

  clearElicitationTransportIfOwnedBy('mcp')
  assert.equal(hasElicitationTransport(), false, 'the installing owner must detach it')
  assert.equal(unsubscribeCount(), 1)
})

test('a throwing subscribe REFUSES the install rather than half-installing', async () => {
  const { t } = stubTransport({ subscribe: true })
  await quiet(() => setElicitationTransport(t, 'mcp'))
  // The pre-fix behaviour left `transport` assigned with no change subscription:
  // every card frozen at the status it first read, and the throw escaping into
  // the registering extension's `initialize`.
  assert.equal(hasElicitationTransport(), false)
  assert.equal(elicitationStatus('e1'), undefined)
})

test('a throwing provider never breaks a transcript render', async () => {
  const { t } = stubTransport({ has: true, status: true, register: true, resolve: true })
  setElicitationTransport(t, 'mcp')

  assert.equal(await quiet(() => elicitationExists('e1')), false)
  assert.equal(await quiet(() => elicitationStatus('e1')), undefined)
  assert.equal(await quiet(() => registerElicitation({ elicitation_id: 'e1', message: 'm' })), false)
  // A rejecting `resolve` must be reported as unresolved, not floated as an
  // unhandled rejection out of the card's onClick.
  assert.equal(await quiet(() => resolveElicitationVia('e1', 'accept')), false)
})

test('elicitationBlockedReason keeps NO-TRANSPORT and RESOLVE-FAILED distinct', () => {
  assert.equal(
    elicitationBlockedReason({ hasTransport: true, resolveFailed: false }),
    null,
    'the healthy case is actionable',
  )

  // No transport: nothing can carry the decision -> the controls must be dead.
  assert.equal(elicitationBlockedReason({ hasTransport: false, resolveFailed: false }), 'no-transport')

  // A rejected POST with a transport present is TRANSIENT and must stay
  // retryable — this is the distinction FIX_ROUND-4 collapsed, which made one
  // failure disable the card for the life of the mount.
  assert.equal(elicitationBlockedReason({ hasTransport: true, resolveFailed: true }), 'resolve-failed')

  // No transport dominates: reporting "try again" would be a lie when there is
  // nothing to try against.
  assert.equal(elicitationBlockedReason({ hasTransport: false, resolveFailed: true }), 'no-transport')

  // LIVE, not latched: the same resolveFailed with a transport back is the
  // retryable state, and with the failure cleared it is actionable again — the
  // caller re-derives on every seam bump, so the card recovers by itself.
  assert.equal(elicitationBlockedReason({ hasTransport: true, resolveFailed: false }), null)
})
