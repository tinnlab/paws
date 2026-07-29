import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_CREATED_CAP,
  __resetSessionCreatedForTests,
  forgetSessionCreatedConversation,
  isSessionCreatedConversation,
  noteSessionCreatedConversation,
} from './sessionCreatedConversations.ts'

/**
 * TEST-5 — the guard that keeps `GET /api/background/runs` off the compose-send
 * path (the audit's `network/irrelevant` row) without ever making a
 * server-loaded conversation skip its probe.
 */

test('an id created in this session is remembered; an unrelated id is not', () => {
  __resetSessionCreatedForTests()
  noteSessionCreatedConversation('conv-a')
  assert.equal(isSessionCreatedConversation('conv-a'), true)
  // The load-bearing negative: a conversation this tab did NOT create must
  // still probe, or a reload would never surface pre-existing runs.
  assert.equal(isSessionCreatedConversation('conv-b'), false)
})

test('the mark EXPIRES at the end of the first turn — it is not a session-long suppression', () => {
  // This is the load-bearing property. Without expiry, a conversation this tab
  // created keeps skipping both probes forever: `BackgroundRuns` DELETES its
  // cached slice on unmount, so after one navigate-away-and-back the Tasks
  // footer would be permanently empty (and it is the only route to the Tasks
  // panel); and the single-entry summary cache rotates on any switch, so the
  // boundary marker would be permanently blank. Both were real defects found by
  // the blind audit.
  __resetSessionCreatedForTests()
  noteSessionCreatedConversation('conv-a')
  assert.equal(isSessionCreatedConversation('conv-a'), true)
  forgetSessionCreatedConversation('conv-a')
  assert.equal(isSessionCreatedConversation('conv-a'), false)
})

test('forgetting is idempotent and safe for an id that was never marked', () => {
  __resetSessionCreatedForTests()
  forgetSessionCreatedConversation('never-marked')
  noteSessionCreatedConversation('conv-a')
  forgetSessionCreatedConversation('conv-a')
  forgetSessionCreatedConversation('conv-a')
  assert.equal(isSessionCreatedConversation('conv-a'), false)
})

test('marking is idempotent', () => {
  __resetSessionCreatedForTests()
  noteSessionCreatedConversation('conv-a')
  noteSessionCreatedConversation('conv-a')
  noteSessionCreatedConversation('conv-a')
  assert.equal(isSessionCreatedConversation('conv-a'), true)
})

test('an empty id is ignored (never marks "" as session-created)', () => {
  __resetSessionCreatedForTests()
  noteSessionCreatedConversation('')
  assert.equal(isSessionCreatedConversation(''), false)
})

test('the set is bounded: past the cap the OLDEST id is forgotten and re-probes', () => {
  __resetSessionCreatedForTests()
  for (let i = 0; i < SESSION_CREATED_CAP + 5; i += 1) {
    noteSessionCreatedConversation(`conv-${i}`)
  }
  // The first five are evicted → they fall back to probing, which is the
  // pre-change behaviour (the safe direction to fail in).
  for (let i = 0; i < 5; i += 1) {
    assert.equal(isSessionCreatedConversation(`conv-${i}`), false)
  }
  // Everything inside the window is still remembered.
  assert.equal(isSessionCreatedConversation(`conv-${SESSION_CREATED_CAP + 4}`), true)
  assert.equal(isSessionCreatedConversation(`conv-${SESSION_CREATED_CAP}`), true)
})
