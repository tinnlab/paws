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
  elicitationNotice,
  elicitationIsUnactionable,
  resolveDidFail,
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

test('elicitationBlockedReason keeps its BEHAVIOURAL states distinct', () => {
  // FIX_ROUND-20: two states, not three. `not-registered` is gone from this union
  // because it decided NOTHING here — it neither disabled nor errored — and while
  // it was a member every action path could branch on it. The assertions that used
  // to pin it inert (`elicitationIsUnactionable('not-registered') === false`,
  // `elicitationIsError('not-registered') === false`) are deleted rather than
  // rewritten: the value is no longer in the type, so nothing can act on it.
  const healthy = { hasTransport: true, resolveFailed: false }
  assert.equal(elicitationBlockedReason(healthy), null, 'the healthy case is actionable')

  // Nothing can carry the decision -> the controls must be dead.
  assert.equal(elicitationBlockedReason({ ...healthy, hasTransport: false }), 'no-transport')

  // A rejected POST is TRANSIENT and must stay retryable — the distinction
  // FIX_ROUND-4 collapsed, which disabled the card for the life of the mount.
  assert.equal(elicitationBlockedReason({ ...healthy, resolveFailed: true }), 'resolve-failed')

  // PRECEDENCE: no-transport dominates — a resolve cannot have failed through a
  // transport that is not there.
  assert.equal(
    elicitationBlockedReason({ hasTransport: false, resolveFailed: true }),
    'no-transport',
  )

  // LIVE, not latched: with the transport back and the flag cleared, actionable.
  assert.equal(elicitationBlockedReason(healthy), null)
})

test('ONLY the impossible state disables a control', () => {
  // The through-line of three regressions in this file: every time a state that
  // the user could still act through was DISABLED, the card became unanswerable.
  assert.equal(elicitationIsUnactionable('no-transport'), true)
  assert.equal(elicitationIsUnactionable('resolve-failed'), false)
  assert.equal(elicitationIsUnactionable(null), false)
})

test('elicitationNotice decides text, tone and probe token TOGETHER', () => {
  // FIX_ROUND-20. This replaces `elicitationIsError` and the ~35-line source
  // guard that pinned its call site. FIX_ROUND-9's defect was a DIVERGENCE
  // between copy and tone — "you can still answer it" painted in the destructive
  // red reserved for errors — so they are now returned per case by one function,
  // which this runner can actually execute (it cannot mount the JSX).
  const base = {
    resolved: null,
    blocked: null,
    entryOpen: true,
    healExhausted: false,
  } as const

  // Ordinary pending: nothing to say, nothing to paint.
  assert.deepEqual(elicitationNotice(base), { text: '', tone: 'secondary', status: 'pending' })

  // The two states that genuinely stop the user ARE errors.
  //
  // The sentences are pinned WHOLE, not by substring (FIX_ROUND-20b): a loose
  // `/approval channel is unavailable/` left three harmful rewrites green,
  // including dropping BOTH recovery instructions from the only state that
  // disables the card, and appending "(nothing was sent)" to the approved copy —
  // which tells the user something false.
  const noTransport = elicitationNotice({ ...base, blocked: 'no-transport' })
  assert.equal(noTransport.tone, 'danger')
  assert.equal(noTransport.status, 'no-transport')
  assert.equal(
    noTransport.text,
    'This request cannot be answered right now — the approval channel is unavailable. ' +
      'It will become answerable on its own once the connection is back, or reload the conversation.',
  )

  const failed = elicitationNotice({ ...base, blocked: 'resolve-failed' })
  assert.equal(failed.tone, 'danger')
  assert.equal(failed.status, 'resolve-failed')
  assert.equal(failed.text, "That didn't go through — try again.")

  // THE SCAR TISSUE (FIX_ROUND-9): no local entry is transient, self-healing and
  // explicitly answerable, so it must NOT be painted destructive — and its copy
  // must say so. Both halves are asserted here, on the same object, because the
  // bug was them disagreeing.
  const notOpen = elicitationNotice({ ...base, entryOpen: false })
  assert.equal(notOpen.tone, 'secondary', 'progress, not an error')
  assert.equal(notOpen.status, 'not-registered')
  assert.equal(notOpen.text, 'This request is not open locally — you can still answer it.')

  // …and once the bounded self-heal budget is spent there IS no local path back,
  // so the copy adds the reload hint — still answerable, still not an error.
  const exhausted = elicitationNotice({ ...base, entryOpen: false, healExhausted: true })
  assert.equal(exhausted.tone, 'secondary')
  assert.equal(exhausted.status, 'not-registered')
  assert.equal(
    exhausted.text,
    'This request could not be reopened locally — you can still answer it, or reload the conversation.',
  )

  // Neither not-registered sentence may claim work is IN FLIGHT (FIX_ROUND-14):
  // a retry only happens on a seam change and a failed register bumps nothing, so
  // between attempts there is genuinely nothing scheduled.
  for (const n of [notOpen, exhausted]) {
    assert.doesNotMatch(n.text, /ing…|Reopening|Retrying/, 'no present-progressive claim')
  }

  // A RESOLVED card is never painted destructive, whatever else is true — the
  // property the old `!resolved && …` tone condition carried, now structural.
  for (const resolved of ['approved', 'denied'] as const) {
    for (const blocked of [null, 'no-transport', 'resolve-failed'] as const) {
      const n = elicitationNotice({ ...base, resolved, blocked, entryOpen: false })
      assert.equal(n.tone, 'secondary', `${resolved} + ${blocked} must not be destructive`)
      assert.equal(n.status, resolved, 'the outcome outranks every blocked reason')
    }
  }
  assert.match(elicitationNotice({ ...base, resolved: 'approved' }).text, /script resumed/)
  assert.equal(elicitationNotice({ ...base, resolved: 'denied' }).text, 'Denied.')

  // ── PRECEDENCE ────────────────────────────────────────────────────────────
  //
  // FIX_ROUND-20b: this whole block was MISSING, and its absence was the round's
  // worst self-inflicted hole. Moving the `no-transport` branch below the
  // `!entryOpen` branch was tsc-clean and left all 21 tests green — yet
  // `elicitationExists()` returns false whenever there is NO transport, so
  // `{blocked:'no-transport', entryOpen:false}` is not an exotic cell, it is the
  // DOMINANT no-transport cell. The mutated build therefore never shows the
  // no-transport sentence at all: the card is DISABLED and simultaneously reads
  // "you can still answer it" in non-error tone — verbatim the FIX_ROUND-9
  // copy/tone divergence this function is supposed to make unwritable.
  //
  // Before the refactor an equivalent swap was caught by an assertion on
  // `elicitationBlockedReason`'s ordering; the refactor deleted that assertion
  // along with the value and did not replace it. Ordering used to be enforced by
  // the union's check order; here it is bare statement order, so it needs a test.
  //
  // Read as a total order: resolved > no-transport > resolve-failed > not-open.
  assert.equal(
    elicitationNotice({ ...base, blocked: 'no-transport', entryOpen: false }).status,
    'no-transport',
    'THE dominant no-transport cell — elicitationExists() is false whenever there is no transport',
  )
  assert.equal(
    elicitationNotice({ ...base, blocked: 'no-transport', entryOpen: false }).tone,
    'danger',
    'the one state that DISABLES the card must never read as answerable progress',
  )
  assert.equal(
    elicitationNotice({ ...base, blocked: 'no-transport', entryOpen: false, healExhausted: true })
      .status,
    'no-transport',
    'a spent heal budget must not outrank the disabling state either',
  )
  // A failure the user just caused outranks a background condition they did not.
  // (This half is the deliberate change of order recorded in DEC-13; reachable
  // only when the provider's own `resolve` threw, since `resolveDidFail` does not
  // report a rollback it had no entry to observe.)
  assert.equal(
    elicitationNotice({ ...base, blocked: 'resolve-failed', entryOpen: false }).status,
    'resolve-failed',
  )
  assert.equal(
    elicitationNotice({ ...base, blocked: 'resolve-failed', entryOpen: false }).tone,
    'danger',
  )
})

test('resolveDidFail: judge the outcome ONLY when there was an entry to judge by', () => {
  const undef = undefined
  // Nothing carried the decision -> failure, whatever the provider holds.
  assert.equal(resolveDidFail({ carried: false, hadEntry: true, after: 'pending' }), true)
  assert.equal(resolveDidFail({ carried: false, hadEntry: false, after: undef }), true)

  // Carried, entry present, still pending -> the provider ROLLED BACK: a real
  // rejected POST, and the one the shipped provider actually reports this way.
  assert.equal(resolveDidFail({ carried: true, hadEntry: true, after: 'pending' }), true)

  // Carried and settled -> success.
  assert.equal(resolveDidFail({ carried: true, hadEntry: true, after: 'accepted' }), false)
  assert.equal(resolveDidFail({ carried: true, hadEntry: true, after: 'declined' }), false)

  // THE DISCRIMINATING CELL (FIX_ROUND-11): carried, NO entry, but the provider
  // reports 'pending' anyway. Without this row the `hadEntry &&` conjunct — the
  // whole point of the function — could be deleted and the test stayed green,
  // because every other hadEntry:false row pairs with `undefined`, where both
  // implementations agree. The published contract permits `status()` to answer
  // while `has()` is false, so this is reachable for a conforming provider.
  assert.equal(
    resolveDidFail({ carried: true, hadEntry: false, after: 'pending' }),
    false,
    'with no entry there is nothing to judge — the POST still went out',
  )

  // Terminal statuses are not failures, including the 404 -> cancelled mapping.
  assert.equal(resolveDidFail({ carried: true, hadEntry: true, after: 'cancelled' }), false)
  assert.equal(resolveDidFail({ carried: true, hadEntry: true, after: undef }), false)

  // THE FIX (FIX_ROUND-9): carried with NO entry. The optimistic update is a
  // no-op so the status stays undefined — but the POST went out and the script
  // resumed. Reporting that as a failure marked a SUCCESSFUL approve as failed.
  assert.equal(
    resolveDidFail({ carried: true, hadEntry: false, after: undef }),
    false,
    'a successful POST with no local entry is NOT a failure',
  )
})
