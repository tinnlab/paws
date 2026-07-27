# FIX_ROUND-5 — final pre-merge go/no-go

A fifth blind agent (read-only) reviewed the post-round-4 diff and was asked for
an explicit merge verdict.

## Verdict: **GO** — "Nothing MUST change before this merges."

It attacked the three things most likely to be wrong and none broke:

- **The `for cid in dead` loop is correct in every reachable shape, and the count
  is honest.** `dead` membership requires `clients.get(cid).is_none_or(|c|
  c.sender.is_closed())`, so a live connection can never enter the loop. All
  shapes traced, including `HashSet` iteration-order variants of a mixed
  `{orphan, dead}` set: normal-dead (the follow-up `set.remove` is a no-op),
  orphan (repaired), cross-user-dead (both indexes cleaned). `n = dead.len()` is
  the number of cap slots actually freed, and `register` re-reads `user_count`
  from `by_user` afterwards rather than trusting it.
- **The HEAD non-vacuity anchor does what it claims** and leaves no state that
  could make the rest of the test pass: it holds `cap` genuinely-live GETs (each
  driven to a frame), so the 429 can only come from `register()`, then drops them
  and drains through a discarded settle pass.
- **No production regression.** `open_chat_stream` has no fallible operation
  after the guard is constructed, so the guard cannot exist on a path that
  inserted nothing; `ApiResult<T>` is `(StatusCode, T)`-shaped so the extraction
  is type-identical to the base; both sweeps are lazy so the common path is
  unchanged; the chat registry's `generations` replay buffers are untouched.

It also independently re-verified the two claims most likely to have been
hand-waved: the axum mechanism is **verbatim correct** for the vendored axum
0.8.9 (`method_routing.rs:1158` `call!(req, HEAD, get)`, then
`routing/route.rs:169-170` `*res.body_mut() = Body::empty();` inside
`RouteFuture::poll`), and the **sole-surviving-`Sender`** invariant holds in both
handlers (neither generator captures `tx`). It swept every other
`async_stream::stream!` site in the tree and confirmed none uses a capped
connection registry, so the two-registry scope of this fix is complete.

## The five low findings — all resolved

| Finding | Resolution |
|---|---|
| **One genuinely FALSE comment**: `sync_routes.rs` claimed "with the leak present the 13th subscribe trips `PER_USER_MAX_CONNECTIONS` and 429s". False as of this change — a stream dropped unpolled closes its channel, so `register`'s sweep reclaims the leaked entries and the (cap+1)th subscribe returns 200. The test IS still discriminating (via the final `connection_count() == 0`, which reads 8 for N=20/cap=12 with the guard reverted), but the comment misattributed why, and a reader could have deleted the load-bearing assert | comment rewritten to name the final count assertion as load-bearing, with an explicit "Do not delete it" |
| **"for every desync shape" was overstated** (both registries): an id in `by_user[A]` whose `clients` row is a LIVE connection of user B is filtered OUT of `dead` by design, so it would keep counting against A's cap. Unreachable today (one lock, two writers), but the claim was wrong | narrowed to "every shape that REACHES this loop", with the unreachable shape named explicitly and its unreachability justified |
| **The anchors asserted only `429`, not the error code** — a global-cap 429 would satisfy them vacuously | attempted the error-code assertion and it FAILED, which turned out to confirm the mechanism: a HEAD response carries no body, because axum already swapped it for `Body::empty()`. Restructured — the anchor now additionally issues a **GET** in the same state, whose body IS readable, and asserts `*_USER_LIMIT` there |
| `count_available_slots` returns on the first pair of equal readings with no trailing settle, so an unsettled pair could yield a low count; and the HEAD loop starts microseconds after `cap` sockets close, risking a spurious 429 on HEAD #1 under a misleading message | acknowledged as flake-rigor, not actioned. Mitigated in practice (an abandoned GET is reclaimed promptly — the server is mid-write) and the suite has now run green 8× consecutively including from a `cargo clean`ed tree. Recorded in the hand-off |
| helper duplication between the two integration test files | unchanged; recorded as follow-up (natural home is `ziee-test-harness`) |

## Verification after this round

- `ziee-framework --lib sync::` — **22 passed, 0 failed**
- `ziee-framework --test sync_routes` — **7 passed, 0 failed**
- `ziee --lib chat::stream::` — **17 passed, 0 failed**
- `ziee --test integration_tests sync:: chat::stream_slot_reclaim_test
  chat::chat_stream_test` — **32 passed, 0 failed**

## Convergence

Confirmed findings by round: **22 → 21 → 10 → 7 → 5**, with severity falling from
`high` (a security regression in the deadline reaper; half the fix untested; a
vacuous assertion guarding the only chat coverage) to five `low` items of which
four were comment accuracy and one was test rigor. Round 5 returned an explicit
**GO** and found nothing that changed shipped behaviour.

**New confirmed findings:** 0
