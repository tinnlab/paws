# FIX_ROUND-1

Two blind angles ran over `git diff origin/main...HEAD` (excluding `.lifecycle/`
and the generated `openapi.json` / `api-client/types.ts`): **correctness** and
**tests-quality**. 19 findings recorded in `LEDGER.jsonl`, plus 1 self-found
while fixing them.

Capture-recapture inputs: n1 (correctness) = 5, n2 (tests-quality) = 14,
m (corroborated by both) = 1 → Chapman N̂ = (6 × 15)/2 − 1 = **44**. Observed
19 ⇒ ~25 estimated remaining, so T1 does NOT terminate; the loop continues to
round 2 on this round's diff. (Noting the estimator's known low bias does not
apply here — it is telling us to keep going, and the two angles overlapped on
only ONE finding, i.e. they saturated nothing.)

## The one corroborated finding (both angles, independently)

**The e2e diagnostic I added could never pass.** It `fetch`ed a
`RequirePermissions<(RuntimeVersionRead,)>` endpoint from inside the page with
no `Authorization` header. ziee authenticates access tokens from that header
only (the refresh cookie is scoped `Path=/api/auth`), so it 401s, `catalog`
becomes `null`, and the block throws **unconditionally** — before the row
assertions, which I had claimed were "unchanged" and which were in fact now
unreachable. The failure message would then have blamed GitHub or the token:
precisely the misdiagnosis the block existed to prevent. This is a case of a
"diagnosability improvement" silently converting an acceptance test into a
permanent, misleading failure.

Fixed by forwarding `getCurrentUserToken(page)` (the pattern every other in-page
fetch in this suite uses), asserting the 200 explicitly with the body in the
message, and only treating **200-with-empty-list** as the diagnostic case.

## Correctness fixes

- **`403` no longer triggers the fallback — `401` only.** The audit showed the
  header rule could not work: `x-ratelimit-*` rides on nearly every GitHub
  response so a non-zero `remaining` does not mean "not a rate limit", and a
  secondary rate limit may arrive with **no** `retry-after`. Both gaps made a
  bare `403` classify as a rejection, which would spend the scarce anonymous
  budget AND tell an operator to replace a valid token. The only reliable
  discriminator for a `403` is the body's prose, which is not a contract and is
  the same brittleness class the design forbids for token shapes. So the rule is
  conservative and the asymmetry justifies it: NOT falling back on an exotic
  `403` leaves the pre-fix behaviour (no worse than today); falling back wrongly
  actively misleads. `is_auth_rejection` now takes only a status, and its doc
  states the reasoning. DEC-1 amended.
- **`CredentialStatus::Unverified` added.** The status was initialised to `Used`
  from `token.is_some()` and only ever downgraded, so a total outage reported
  "GitHub accepted your token — 5000/hour" about a request GitHub never
  answered. It now starts `Unverified` and is promoted to `Used` only after a
  real, non-rejecting response. Wire vocabulary is `absent|used|unverified|rejected`.
- **`ANONYMOUS_RETRY_LIMIT` made load-bearing.** It was dead: `authenticated`
  independently encoded "we have not fallen back yet", so deleting the constant
  changed nothing and no test could notice. `authenticated` is now DERIVED from
  it (`anonymous_retries < ANONYMOUS_RETRY_LIMIT`), giving one mechanism, and
  TEST-14 pins it. The worst-case request count (MAX_ATTEMPTS + 1 = 4) is now
  documented rather than implicit.
- **The credential verdict survives a transport failure.** Both failing-read
  sites replaced `result?` with an explicit `match`, so a rejection followed by
  a network failure on the anonymous re-issue still names `GITHUB_TOKEN` in the
  reason — the failure the doc says the operator most needs explained.

## Test fixes

- **ENV_LOCK.** The token-shape test mutated process-global `GITHUB_TOKEN`
  without taking the module's own `ENV_LOCK`, racing the two pre-existing
  env-mutating tests (and able to restore *their* temporary value permanently).
  Now takes it.
- **The hollow leg removed.** That test's leg (a) re-ran assertions its sibling
  already made and claimed a property the type signature already guaranteed. It
  now varies the process credential across five real GitHub token formats and
  observes the verdict does not move — a runtime observation that fails against
  any implementation reaching for the ambient token, which is the shape-check
  INV-3 forbids.
- **`RejectAll` (TEST-14).** The 401-to-both path was untested — the only path
  that (a) proves the fallback terminates and (b) reaches `failure_note()`'s
  interpolation with a `Rejected` credential. Without it, blanking BOTH call
  sites survived the whole suite. Now asserts 2 requests, the second carrying
  **no** Authorization header, and a reason that names `GITHUB_TOKEN` and the
  status but never the value.
- **`TransientThen200` (TEST-15).** No test made upstream fail transiently, so a
  revert of the restructured counter (`attempt` back to `0`) would underflow
  `2u64.pow(attempt - 1)` and PANIC in debug, invisibly. Also pins that a 5xx
  does not drop the credential.
- **`Unverified` (TEST-16).** A token present through a total outage. With
  TEST-3 (`used`), TEST-6 (`absent`) and TEST-4/14 (`rejected`), all four
  vocabulary values are now reachable and mutually distinguishable.
- **Bearer VALUE asserted.** The mock recorded only header presence, so sending
  a hardcoded literal instead of the configured token passed. It now records the
  value and TEST-3 asserts it equals the configured token.
- **`used` control on `/versions/available`.** That endpoint was asserted only
  for `"rejected"`, so hardcoding `"rejected"` in `binary_manager.rs` passed
  everything. TEST-3 now takes the `used` half on the same endpoint.
- **Flake removed.** "Upstream is down" was `abort()` + a bare 200 ms sleep. A
  `take_upstream_down` helper now polls until a direct connect is actually
  refused, so the outage is an observed fact.
- **The store wiring is tested — and this is where I found my own worst bug.**
  The `checkForUpdates.ts` mapping is the sole wire between the new backend
  field and the new UI branch, and nothing ran it (the component harness seeds
  the store directly). I wrote `checkForUpdates.credential.test.ts` — and the
  mutation it existed to kill still passed. The file name matched neither of
  `vitest.config.ts`'s include patterns (`src/**/*.store.test.ts`,
  `src/**/*.test.tsx`), so it was **silently never collected**. Renamed to
  `*.store.test.ts`; deleting the mapping now turns all three of its cases red
  (verified: `3 failed | 6 passed` mutated, `9 passed` restored).
- **The e2e now asserts the feature**, not just diagnoses failures: the
  credential verdict must be one of the four known values, and when it is
  `rejected` the list must be non-empty, `source` must be `live`, and
  `unavailable_reason` must be null — INV-1 on the real production path.
- **The rendered-vs-hidden reason.** Asserting the reason text is rendered
  turned RED and taught me something real: `ErrorState`'s `details` sits behind
  a collapsed "Details" disclosure, so the server's reason is NOT visible
  without interaction. The credential notice is therefore not redundant with it
  — it is the only unconditional statement of what to fix. The test now asserts
  exactly that (instruction visible, `401` not in the rendered text).

## Rejected

- **`release_cache.rs:164` (low, cache staleness).** A fixed credential keeps
  showing the notice for up to the TTL. Real, but **pre-existing cache
  semantics** that apply identically to `source`, `checked_at` and
  `unavailable_reason` — not introduced here, and a cache-bypass affordance is a
  separate change. Recorded as `rejected-out-of-scope`, not silently dropped.

**New confirmed findings:** 20
