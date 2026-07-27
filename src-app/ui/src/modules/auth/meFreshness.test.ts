import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ME_BOOT_FRESH_MS,
  __resetMeFreshnessForTests,
  canJoinMeRefresh,
  invalidateMeFreshness,
  isMeFresh,
  meRequestEpoch,
  noteMeLoaded,
  shouldSkipMeFetch,
} from './meFreshness.ts'
import {
  __resetInflightForTests,
  bumpFetchEpoch,
} from '../../../../../sdk/packages/framework/src/api-client/inflight.ts'

/**
 * TEST-7 (ITEM-7) — INV-1.
 *
 * `ProfileSettingsPage` refreshes `/me` on mount so `has_password` is accurate
 * after an in-session login; on a cold boot that duplicated the boot
 * verification's `/me` ~380 ms later. The suppression window must close that
 * near-miss WITHOUT ever hiding a real change — in particular `updateProfile()`
 * calls `refreshCurrentUser()` right after saving, and that must ALWAYS run.
 */

const t0 = 1_800_000_000_000

test('TEST-7: nothing is suppressed before any /me has landed', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  assert.equal(isMeFresh(t0), false)
})

test('TEST-7: a /me that just landed suppresses the redundant boot refetch', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  noteMeLoaded(meRequestEpoch(), t0)
  // The measured boot gap is ~380 ms.
  assert.equal(isMeFresh(t0 + 380), true)
  assert.equal(isMeFresh(t0 + ME_BOOT_FRESH_MS - 1), true)
})

test('TEST-7: outside the window nothing is suppressed', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  noteMeLoaded(meRequestEpoch(), t0)
  assert.equal(isMeFresh(t0 + ME_BOOT_FRESH_MS), false)
  assert.equal(isMeFresh(t0 + 60_000), false)
})

test('TEST-7 [acceptance/INV-1]: a MUTATION un-suppresses immediately — updateProfile always refetches', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  noteMeLoaded(meRequestEpoch(), t0)
  assert.equal(isMeFresh(t0 + 10), true, 'precondition: inside the window')

  // `callAsync` bumps the freshness epoch when the profile PUT completes.
  bumpFetchEpoch()

  assert.equal(
    isMeFresh(t0 + 20),
    false,
    'the post-save refresh must NEVER be suppressed, even 20ms after a /me',
  )
})

test('TEST-7 [acceptance/INV-1]: an inbound sync frame un-suppresses too', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  noteMeLoaded(meRequestEpoch(), t0)
  // SyncClient.handleFrame bumps on every inbound `sync` frame (e.g. an admin
  // changing this user's permissions on another device).
  bumpFetchEpoch()
  assert.equal(isMeFresh(t0 + 10), false)
})

test('TEST-7 [acceptance/INV-1]: a /me IN FLIGHT across a mutation is NOT marked fresh', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  // The request is issued...
  const at = meRequestEpoch()
  // ...a mutation completes WHILE it is on the wire...
  bumpFetchEpoch()
  // ...and only then does it land. It carries pre-mutation data, so it must NOT
  // arm the window — otherwise the refresh that mutation triggers would be
  // suppressed and the UI would keep stale data. (Stamping at RESPONSE time
  // instead of request time is exactly this bug.)
  noteMeLoaded(at, t0)
  assert.equal(isMeFresh(t0 + 10), false)
})

test('TEST-7: re-noting after a bump re-arms the window', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  noteMeLoaded(meRequestEpoch(), t0)
  bumpFetchEpoch()
  assert.equal(isMeFresh(t0 + 10), false)
  noteMeLoaded(meRequestEpoch(), t0 + 10) // the un-suppressed refetch landed
  assert.equal(isMeFresh(t0 + 20), true)
})

// ── The two decisions the Auth store makes (extracted so they are testable) ──

test('TEST-7 [acceptance/INV-1]: a caller may NOT join a /me issued in an older epoch', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  const issuedAt = meRequestEpoch()
  assert.equal(canJoinMeRefresh(issuedAt), true, 'same epoch → joining is safe')

  // A mutation completes while that /me is on the wire.
  bumpFetchEpoch()
  assert.equal(
    canJoinMeRefresh(issuedAt),
    false,
    'a post-mutation caller must NOT join a pre-mutation /me — it would receive ' +
      'pre-mutation data, which is exactly the defect INV-1 forbids',
  )
})

test('TEST-7: `force` always wins over both the join and the skip', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  const issuedAt = meRequestEpoch()
  assert.equal(canJoinMeRefresh(issuedAt, true), false, 'force never joins')

  noteMeLoaded(meRequestEpoch(), t0)
  assert.equal(shouldSkipMeFetch(false, t0 + 10), true, 'fresh → skip')
  assert.equal(
    shouldSkipMeFetch(true, t0 + 10),
    false,
    'force must always perform the round-trip — that is what it is for',
  )
})

test('TEST-7 [acceptance/INV-1]: an out-of-band identity change disarms the window', () => {
  __resetInflightForTests()
  __resetMeFreshnessForTests()
  noteMeLoaded(meRequestEpoch(), t0)
  assert.equal(shouldSkipMeFetch(false, t0 + 10), true, 'precondition: armed')

  // A local `endSession()` teardown, or a session seeded over Tauri IPC / the
  // tunnel, changes WHO the session is with no http call at all — so neither the
  // transport nor SyncClient bumps the epoch. Without an explicit disarm the
  // window would stay armed over a cleared / re-pointed store.
  invalidateMeFreshness()
  assert.equal(shouldSkipMeFetch(false, t0 + 10), false)
})
