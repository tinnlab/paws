# PLAN_AUDIT — sse-slot-leak, audited against the codebase

Audited at `60b0db310` (+ sdk `01a96b7`). Every claim below was checked by
reading the named file, not inferred.

## Breakage risk

- **ITEM-1 / ITEM-2 (eager `ConnGuard`)** — the guard TYPE and its `Drop` body
  are unchanged; only the construction site moves earlier and the value is moved
  into the generator. The generator is `async move` (async-stream's `stream!`
  expands to `AsyncStream::new(_, async move { … })`), so a captured `guard` is
  stored in the future's state and dropped when the future is dropped, polled or
  not. Verified against the measured repro: unpolled-drop leaked 5/5 slots today.
  No caller of `subscribe_sync` / `subscribe_chat_stream` observes a signature
  or response change.
  - *One ordering subtlety, checked*: the guard must be constructed only AFTER
    `register()` returns `Ok`. On the 429 path `register` never inserted, so a
    guard constructed earlier would `unregister` a `conn_id` that was never
    registered — harmless today (`remove` on a missing key is a no-op) but it
    would be a lie about ownership. The plan constructs it after the `?`.
- **ITEM-3 / ITEM-4 (`prune_closed*`)** — additive `pub fn` on each registry.
  `Sender::is_closed()` is true only once ALL receivers are dropped. Each
  connection's receiver is owned solely by its own stream generator, so
  `is_closed()` is an exact "the stream is gone" signal; it can never
  false-positive a live connection (checked: `rx` is created per-connection in
  the handler and moved into the stream; nothing else clones or holds it).
- **ITEM-5 (sweep inside `register`)** — changes cap-check TIMING, not cap
  VALUES. Risk considered: a sweep that ran on every register would be O(n) on
  the global map (n ≤ 512) under the registry mutex. Mitigation in the plan:
  sweep the per-user set first (O(≤24)); only sweep globally when the global cap
  would otherwise trip. Both are cheap, allocation-bounded, and inside the lock
  that `register` already takes — no new lock, no new ordering, no deadlock
  surface.
- **Existing tests** — `subscribe_test.rs`'s two HTTP cap tests hold their
  reqwest responses in a `held` Vec, so the new sweep cannot reclaim them and
  the caps still trip. **They need no edit** (verified: all 8 pre-existing
  `tests/sync/subscribe_test.rs` tests pass unmodified).
  - **CORRECTED IN PHASE 5 (DRIFT-1.1) — this bullet's original claim about the
    *unit* tests was WRONG.** `registry.rs`'s
    `per_user_cap_rejects_excess_connections` and
    `global_cap_rejects_excess_connections_across_users` (and their two chat
    twins) bind `let (c, _rx) = conn(..)` **inside the loop body**, so each
    receiver is dropped at the end of ITS OWN ITERATION — not at end of scope as
    this audit originally asserted. Those four tests were therefore registering
    connections whose streams were ALREADY GONE and relying on them counting
    toward the cap. Under ITEM-5 they correctly stop tripping the cap. Resolution
    (DRIFT-1.1, `impl-wins`): hold the receivers in a `Vec` so the tests assert
    what their names claim (a cap refuses the (cap+1)th LIVE connection). The
    caps' "live connection" semantics had never actually been under test.
  - *Caveat checked and genuinely unaffected*: `lagging_connection_is_pruned` and
    `deliver_session_to_users_prunes_a_lagging_connection` construct a
    capacity-1 channel and rely on `Full`-not-`Closed`; their `_rx` is bound in
    the enclosing scope, so `prune_closed` is inert for them.

## Pattern conformance

- **Guard** mirrors the established RAII cleanup types in-tree: `TempGuard`
  (`voice/model_handlers.rs:488`), `TerminalGuard` (chat stream generation slot).
  Keeping `ConnGuard`'s name/shape and only relocating its construction is the
  minimal-divergence choice.
- **Sweep** mirrors `deliver()`'s existing dead-connection handling exactly:
  collect `Vec<ConnId>` under the lock, then `remove_conn(&mut inner, cid)` for
  each — the single helper that maintains the `clients` + `by_user` two-index
  invariant (including dropping an emptied `by_user` entry). Reusing
  `remove_conn` rather than hand-rolling removal is what keeps the invariant.
- **Locking** keeps `lock().unwrap_or_else(|e| e.into_inner())` (poison
  recovery) — the module's universal idiom, and §6-compliant (no `unwrap()` on a
  runtime value).
- **Framework/app split** respected: `SyncRegistry` is generic over
  `Principal` and lives in `ziee-framework`; `ChatStreamRegistry` is app-owned in
  `src-app/server`. Each gets its own copy of the sweep; no new cross-crate
  dependency, no shared helper forced across the seam (they have different
  `ClientConn`/`ChatConn` shapes and different limits sources).
- **Tests** follow the three existing tiers verbatim: in-source `#[cfg(test)]`
  in both `registry.rs` files (13 + 12 existing tests), crate-scoped
  `sdk/crates/ziee-framework/tests/sync_routes.rs` (already mounts the real
  route via `tower::oneshot`), and `src-app/server/tests/{sync,chat}/` via
  `TestServer`.

## Migration collisions

**None.** No migration is added. Verified the branch's migration homes
(`sdk/crates/ziee-{auth,onboarding,seed,notification,file}/migrations`,
`src-app/desktop/tauri/migrations`) are untouched by every ITEM. A slot leak is
pure in-process state — nothing is persisted.

## OpenAPI regen

**Not required.** No handler signature, request/response type, route, status
code, or permission changes. `subscribe_sync_docs` / `subscribe_chat_stream_docs`
(which already document the 429) are untouched, so the generated
`openapi.json` + `api-client/types.ts` are byte-identical in BOTH workspaces.
Consequently this is NOT a frontend-touching diff and the phase-3/phase-8
frontend gates (e2e enumeration, `npm run check`, `gate:ui`) do not apply —
which is also why `src-app/ui/**` stays untouched as instructed.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — moves an existing guard's construction site; the
  `async move` capture semantics that make it work are confirmed by the measured
  repro (unpolled drop leaks today) and will be re-proven by TEST-4.
- **ITEM-2** — verdict: PASS — identical shape to ITEM-1 in the app-owned twin;
  `chat/stream/handler.rs:83-131` matches `routes.rs:207-249` line-for-line in
  structure.
- **ITEM-3** — verdict: PASS — additive; reuses `remove_conn`; `is_closed()`
  liveness is exact for this ownership model (single receiver, owned by the
  stream).
- **ITEM-4** — verdict: PASS — same, against `ChatStreamRegistry`'s
  `remove_conn`. Note the chat registry ALSO owns `generations` (per-conversation
  replay buffers) keyed by conversation, not connection — the sweep must not
  touch them, and does not.
- **ITEM-5** — verdict: CONCERN — behavior-timing change at the cap boundary.
  Resolved in-plan: cap VALUES unchanged, per-user sweep first (bounded by the
  per-user cap), global sweep only on the global-cap path. TEST-8 pins that 12
  LIVE connections still 429 the 13th, so the self-heal cannot mask a genuine cap.
- **ITEM-7** — verdict: CONCERN — adds a public field to `ClientConn` (an SDK
  type) and `ChatConn`, so every construction site must be updated; a
  wrongly-derived deadline could reap a healthy stream. Resolved in-plan: the
  only construction sites are the two subscribe handlers plus the two crates'
  own tests (verified by compiler exhaustiveness — a missing field is a hard
  error, not a silent default); the deadline is the SAME value the handler
  already `select!`s on, plus a 60s slack, so a healthy stream can only be
  reaped if it outlived its own guaranteed teardown; and `None` (no `exp`)
  opts out entirely. Pinned by TEST-14 (past-deadline reclaimed, future-deadline
  and no-deadline both survive) and TEST-15 (the slack window is respected).
- **ITEM-6** — verdict: PASS — a negative/regression item; pinned by TEST-8
  (caps), TEST-9 (no live connection ever pruned) and TEST-10 (owner-scoping +
  notify-only wire format still hold).

## Additional finding surfaced by the audit (folded into the plan)

The two `subscribe_test.rs` cap tests comment "Drop the held responses → closes
the 12 streams → ConnGuard unregisters each, leaving the process-wide registry
clean for sibling tests." That comment is **false today** for any response
whose body was never polled — i.e. these tests have been leaking into the
process-wide registry for sibling tests all along. The new integration tests
(TEST-6/TEST-7) assert reclamation explicitly rather than assuming it.
