/**
 * Is there a LIVE persisted session?
 *
 * `isAuthenticated` is not persisted — the Auth store's `partialize` keeps only
 * `{token, expiresAt, expiresIn}` — so on a cold boot it is `false` until
 * `GET /api/auth/me` resolves. That made EVERY
 * `shouldLoad: ctx => ctx.isAuthenticated` module (chat, projects, notification,
 * onboarding, …) strictly downstream of that one response: the module loader's
 * first wave registered only core modules, and everything else waited. A
 * present, unexpired access token is exactly what the Auth store itself treats
 * as a live session, so deriving from it lets those modules register in the
 * FIRST wave, in parallel with the verification rather than after it.
 *
 * SECURITY — this widens ONLY `isAuthenticated`. Permissions are deliberately
 * NOT persisted, so `buildLoadContext`'s `can(...)` still evaluates against an
 * empty set until `/auth/me` lands, and a `ctx.can(Permissions.X)`-gated
 * module's CODE is still never delivered to a user who lacks the permission —
 * the contract documented in `modules/loader.ts`. Modules are never unloaded, so
 * a stale persisted permission would leak a gated chunk for the whole session;
 * that is why the faster option is declined (see DEC-8).
 *
 * Kept in its own dependency-free module so the predicate is unit-testable
 * without pulling in the Auth store's whole graph.
 */
export function hasLiveSession(auth: {
  token?: string | null
  expiresAt?: number | null
}): boolean {
  if (!auth.token) return false
  // A null `expiresAt` means an older persisted shape (or a token minted before
  // expiry tracking) — trust the token's presence, exactly as the store does.
  return auth.expiresAt == null || auth.expiresAt > Date.now()
}
