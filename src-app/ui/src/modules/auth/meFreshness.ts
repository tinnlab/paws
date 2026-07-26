import { currentFetchEpoch } from '@ziee/framework/api-client/inflight'

/**
 * Boot-window freshness for `GET /api/auth/me`.
 *
 * On a cold load of `/settings/profile` the app fetched `/me` TWICE ~380 ms
 * apart: once from the boot session verification, and again from
 * `ProfileSettingsPage`'s mount effect (which exists so `has_password` is
 * accurate when the user arrived via an in-session login, whose login response
 * carries no `has_password`). The two are not concurrent, so the transport's
 * in-flight coalescer cannot merge them — this closes the near-miss.
 *
 * It is a SUPPRESSION WINDOW, not a cache: nothing is stored or replayed, and it
 * only ever declines to issue a request whose answer just arrived. Two
 * conditions must BOTH hold, so it can never hide a real change:
 *
 *  1. a `/me` response landed less than `ME_BOOT_FRESH_MS` ago, and
 *  2. the transport freshness epoch has not moved since — i.e. no local
 *     mutation completed, no realtime-sync frame arrived, AND the session
 *     identity did not change, in between.
 *
 * (2) is what keeps `updateProfile()`'s post-save `refreshCurrentUser()` always
 * running: the profile PUT bumps the epoch when it completes, so the refresh
 * that follows it is never suppressed.
 *
 * The epoch is bumped by `callAsync` (any completed non-GET) and by `SyncClient`
 * (any inbound frame) — but an IDENTITY change can happen through neither: a
 * local `endSession()` teardown wipes `user`/`permissions` with no HTTP call at
 * all, and desktop `auto_login` / the tunnel's `applySession` seed a whole new
 * session over Tauri IPC. Both would otherwise leave a stale window armed over a
 * store that no longer holds that identity's data, so `invalidateMeFreshness()`
 * below is called from those paths. That is the third bump site, and it is the
 * one the transport cannot see.
 */

/** How long after a `/me` lands a redundant re-fetch is suppressed. Sized from
 *  the measured boot gap (~380 ms between the two calls) with an order of
 *  magnitude of headroom, and far below any realistic "user came back later". */
export const ME_BOOT_FRESH_MS = 3_000

let lastMeAt = 0
let lastMeEpoch = -1

/**
 * The epoch to stamp a `/me` with — captured BEFORE the request is issued.
 *
 * Stamping at RESPONSE time would be a correctness bug with the same shape the
 * coalescer avoids (`coalesce` captures `fetchEpoch` before calling `start()`):
 * a `/me` already on the wire when a mutation completes would be recorded with
 * the POST-mutation epoch and marked fresh, so the refresh that mutation
 * triggers would be suppressed and the UI would keep pre-mutation data. Capture
 * before, compare after.
 *
 *   const at = meRequestEpoch()
 *   const res = await ApiClient.Auth.me(...)
 *   noteMeLoaded(at)
 */
export function meRequestEpoch(): number {
  return currentFetchEpoch()
}

/** Record that a `/me` response landed, stamped with the epoch captured at
 *  REQUEST time (see `meRequestEpoch`). */
export function noteMeLoaded(requestEpoch: number, now: number = Date.now()): void {
  lastMeAt = now
  lastMeEpoch = requestEpoch
}

/** True when a `/me` re-fetch would return what we already have. */
export function isMeFresh(now: number = Date.now()): boolean {
  if (lastMeEpoch < 0) return false
  if (lastMeEpoch !== currentFetchEpoch()) return false
  return now - lastMeAt < ME_BOOT_FRESH_MS
}

// ── The two decisions the Auth store makes with the above ────────────────────
// Extracted as pure predicates so they are unit-testable. The store's own spec
// cannot load in this tree (a pre-existing module-resolution failure), and these
// are the branches where getting it wrong means serving pre-mutation data.

/**
 * May a caller JOIN an already-in-flight `/me`?
 *
 * Only if that request was ISSUED in the current freshness epoch. A caller
 * arriving after a mutation must not join a request that started before it and
 * receive pre-mutation data — the same rule `coalesce` applies at the transport.
 */
export function canJoinMeRefresh(
  inFlightEpoch: number,
  force = false,
  now: number = currentFetchEpoch(),
): boolean {
  if (force) return false
  return inFlightEpoch === now
}

/**
 * May a `/me` fetch be SKIPPED entirely?
 *
 * Only when it is fresh AND the caller did not ask for server truth. `force`
 * always wins — it exists for a caller that needs the round-trip regardless.
 */
export function shouldSkipMeFetch(force = false, now: number = Date.now()): boolean {
  if (force) return false
  return isMeFresh(now)
}

/**
 * Disarm the window immediately, without an HTTP round-trip. Call from any path
 * that changes WHO the session is by means the transport cannot observe — a local
 * session teardown, or a token/user seeded over IPC — so a later
 * `refreshCurrentUser()` is never suppressed against a store that has been
 * cleared or re-pointed at a different identity.
 */
export function invalidateMeFreshness(): void {
  lastMeAt = 0
  lastMeEpoch = -1
}

/** Test seam. */
export function __resetMeFreshnessForTests(): void {
  invalidateMeFreshness()
}
