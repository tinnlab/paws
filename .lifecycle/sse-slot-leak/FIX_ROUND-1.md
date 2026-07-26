# FIX_ROUND-1 — resolving the phase-6 blind audit

Four blind subagents (diff-only context, no access to my reasoning) covered 14
angles. 22 confirmed findings, 4 explicit negatives, 1 confirmed-but-out-of-scope.
Every confirmed finding is resolved below.

## The headline finding — ITEM-7 (the deadline backstop) is REMOVED

Three of the four auditors independently converged on it, from different angles
(security, design-conformance, wired-and-behaving):

> The `expires_at` signal frees the **accounting slot** of a connection whose
> stream future, mpsc channel, tokio task and socket are all **still alive**. In
> exactly the black-holed-peer case it was written for, the stream is not being
> polled — which is *why* it outlived its own deadline — so dropping the registry
> entry does not tear anything down. The cap then bounds bookkeeping instead of
> real resources, so a client can accumulate server-side connections *past* the
> cap: a fail-closed DoS bound traded for unbounded growth.

And the claim justifying it was false:

> "neither signal can false-positive a healthy stream" is wrong — the deadline
> arm cannot fire while the generator is suspended at `yield` (a backpressured
> but perfectly healthy client) or inside the periodic re-check's DB `await`. A
> healthy-but-late stream is exactly what gets reaped.

**Resolution: ITEM-7 is removed entirely** — `expires_at`, `DEADLINE_SLACK`,
`is_past_deadline`, `is_reclaimable` and their 4 tests are gone from both
registries and both handlers. This is the right call rather than a patch:
DRIFT-1.3 added ITEM-7 on the reasoning that the closed-channel sweep could not
see a peer-gone-stream-alive connection. That reasoning was correct; the
conclusion was not. Reclaiming the *slot* without reclaiming the *stream* is
strictly worse than the bug, because the leak at least failed closed. That case
stays bounded the honest way: axum's keep-alive writes eventually fail on a dead
peer, hyper drops the body, and the guard fires.

The rejection is now DOCUMENTED IN THE CODE (a "Deliberately NOT reclaimed: a
connection that is merely OLD" section on both `prune_closed` doc comments) so
the next author does not re-derive the same wrong idea. PLAN's ITEM-7 is
rewritten from "add a deadline backstop" to "reject deadline/TTL reclamation and
record why"; TESTS-14/14b/15/15b are replaced accordingly. This also dissolved,
for free, four other findings that only existed because of ITEM-7: the
`Instant`-arithmetic panic paths, the `std` vs `tokio` clock mismatch, the
low-uptime `Instant::sub` panic in the tests, the unpinnable 60s magic number,
and the source-breaking public `expires_at` field on the SDK's `ClientConn`.

## The second headline finding — the chat handler's fix had no test

> Every red-before-fix test drove the **framework sync** handler. Reverting
> `chat/stream/handler.rs` alone left the entire chat suite green.

Verified true. The chat handler cannot be driven via `tower::oneshot` (it needs a
live DB-backed `TestServer`), and over real HTTP hyper always polls the body, so
the never-polled path is unreachable there — measured, not assumed: **400
concurrent abandoned raw sockets leak 0 slots**.

**Resolution:** added `conn_guard_is_constructed_outside_the_stream_generator`, a
STRUCTURAL regression guard that reads `handler.rs` and asserts the guard is
constructed before the `stream!` block and only moved in. It is explicitly
labelled a source-shape assertion, with a doc comment naming the framework tests
as the behavioural proof and explaining exactly why a behavioural test is not
available on this handler — rather than shipping a hollow behavioural test that
would pass either way.

## Remaining confirmed findings

| # | Finding | Resolution |
|---|---|---|
| Cap-check order swapped (3 angles) | a globally-saturated deployment reported `*_USER_LIMIT` instead of `*_GLOBAL_LIMIT`, masking a capacity incident | restored global-first ordering in BOTH registries; documented as contract ("cap-check ORDER is part of the contract"); pinned by the new chat `global_cap_counts_live_connections_only`, which asserts the `error_code()` |
| `the_cap_is_still_enforced_...` doc made 3 false claims | it never issued a request despite claiming "through the same real handler" / "bodies polled" / "per-surface pinned id" | rewritten to ACTUALLY drive the mounted handler via `app_of::<CapSurface>()`, polling each body to its handshake, asserting a refusal frees nothing, then that the whole allowance returns |
| `TestResolver` mints a fresh uuid per request | "N=20 > cap 12" was meaningless; the per-iteration 200 assertion was vacuous | added a `Bearer valid-fixed` identity; the abandon + exit-path + cap tests now pin ONE user, so the per-user cap is genuinely reachable and the in-loop assertion is real |
| HTTP tests raced async reclamation | `count_available_slots` ran immediately after a drop | now polls to a settled value with a 20s deadline |
| Caps hardcoded in 5 test sites | a cap change would silently desync the tests | both HTTP suites now DISCOVER the configured cap by probing the live endpoint (the number accepted before a 429 IS the cap); the framework crate test keeps one documented literal mirroring its private const |
| chat registry had no global-cap test | the new global sweep branch was uncovered | added `global_cap_counts_live_connections_only` (chat), mirroring the SDK twin, incl. the `CHAT_STREAM_GLOBAL_LIMIT` error-code assertion |
| `prune_closed*` shipped as dead `pub` SDK API (§15) | contradicted the rationale the diff itself wrote in the chat twin | both are now `#[cfg(test)]` in the framework too; the crate-level test was restructured to need neither |
| orphaned `remove_conn` doc comment (chat only) | the two mirrors diverged | doc restored to `remove_conn`; the sweeps carry their own |
| `expires_at` re-derived `secs_remaining` with a second `Utc::now()` | two divergent deadlines for one concept | dissolved with ITEM-7 |
| `register` doc claimed "the only other reaper is `deliver`'s" | `deliver_session_to_users` and `unregister` are also release paths | corrected in both registries |
| the sole-`Sender` invariant was undocumented | a future second `Sender` clone would turn a sweep into an orphaned zombie stream | added as an explicit "**Load-bearing invariant**" paragraph on both `prune_closed` docs |

## Explicitly rejected (false positives / verified negatives)

- **Guard-move soundness** — challenged and verified: `async_stream::stream!`
  builds its `async move` generator eagerly, so the captured guard drops with an
  unpolled future; the guard is constructed only after `register()` returns `Ok`,
  with no intervening `?` or `.await`. Empirically re-confirmed (0 → 20 leaked
  pre-fix, 0 → 0 post-fix).
- **Authorization / owner-scoping / audience routing** — byte-identical; the
  sweep is keyed on the authenticated `user_id`, never on client input; no
  cross-user eviction path.
- **HTTP/OpenAPI contract** — genuinely unchanged (no `openapi.json`, no
  `types.ts`, no `_docs` edits).
- **Sweep performance** — bounded and allocation-free on the common path.
- **Duplication between the two registries** (flagged `high`) — acknowledged and
  NOT unified. The duplicated surface shrank substantially with ITEM-7's removal
  (what remains is two ~12-line sweeps over structurally different
  `ClientConn<P>` / `ChatConn` types with different limit sources). A generic
  extraction would put an app-owned registry's internals behind an SDK trait for
  ~24 lines; recorded as a deliberate call, not an oversight.

## Out of scope, reported to the owner

`set_chat_stream_subscription` accepts `conn_id` verbatim from the client-supplied
`X-Chat-Stream-Connection-Id` header without verifying the connection belongs to
`auth.user.id`. **Pre-existing, not introduced or worsened here**, and
unexploitable in practice (a v4 uuid disclosed only to its own owner, and
delivery stays owner-keyed). Surfaced because it is a missing ownership check on
the same registry this change hardens.

## Re-audit

A full re-audit of the reduced diff found **0** new confirmed findings: ITEM-7 —
the source of every high/medium security and design-conformance finding — no
longer exists, the two test-coverage gaps are closed, and the remaining diff is
the guard hoist plus a closed-channel sweep, both of which the first round
explicitly verified as sound.

**New confirmed findings:** 0
