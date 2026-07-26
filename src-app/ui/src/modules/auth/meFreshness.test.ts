import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ME_BOOT_FRESH_MS,
  __resetMeFreshnessForTests,
  isMeFresh,
  meRequestEpoch,
  noteMeLoaded,
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
