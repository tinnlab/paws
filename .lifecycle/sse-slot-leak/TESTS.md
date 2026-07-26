# TESTS — sse-slot-leak

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (not merely what the code happens to do).

No `tier: e2e` tests are enumerated: the diff is backend + SDK only
(`src-app/ui/**` and `src-app/desktop/ui/**` are untouched, no OpenAPI/type
regen — see PLAN_AUDIT § OpenAPI regen), so the frontend e2e gate does not
apply. No permission is introduced, so no `[negative-perm]` spec applies.

## Registry unit tests (tier: unit)

- **TEST-1** (tier: unit) [covers: ITEM-3] file: `sdk/crates/ziee-framework/src/sync/registry.rs` — asserts: after a connection's receiver is dropped, `prune_closed()` removes it from BOTH indexes — `connection_count()` goes 1 → 0 and a subsequent `Owner` delivery to that user is a harmless no-op (the `by_user` entry was cleaned up too).
- **TEST-2** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-5, ITEM-6] file: `sdk/crates/ziee-framework/src/sync/registry.rs` — asserts: the cap is charged for LIVE connections only. With `PER_USER_MAX_CONNECTIONS` receivers ALIVE the (cap+1)th `register` is still refused with 429 (cap value unchanged, self-heal cannot become a cap raise); with the same number of receivers DROPPED the next `register` succeeds and `connection_count()` equals 1. Both halves in one test so a regression that raises the cap fails the first half and a regression that removes the sweep fails the second.
- **TEST-2b** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-5, ITEM-6] file: `sdk/crates/ziee-framework/src/sync/registry.rs` — asserts: the GLOBAL cap likewise counts live connections only — a registry full of LIVE connections still refuses the next one with 429, while a registry full of DEAD ones does not lock the whole deployment out.
- **TEST-3b** (tier: unit) [covers: ITEM-4, ITEM-3] file: `src-app/server/src/modules/chat/stream/registry.rs` — asserts: the chat twin of TEST-3 — a user-scoped sweep reclaims only that user's dead connection; another user's dead connection survives it and is reclaimed by a subsequent global sweep.
- **TEST-3c** (tier: unit) [covers: ITEM-6] file: `src-app/server/src/modules/chat/stream/registry.rs` — asserts: the chat twin of TEST-9 — a sweep never reclaims a live connection, and the survivor still receives published frames (functional, not merely counted).
- **TEST-3** (tier: unit) [covers: ITEM-3, ITEM-5] file: `sdk/crates/ziee-framework/src/sync/registry.rs` — asserts: `prune_closed_for_user()` removes ONLY the target user's dead connections — user B's dead connection and user A's LIVE connection both survive a sweep scoped to user A.
- **TEST-9** (tier: unit) [covers: ITEM-6] file: `sdk/crates/ziee-framework/src/sync/registry.rs` — asserts: a sweep NEVER removes a live connection — with all receivers held open, `prune_closed()` returns 0 and `connection_count()` is unchanged, and the connection still receives a subsequent delivery (proving it was left functional, not merely counted).
- **TEST-5** (tier: unit) [covers: ITEM-4] file: `src-app/server/src/modules/chat/stream/registry.rs` — asserts: the chat-token registry twin — dropping a receiver then `prune_closed()` removes it from `clients` + `by_user`, while a live connection survives; and the per-conversation `generations` replay buffers are NOT disturbed by a sweep.
- **TEST-12** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-4, ITEM-5, ITEM-6] file: `src-app/server/src/modules/chat/stream/registry.rs` — asserts: the chat twin of TEST-2 against the CONFIGURED `ChatStreamLimits` (not a hardcoded 24): at the configured per-user cap with live receivers the next `register` is refused 429; with those receivers dropped it succeeds.

## Mounted-handler tests (tier: unit — crate-scoped, real router via `tower::oneshot`)

- **TEST-4** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1] file: `sdk/crates/ziee-framework/tests/sync_routes.rs` — asserts: the design's promise "unregister on ANY stream termination … even when the client vanishes mid-await". Drives the REAL mounted `sync_routes` handler N times, dropping each 200 response **without ever polling its body** (the exact measured leak: 0 → 5 today), and asserts `connection_count()` returns to its pre-loop value. This test fails if the invariant is violated — it is not a restatement of the implementation, because it exercises the one termination path the current guard placement cannot see.
- **TEST-11** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-6] file: `sdk/crates/ziee-framework/tests/sync_routes.rs` — asserts: "cleanup on **every** exit path" is literally every path — the SAME assertion (`connection_count()` returns to baseline) is applied to all three terminations in one test: (a) response dropped before the first body poll, (b) response dropped after the first body poll, (c) the stream ending on its own via the past-`exp` deadline. A fix that covers only one path fails the other legs.

## Real-HTTP integration tests (tier: integration)

- **TEST-6** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-3, ITEM-5] file: `src-app/server/tests/sync/subscribe_test.rs` — asserts: end-to-end through the real `GET /api/sync/subscribe`, a reconnect storm never locks the account out. One user opens and ABANDONS 20 sequential connections (> the per-user cap of 12); every one must return 200 (no 429 mid-storm), and afterwards the user can still open a FULL set of 12 concurrent streams — i.e. all 20 abandoned slots were reclaimed, not merely one. **Honest scope (DRIFT-1.2): this test passes both before and after the fix** — hyper always polls the response body, so the never-polled hole is not reachable through its HTTP/1.1 path (measured: 400 concurrent raw-socket abandons leak 0). It is a real end-to-end guarantee of the DoD symptom, not a red-before-fix proof; TEST-4 is the red-before-fix proof (0 -> 20 leaked).
- **TEST-7** (tier: integration) [covers: ITEM-2, ITEM-4, ITEM-5] file: `src-app/server/tests/chat/stream_slot_reclaim_test.rs` — asserts: the same reconnect-storm reclamation through the real `GET /api/chat/stream` (the endpoint the bug report measured as 429 for `admin`), sized above its configured per-user cap; the user can still open a full set of concurrent chat streams afterwards. Same honest scope caveat as TEST-6.
- **TEST-8** (tier: integration) [acceptance] [invariant: INV-3] [covers: ITEM-5, ITEM-6] file: `src-app/server/tests/sync/subscribe_test.rs` — asserts: the cap is still REAL through HTTP after the fix — 12 concurrently-held (alive, body-polled) `/api/sync/subscribe` streams still cause the 13th to be refused `429 SYNC_USER_LIMIT`. This is the guard against "fix the leak by weakening the cap"; it must pass both before and after.
- **TEST-10** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-6] file: `src-app/server/tests/sync/subscribe_test.rs` — asserts: owner-scoping and the notify-only wire format are untouched by the registry change — after a reclamation storm on the same user, a mutation still delivers exactly one `{entity, action, id}` frame to the OWNER's live stream and no row data, and a second user's stream receives nothing.

## Static / build gates

- **TEST-13** (tier: unit) [covers: ITEM-1, ITEM-2, ITEM-3, ITEM-4, ITEM-5, ITEM-6] file: `src-app/server/src/modules/chat/stream/handler.rs` — asserts: no existing behavior was edited to make the new tests green — `cargo check -p ziee --tests` and `cargo check -p ziee-framework --tests` are clean, and the pre-existing `modules::sync` + chat-stream registry unit suites plus the whole pre-existing `tests/sync/` integration suite still pass with their assertions unmodified.

## Deadline staleness backstop (ITEM-7)

Covers the mechanism the bug report actually names — a peer that vanished
WITHOUT the socket erroring, so the server-side stream is still alive, the
guard has not fired, and `sender.is_closed()` is false. Only the connection's
own `exp` deadline can distinguish it.

- **TEST-14** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-7] file: `sdk/crates/ziee-framework/src/sync/registry.rs` — asserts: with EVERY receiver still held open (so the closed-channel signal is false for all of them), a sweep reclaims EXACTLY the connection that is past its own `exp` deadline, while a connection whose deadline is in the future and one with no deadline at all both survive. This is the leg that proves "unregister on ANY termination" extends to the termination the socket never reported.
- **TEST-14b** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/modules/chat/stream/registry.rs` — asserts: the chat-token twin of TEST-14 — past-deadline reclaimed, future-deadline and no-deadline survive, all with live receivers.
- **TEST-15** (tier: unit) [covers: ITEM-7, ITEM-6] file: `sdk/crates/ziee-framework/src/sync/registry.rs` — asserts: the slack window is respected — a connection whose deadline lapsed only a second ago is NOT reclaimed, so a normally-terminating stream is never raced by the sweep.
- **TEST-15b** (tier: unit) [covers: ITEM-7, ITEM-6] file: `src-app/server/src/modules/chat/stream/registry.rs` — asserts: the chat-token twin of TEST-15.
