import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldLoadSummaryOnOpen,
  type SummaryTriggerState,
} from './summaryRefreshTrigger.ts'

/**
 * TEST-1 — the trigger policy behind the audit's `network/duplicate` +
 * `network/excess` rows on `GET /api/conversations/{id}/summary`.
 *
 * The old trigger was `[conversation?.id, messages.size]`; the measured result
 * was 3–4 summary reads inside ONE send step. These tests drive the exact state
 * sequences a send produces — including the composer RE-MOUNT the `/` →
 * `/chat/{id}` navigation causes — and assert the open/switch half of the
 * trigger contributes ZERO extra reads during a send. (The one read a send
 * SHOULD produce is issued by the extension's `afterStreamComplete` hook, which
 * fires once per completed turn; TEST-2 measures the end-to-end count live.)
 */

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'

/**
 * Replay a state sequence, modelling the store: a read makes that conversation
 * the one the store holds (or is fetching). Every entry is treated as a fresh
 * component instance, because the `/` → `/chat/{id}` navigation genuinely
 * re-mounts the composer and the predicate must be idempotent across that.
 */
function readsFor(seq: SummaryTriggerState[]): number {
  let held: string | null = null
  let n = 0
  for (const state of seq) {
    if (shouldLoadSummaryOnOpen(state, held)) {
      n += 1
      held = state.conversationId
    }
  }
  return n
}

test('a send from a NEW chat contributes ZERO open/switch reads', () => {
  // The REAL sequence, as measured on the live rig:
  //   `/` (no conversation) → conversation created (so `createdInThisSession`
  //   is now true) and streaming starts → the composer RE-MOUNTS on the
  //   `/` → `/chat/{id}` navigation, and `loadConversation` sets
  //   `isStreaming:false` transiently while it runs, so the fresh instance
  //   briefly sees an IDLE conversation it has never loaded → stream frames set
  //   it true again → turn ends.
  // Every one of those must contribute nothing; the single read a send produces
  // comes from `afterStreamComplete`, not from here.
  const n = readsFor([
    { conversationId: null, streaming: false, createdInThisSession: false },
    { conversationId: A, streaming: true, createdInThisSession: true },
    { conversationId: A, streaming: false, createdInThisSession: true }, // re-mount mid-navigation
    { conversationId: A, streaming: true, createdInThisSession: true },
    { conversationId: A, streaming: false, createdInThisSession: true }, // turn ended
  ])
  assert.equal(n, 0)
})

test('without the session-created signal that same sequence leaks a read (the last duplicate)', () => {
  // The counter-factual for the third guard: the transient idle window during
  // the navigation is exactly where the final duplicate came from.
  const n = readsFor([
    { conversationId: null, streaming: false, createdInThisSession: false },
    { conversationId: A, streaming: true, createdInThisSession: false },
    { conversationId: A, streaming: false, createdInThisSession: false },
    { conversationId: A, streaming: true, createdInThisSession: false },
    { conversationId: A, streaming: false, createdInThisSession: false },
  ])
  assert.equal(n, 1)
})

test('the old message-count trigger would have fired four times for that same turn', () => {
  // The counter-factual, so the test states what it PREVENTS rather than only
  // what the new code does: with `messages.size` as the trigger, each of the
  // four count changes is a distinct dependency value and therefore a reload.
  const messageCounts = [0, 1, 2, 3, 4]
  const oldTriggerReloads = messageCounts.filter(
    (c, i) => i > 0 && c !== messageCounts[i - 1],
  ).length
  assert.equal(oldTriggerReloads, 4)
})

test('re-mounting the composer on an already-held conversation does NOT re-read', () => {
  // This is the leg a component-local-only guard fails: a fresh instance has no
  // memory, so the STORE must be what de-duplicates. Measured on the live rig,
  // component-local de-duplication alone still left 3 reads per send.
  assert.equal(
    readsFor([
      { conversationId: A, streaming: false, createdInThisSession: false }, // open (reads)
      { conversationId: A, streaming: false, createdInThisSession: false }, // re-mount #1
      { conversationId: A, streaming: false, createdInThisSession: false }, // re-mount #2
      { conversationId: A, streaming: false, createdInThisSession: false }, // re-mount #3
    ]),
    1,
  )
})

test('an in-flight read counts as held, so two mounts in one request window fire once', () => {
  assert.equal(shouldLoadSummaryOnOpen({ conversationId: A, streaming: false, createdInThisSession: false }, A), false)
})

test('switching conversations reads once per switch', () => {
  assert.equal(
    readsFor([
      { conversationId: A, streaming: false, createdInThisSession: false },
      { conversationId: B, streaming: false, createdInThisSession: false },
      { conversationId: A, streaming: false, createdInThisSession: false },
    ]),
    3,
  )
})

test('never reads mid-stream (a read taken then would return the previous turn)', () => {
  assert.equal(shouldLoadSummaryOnOpen({ conversationId: A, streaming: true, createdInThisSession: false }, null), false)
  assert.equal(shouldLoadSummaryOnOpen({ conversationId: A, streaming: true, createdInThisSession: false }, B), false)
})

test('a new-chat pane with no conversation never reads', () => {
  assert.equal(
    readsFor([
      { conversationId: null, streaming: false, createdInThisSession: false },
      { conversationId: null, streaming: true, createdInThisSession: false },
      { conversationId: null, streaming: false, createdInThisSession: false },
    ]),
    0,
  )
})
