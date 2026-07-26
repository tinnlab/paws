import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * TEST-14 (ITEM-6, DESCOPED) — INV-5.
 *
 * ITEM-6 would have derived `isAuthenticated` in `buildLoadContext()` from a
 * PERSISTED token so auth-gated modules register in wave 1 instead of waiting
 * for `GET /api/auth/me`. It was cut (DEC-15): a REVOKED-but-not-yet-expired
 * token in `localStorage` would then deliver AND `initialize()` every
 * `ctx.isAuthenticated`-gated module, and `modules/loader.ts` documents that
 * modules are NEVER unloaded — so the later failed verification cannot undo it.
 * Re-measuring showed it moved no number anyway (the whole waterfall win comes
 * from ITEM-5's earlier `/auth/me`).
 *
 * This is the executable form of that descope: `buildLoadContext`'s eligibility
 * inputs must keep coming from the VERIFIED session, so a permission-gated
 * module's code still reaches a user only after `/auth/me` proves the
 * permission. It turns red if the widening is reintroduced.
 *
 * Asserted on the SOURCE because `loadContext.ts` imports the Auth + App store
 * graph, which `node --test` cannot load; the property being protected is
 * structural ("what feeds the flag"), which is exactly what the source states.
 */

const src = readFileSync(
  fileURLToPath(new URL('./loadContext.ts', import.meta.url)),
  'utf8',
)

test('TEST-14 [acceptance/INV-5]: isAuthenticated comes from the VERIFIED session, not a persisted token', () => {
  assert.match(
    src,
    /isAuthenticated:\s*!!auth\.isAuthenticated\s*,/,
    'buildLoadContext must derive isAuthenticated from the verified session flag alone',
  )
  for (const forbidden of ['hasLiveSession', 'expiresAt', 'liveSession']) {
    assert.ok(
      !src.includes(forbidden),
      `buildLoadContext must not consult "${forbidden}" — deriving eligibility ` +
        `from a persisted token delivers auth-gated module code to a holder of a ` +
        `revoked-but-unexpired token, and modules are never unloaded (DEC-15)`,
    )
  }
})

test('TEST-14: permissions are still read from the (non-persisted) auth snapshot', () => {
  assert.match(
    src,
    /const permissions = auth\.permissions \?\? \[\]/,
    'permissions must come from the live auth snapshot; persisting them would ' +
      'leak a gated module chunk for the whole session',
  )
  assert.match(
    src,
    /can:\s*\(\.\.\.perms: string\[\]\) =>\s*\n?\s*perms\.every\(p => evaluatePermission\(user, permissions, p\)\)/,
    'can() must evaluate every perm through evaluatePermission against that snapshot',
  )
})
