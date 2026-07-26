import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasLiveSession } from './liveSession.ts'
import {
  isEligible,
  type ModuleManifestEntry,
} from '../../../../sdk/packages/framework/src/module-system/manifest.ts'
import type { ModuleLoadContext } from '../../../../sdk/packages/framework/src/module-system/types.ts'

/**
 * TEST-6 (ITEM-6) — INV-5.
 *
 * `isAuthenticated` is NOT persisted (the Auth store's `partialize` keeps only
 * `{token, expiresAt, expiresIn}`), so on a cold boot it was `false` until
 * `GET /api/auth/me` resolved — which serialized every
 * `shouldLoad: ctx => ctx.isAuthenticated` module strictly behind that response.
 * Deriving it from a LIVE persisted token lets those modules register in the
 * first wave, in parallel with the verification.
 *
 * The invariant this must not break: a permission-gated predicate means the
 * module's CODE never reaches a user who lacks the permission. Permissions must
 * therefore stay non-persisted — this test fails if a future change "speeds up
 * boot" by persisting them.
 */

const NOW = 1_800_000_000_000

/** Exactly the context `buildLoadContext` produces for a cold boot: a live
 *  token, but user + permissions still unknown because `/me` has not landed. */
const coldBootContext = (): ModuleLoadContext => ({
  isAuthenticated: hasLiveSession({ token: 'jwt', expiresAt: NOW + 60_000 }),
  needsSetup: false,
  path: '/',
  permissions: [],
  platform: 'web',
  // `can` mirrors `buildLoadContext`'s: evaluated against the SAME (empty)
  // snapshot, with no persisted user, so nothing is granted.
  can: () => false,
})

const authGated: ModuleManifestEntry = {
  name: 'chat',
  routePaths: ['/chat'],
  dependencies: [],
  load: async () => ({ default: {} }) as never,
  shouldLoad: ctx => ctx.isAuthenticated,
}

const permGated: ModuleManifestEntry = {
  name: 'server-update',
  routePaths: ['/settings/about'],
  dependencies: [],
  load: async () => ({ default: {} }) as never,
  shouldLoad: ctx => ctx.isAuthenticated && ctx.can('server_update::read'),
}

test('TEST-6: a live persisted token counts as authenticated before /me lands', () => {
  assert.equal(hasLiveSession({ token: 'jwt', expiresAt: NOW + 60_000 }), true)
})

test('TEST-6: no token, or an EXPIRED token, is not a live session', () => {
  assert.equal(hasLiveSession({ token: null, expiresAt: NOW + 60_000 }), false)
  assert.equal(hasLiveSession({ token: undefined, expiresAt: undefined }), false)
  assert.equal(hasLiveSession({ token: 'jwt', expiresAt: 1 }), false)
})

test('TEST-6: a token persisted without an expiry is trusted (legacy shape)', () => {
  assert.equal(hasLiveSession({ token: 'jwt', expiresAt: null }), true)
})

test('TEST-6 [acceptance/INV-5]: an auth-gated module loads in wave 1, a PERMISSION-gated one does NOT', () => {
  const ctx = coldBootContext()
  assert.equal(ctx.isAuthenticated, true, 'the widening must actually apply')
  assert.equal(
    isEligible(authGated, ctx),
    true,
    'ctx.isAuthenticated-gated module registers in the first wave (the whole point)',
  )
  assert.equal(
    isEligible(permGated, ctx),
    false,
    'a ctx.can()-gated module must STILL wait — its code must not be delivered ' +
      'to a user whose permissions are unknown. Fails if permissions are ever persisted.',
  )
})

test('TEST-6: with no live session nothing auth-gated loads', () => {
  const ctx: ModuleLoadContext = {
    ...coldBootContext(),
    isAuthenticated: hasLiveSession({ token: null, expiresAt: null }),
  }
  assert.equal(isEligible(authGated, ctx), false)
  assert.equal(isEligible(permGated, ctx), false)
})
