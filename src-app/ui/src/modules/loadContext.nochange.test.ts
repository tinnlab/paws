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

/** The `isAuthenticated:` value expression, whitespace-collapsed. */
const isAuthExpr = (() => {
  const m = /isAuthenticated:\s*([^,]+),/.exec(src)
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
})()

test('TEST-14 [acceptance/INV-5]: isAuthenticated derives ONLY from the verified session flag', () => {
  // Assert the VALUE EXPRESSION, not the formatting: any reintroduction of the
  // widening has to add a second term here, whatever it is named. A denylist of
  // specific identifiers would miss a rename; this cannot.
  assert.equal(
    isAuthExpr,
    '!!auth.isAuthenticated',
    'buildLoadContext must derive isAuthenticated from the verified session flag ' +
      'ALONE. Deriving it from a persisted token delivers auth-gated module code ' +
      'to a holder of a revoked-but-unexpired token, and modules are never ' +
      'unloaded, so the later failed verification cannot undo it (DEC-15).',
  )
})

test('TEST-14 [acceptance/INV-5]: buildLoadContext reads no persisted-token state at all', () => {
  // `token` / `expiresAt` are the persisted fields (Auth's partialize keeps only
  // those). Eligibility must not consult either, under any wrapper.
  for (const field of ['token', 'expiresAt', 'expiresIn']) {
    assert.ok(
      !new RegExp(`\\b${field}\\b`).test(src),
      `buildLoadContext must not read the persisted "${field}" (DEC-15)`,
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
  // Structural, not formatting-coupled: `can` must route through
  // `evaluatePermission` with that snapshot, however it is line-wrapped.
  const collapsed = src.replace(/\s+/g, ' ')
  assert.ok(
    /can: \(\.\.\.perms: string\[\]\) => perms\.every\(p => evaluatePermission\(user, permissions, p\)\)/.test(
      collapsed,
    ),
    'can() must evaluate every perm through evaluatePermission against that snapshot',
  )
})
