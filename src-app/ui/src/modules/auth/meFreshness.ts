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
 *     mutation completed and no realtime-sync frame arrived in between.
 *
 * (2) is what keeps `updateProfile()`'s post-save `refreshCurrentUser()` always
 * running: the profile PUT bumps the epoch when it completes, so the refresh
 * that follows it is never suppressed.
 */

/** How long after a `/me` lands a redundant re-fetch is suppressed. Sized from
 *  the measured boot gap (~380 ms between the two calls) with an order of
 *  magnitude of headroom, and far below any realistic "user came back later". */
export const ME_BOOT_FRESH_MS = 3_000

let lastMeAt = 0
let lastMeEpoch = -1

/** Record that a `/me` response just landed. */
export function noteMeLoaded(now: number = Date.now()): void {
  lastMeAt = now
  lastMeEpoch = currentFetchEpoch()
}

/** True when a `/me` re-fetch would return what we already have. */
export function isMeFresh(now: number = Date.now()): boolean {
  if (lastMeEpoch < 0) return false
  if (lastMeEpoch !== currentFetchEpoch()) return false
  return now - lastMeAt < ME_BOOT_FRESH_MS
}

/** Test seam. */
export function __resetMeFreshnessForTests(): void {
  lastMeAt = 0
  lastMeEpoch = -1
}
