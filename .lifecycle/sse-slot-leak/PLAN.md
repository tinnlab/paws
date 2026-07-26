# sse-slot-leak — per-user SSE connection slots are never reclaimed on disconnect

Production-breaking backend bug. The per-user SSE connection cap (12 for
realtime-sync, 24 for the chat-token stream) is enforced against connections
that are already DEAD: a client that goes away is never unregistered, so every
reconnect burns a slot until the account is permanently `429`'d and chat stops
working for that user.

## Design source

This plan realizes the ALREADY-STATED contract of the two per-user SSE
connection registries; it introduces no new product behavior.

- Realizes the root `CLAUDE.md` § **Realtime Sync → Backend module →
  `registry.rs`** (the per-user keyed connection pool + its caps + its prune
  contract) and § **Realtime Sync → Backend module → `handlers.rs`** (the
  `tokio::select!` over {channel recv, 60s re-check, JWT `exp`}).
- Realizes `agent-kit/docs/CODING_GUIDELINES.md` § **5. Resource lifecycle,
  cleanup & orphans** (cleanup on every exit path; prefer a RAII guard) and
  § **6. Error handling** (no `unwrap`/`expect` on runtime values; never
  silently swallow).
- Realizes the in-code contract comments that state the intended behavior and
  are currently FALSE:
  `sdk/crates/ziee-framework/src/sync/routes.rs:208-211` and
  `src-app/server/src/modules/chat/stream/handler.rs:84`.

## Invariants

Lifted VERBATIM from the sources named above.

- **INV-1**: "Unregister on ANY stream termination — client disconnect, exp, or
  deactivation. Drop runs even when the client vanishes mid-await (axum drops
  the stream future on disconnect)."
  *(verbatim, `sdk/crates/ziee-framework/src/sync/routes.rs:208-211`; the chat
  twin at `chat/stream/handler.rs:84` says "Unregister on ANY termination —
  disconnect, exp, or deactivation.")*
- **INV-2**: "has a matching cleanup on **every** exit path
  (success/error/timeout) — prefer a RAII guard."
  *(verbatim, `agent-kit/docs/CODING_GUIDELINES.md` §5)*
- **INV-3**: "Caps: `512` global / `12` per-user / `1024` bounded channel depth
  (a stalled reader is pruned → the client reconnects + resyncs)."
  *(verbatim, root `CLAUDE.md` § Realtime Sync → `registry.rs`)*
- **INV-4**: "The wire payload is **notify-and-refetch only** — `{entity,
  action, id}`, never row data … Each emitting handler picks the `Audience`
  explicitly at the `publish(...)` call site."
  *(verbatim, root `CLAUDE.md` § Realtime Sync)*

## Root cause (measured, not inferred)

`register()` runs EAGERLY in the handler's `async fn` body, but the
`ConnGuard` whose `Drop` calls `unregister()` is declared as a **local of the
`async_stream::stream!` generator body**. That body does not execute until the
stream's FIRST poll. Any client that goes away before the response body is
first polled leaves a registration with **no guard ever constructed** → the
slot is held forever.

The registry's only other reaper is `deliver()`'s send-failure prune, which
runs solely when there is an event to deliver — so on a quiescent box (the
reported measurement conditions) nothing ever reclaims the slot.

Measured with a scratch repro against the real mounted `sync_routes` handler
(`ziee-framework`, `tower::oneshot`, 5 subscribes):

| scenario | `connection_count` before → after |
|---|---|
| response dropped BEFORE first body poll | **0 → 5** (every slot leaked) |
| response dropped AFTER first body poll | 0 → 0 (guard fires) |

**Measured limit of that mechanism (added in DRIFT-1, phase 5).** Driving the
UNFIXED server through real hyper, the never-polled window is not reachable:
100 sequential and 400 concurrent raw-socket "write the request then vanish"
clients leaked **0** slots, because hyper always polls the response body while
writing it. So the never-polled hole is real and deterministic at the handler /
tower level, but it does NOT by itself explain the reported production 429s.
The mechanism the bug report names —

> an SSE client going away doesn't necessarily error a send until something is
> pushed, so an idle-but-dead connection holds its slot indefinitely

— is a connection whose server-side stream is STILL ALIVE (so
`sender.is_closed()` is false and the guard has not fired) because hyper never
discovered the peer was gone. ITEM-7 records the conclusion reached about that
case: it must NOT be reclaimed by a deadline or TTL (doing so frees the
accounting slot while the socket survives, so the cap stops bounding real
resources), and it is already bounded by axum's keep-alive writes failing on a
dead peer. See FIX_ROUND-1.

Both per-user SSE registries have the identical shape and therefore the
identical bug:
- `sdk/crates/ziee-framework/src/sync/routes.rs` (`/api/sync/subscribe`, cap 12)
- `src-app/server/src/modules/chat/stream/handler.rs` (`/api/chat/stream`, cap 24)

**Correction (FIX_ROUND-2, from a blind auditor).** The original survey claimed
the other `async_stream::stream!` SSE handlers "use unkeyed `tokio::broadcast`
with no slot accounting and no cap". That is FALSE for `hardware`, which uses a
KEYED pool with a hard cap (`ziee-hardware/src/monitoring.rs`,
`MAX_SSE_CLIENTS = 256`, `add_client` → 503 at capacity) and releases its slot
with `remove_client(...)` as the LAST STATEMENT INSIDE its generator body — the
exact anti-pattern this feature removes, unreachable on the disconnect path.
It is masked (not fixed) by `broadcast_usage_update` pruning failed senders every
monitoring tick, so it self-heals within seconds and is not the reported bug.
**Left untouched deliberately** — it is a different module with its own owner and
no reported symptom, and widening this fix into it would balloon the diff. It is
called out in the hand-off so it is not lost. `voice`, `llm_local_runtime`,
`llm_model` downloads and `code_sandbox` were re-checked and are genuinely
broadcast-based without a per-user slot cap.

## Items

- **ITEM-1**: Make realtime-sync slot release DETERMINISTIC: construct the
  `ConnGuard` in `subscribe_sync`'s `async fn` body immediately after a
  successful `register()`, and MOVE it into the `async_stream::stream!` body.
  A generator dropped before its first poll then still drops the captured guard
  → `unregister()` runs. (`sdk/.../sync/routes.rs`)
- **ITEM-2**: Same eager-guard fix for the chat-token stream handler
  (`src-app/server/src/modules/chat/stream/handler.rs`).
- **ITEM-3**: Liveness sweep on `SyncRegistry`: `prune_closed()` (global) +
  `prune_closed_for_user(user_id)` remove every connection whose `sender`
  reports `is_closed()` — the receiver lives inside the stream, so a closed
  sender is an exact "this stream is gone" signal and can never false-positive a
  live connection. Backstop for any future path that loses the guard.
- **ITEM-4**: Same `prune_closed()` / `prune_closed_for_user()` on
  `ChatStreamRegistry`.
- **ITEM-5**: Self-heal at the cap boundary: `register()` on BOTH registries
  sweeps dead connections BEFORE evaluating the global / per-user cap, so a cap
  is never enforced against dead connections and a user can never be
  permanently locked out. Cap VALUES are unchanged.
- **ITEM-7**: **Reject** deadline/TTL-based reclamation, and record why in the
  code. (Added in DRIFT-1.3 as "add a deadline backstop"; REVERSED in
  FIX_ROUND-1 after three independent blind auditors converged on it.) Reaping a
  connection because it is merely OLD frees the accounting slot while the stream
  future, channel, tokio task and socket all stay alive — in exactly the
  black-holed-peer case it targets, the stream is not being polled, which is WHY
  it outlived its deadline, so nothing tears it down. The cap would then bound
  bookkeeping instead of real resources, letting a client accumulate connections
  PAST the cap: strictly worse than the leak, which at least failed closed. A
  backpressured-but-healthy stream (suspended at `yield`, or inside the periodic
  re-check's DB `await`) is also past-deadline and would be reaped. The
  deliverable is therefore the NEGATIVE: the sole sweep signal is
  `sender.is_closed()`, and both `prune_closed` doc comments carry a
  "Deliberately NOT reclaimed: a connection that is merely OLD" rationale so the
  next author does not re-derive the same wrong idea. The peer-gone-stream-alive
  case stays bounded the honest way — axum's keep-alive writes eventually fail
  on a dead peer, hyper drops the body, and the guard fires.
- **ITEM-6**: Preserve existing behavior verbatim — cap values (512/12/1024,
  chat 24/512/2048), owner-scoping, the `{entity, action, id}` notify-only wire
  format, self-echo suppression, the exp-deadline + re-check `select!` arms, and
  the poison-recovering mutex. A prune failure must never kill a stream: the
  sweep is infallible (no `unwrap`/`expect` on runtime values, no fallible I/O)
  and lives entirely inside the already-poison-recovering lock.

## Files to touch

- `sdk/crates/ziee-framework/src/sync/routes.rs` — eager `ConnGuard` (ITEM-1)
- `sdk/crates/ziee-framework/src/sync/registry.rs` — `prune_closed*` + register
  self-heal + unit tests (ITEM-3, ITEM-5, ITEM-6)
- `sdk/crates/ziee-framework/tests/sync_routes.rs` — handler-level leak tests
- `src-app/server/src/modules/chat/stream/handler.rs` — eager `ConnGuard` (ITEM-2)
- `src-app/server/src/modules/chat/stream/registry.rs` — `prune_closed*` +
  register self-heal + unit tests (ITEM-4, ITEM-5)
- `src-app/server/tests/sync/subscribe_test.rs` — reconnect-storm integration test
- `src-app/server/tests/chat/` — chat-stream reconnect-storm integration test
- `sdk` submodule pointer bump in the outer repo

No migration, no OpenAPI/type change, and no frontend change at all — neither
UI workspace is touched (other agents own those files right now). See BASE.md
for the explicit frontend exclusion.

## Patterns to follow

- **RAII connection guard**: the existing `ConnGuard` in both handlers — keep
  the type and its `Drop`; only its CONSTRUCTION SITE moves (into the `async fn`
  body, then moved into the stream). Mirrors the codebase's other
  "guard owns the cleanup" types (`TempGuard` in `voice/model_handlers.rs`,
  `TerminalGuard` in `chat/stream`).
- **Registry sweep**: mirror the existing `remove_conn(&mut inner, cid)` helper
  and `deliver()`'s dead-connection collect-then-remove shape in both
  registries — same two-index (`clients` + `by_user`) invariant, same
  `lock().unwrap_or_else(|e| e.into_inner())` poison recovery.
- **Framework/app split**: the sync registry + subscribe handler live in
  `ziee-framework` (generic over `Principal`); the chat-stream twin is
  app-owned. Fix each in its own home; do not cross-import.
- **Test tiers**: in-source `#[cfg(test)]` for registry logic
  (`registry.rs` already has 13 such tests), crate-scoped
  `sdk/crates/ziee-framework/tests/sync_routes.rs` for the mounted handler, and
  `src-app/server/tests/sync|chat/` for the real HTTP path via `TestServer`.
