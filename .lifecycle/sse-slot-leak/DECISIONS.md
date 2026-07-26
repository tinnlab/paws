# DECISIONS — sse-slot-leak

Every human/product input the implementation needs, resolved before writing
code. No item is left unresolved.

### DEC-1: Primary mechanism — RAII guard moved earlier, or an explicit unregister in the `select!` terminal arm?

**Resolution:** Keep the RAII `ConnGuard` and move its CONSTRUCTION into the
handler's `async fn` body (immediately after a successful `register()`), then
move the value into the `async_stream::stream!` generator. Do NOT replace it
with an explicit `unregister()` call in the loop's terminal arm.
**Basis:** convention — `agent-kit/docs/CODING_GUIDELINES.md` §5 says cleanup
must happen on *every* exit path and to "prefer a RAII guard". An explicit
unregister in the terminal arm covers only the paths that reach the loop at
all, which is precisely the set that is already working; the broken path
(generator dropped before its first poll) never reaches the loop. Moving the
guard covers both, and matches the in-tree `TempGuard`/`TerminalGuard` pattern.

### DEC-2: Is the eager guard constructed before or after `register()` may fail?

**Resolution:** After. `register()?` first; construct the guard only on `Ok`.
**Basis:** convention — the guard's contract is "I own a registered slot". On
the 429 path nothing was inserted, so owning a guard would be a false claim
(harmless today because removal of an absent key is a no-op, but it would
silently mislead the next reader).

### DEC-3: Liveness signal for the sweep — `Sender::is_closed()`, or a TTL / last-seen timestamp?

**Resolution:** `Sender::is_closed()`. No timestamps, no TTL.
**Basis:** codebase — each connection's `Receiver` is created in the handler and
moved into (and owned solely by) its own stream generator, so
`sender.is_closed()` is *exactly* "that stream no longer exists": zero false
positives, zero tuning. A TTL would need a value nobody can justify and would
risk killing a legitimately idle-but-live stream (the sync stream is idle by
design on a quiescent box — that is the very condition the bug was measured
under). `deliver()` already treats `Closed` as prune-worthy, so this reuses the
module's existing liveness semantics rather than inventing a second one.

### DEC-4: When does the sweep run — a background reaper task, or on demand?

**Resolution:** On demand, inside `register()`, before the cap checks. No
`tokio::spawn` loop, no timer.
**Basis:** convention — §5 requires every spawned loop to carry a `JoinHandle` +
a cancellation mechanism; adding that machinery buys nothing here, because the
ONLY user-visible consequence of a stale slot is a cap refusal, and the cap is
evaluated exclusively inside `register()`. Sweeping there makes the lockout
impossible by construction and self-heals on the very next connect attempt,
with no timer, no extra lock acquisition per tick, and no shutdown surface.
(Memory is not a second motive: a stale entry is one `Sender` + a principal
snapshot, and it is reclaimed on the next registration by anyone.)

### DEC-5: Sweep scope per `register()` call — global, per-user, or both?

**Resolution:** Both, each conditional on its own cap being about to trip — and
in the ORDER the pre-existing code used: **global first, then per-user**.
(Amended in FIX_ROUND-1: the first implementation put per-user first for cost
reasons, which silently changed which 429 error code a saturated deployment
returns. See DEC-15.) The common path still does no extra work at all, since
each sweep runs only when its cap would otherwise refuse.
**Basis:** convention — keeps the common path O(per-user cap) under a lock that
`register()` already holds, while still guaranteeing the global cap can never
be pinned by dead connections. Mirrors `deliver()`'s existing "collect dead,
then `remove_conn`" shape.

### DEC-6: Are the connection caps changed (raised / made configurable) as part of this fix?

**Resolution:** No. `GLOBAL_MAX_CONNECTIONS = 512`,
`PER_USER_MAX_CONNECTIONS = 12`, `SYNC_CHANNEL_CAPACITY = 1024` and the chat
registry's `ChatStreamLimits` defaults (24 / 512, channel 2048) are all
unchanged.
**Basis:** convention + INV-3. The reported failure is not "the cap is too
small" — it is "the cap is charged for connections that no longer exist".
Raising a cap would hide the leak and delay the lockout rather than remove it.
Note the *configurable-settings* rule is already satisfied on the chat side
(`ChatStreamLimits` is a deployment-config-driven struct per DEC-34 of the
chat-stream feature); this fix introduces NO new operational tunable of its own
— the sweep has no threshold, interval, or bound to configure (a direct
consequence of DEC-3 and DEC-4), so there is nothing here to promote to a
settings row.

### DEC-7: Does the sweep get a diagnostic/observability surface (log line, count endpoint)?

**Resolution:** No new HTTP surface, no new permission. `prune_closed*` returns
the number reclaimed (an in-process return value, already the shape of
`connection_count()`), and reclamation of a non-zero batch is recorded with a
`tracing::debug!`. Empirical verification measures free slots through the
existing 200/429 boundary on the real endpoint.
**Basis:** convention — adding a diagnostics endpoint would need a route, a
permission, an OpenAPI regen and a `[negative-perm]` e2e (which this
backend-only diff explicitly avoids), for information the cap boundary already
exposes exactly. `debug!` over `info!` matches the registry's existing silence
on the normal path.

### DEC-8: Does the fix apply to the other `async_stream::stream!` SSE handlers (hardware, downloads, voice, llm_local_runtime, code_sandbox)?

**Resolution:** No — out of scope, and verified not to be affected.
**Basis:** codebase — those handlers subscribe to unkeyed `tokio::broadcast`
channels with no per-user registry, no slot accounting and no cap, so a dropped
client consumes nothing that can run out. Only the two capped, per-user-keyed
registries (`SyncRegistry`, `ChatStreamRegistry`) can leak a slot.

### DEC-9: The fix spans the `sdk` submodule — how is that landed?

**Resolution:** Commit the SDK change on the pinned branch
`sdk/agent-core-and-perf` inside the submodule, and bump the submodule pointer
in the outer-repo commit. Both commits stay LOCAL (no push, per the task);
land-readiness notes that the SDK commit must be pushed before the outer merge
or the pointer dangles.
**Basis:** user instruction (no push) + codebase — the sync registry/handler
physically live in `ziee-framework`, so the fix cannot be made anywhere else.

### DEC-10: Are the two existing `subscribe_test.rs` cap tests edited?

**Resolution:** No. They are left byte-unchanged and must keep passing.
**Basis:** convention — they hold their responses alive in a `held` Vec, so the
new sweep cannot reclaim them and the caps still trip. Editing an existing test
to accommodate a fix is exactly the shared-harness anti-pattern (B3); TEST-13
pins that they pass unmodified.

### DEC-11: The closed-channel sweep cannot see a connection whose stream is alive but whose peer is gone. Fixed TTL, background reaper, or the connection's own `exp` deadline?

**Resolution:** None of them — do not reclaim on age at all. (This REVERSES the
original answer, which is preserved below for the audit trail; FIX_ROUND-1
showed it was wrong.) Reaping a past-deadline connection
whose stream is still alive frees the accounting slot while the stream future,
channel, task and socket survive, so the per-user cap stops bounding real
resources and a client can accumulate connections past it — strictly worse than
the leak, which failed closed. The case is already bounded: axum's keep-alive
writes eventually fail on a dead peer, hyper drops the body, and the guard
fires. The rejection is documented in both `prune_closed` doc comments.

*Superseded original resolution (kept for the audit trail):* the connection's
own `exp` deadline, swept at the cap boundary alongside the closed-channel
signal, with a fixed 60s slack.
**Basis:** codebase — both subscribe handlers ALREADY compute
`deadline = exp - now` and `select!` on it, so a connection still registered
well past that instant is definitionally broken. That makes the signal exact
(zero false positives: a healthy stream cannot outlive its own guaranteed
teardown) and, crucially, **not an operational tunable** — there is no
threshold an admin could get wrong, which is why the §-configurable-settings
rule does not force a settings row here (contrast a fixed "reap after N
minutes idle" TTL, which WOULD be an arbitrary tunable and would risk reaping a
healthy idle stream — the normal state of a sync connection on a quiet
deployment). A background reaper is still rejected for the DEC-4 reason: a
stale slot's only user-visible effect is a cap refusal, and caps are evaluated
only in `register`.

### DEC-12: The `exp` deadline is stored on `ClientConn` — a public SDK struct. Field, or a separate side-table?

**Resolution:** Moot — after FIX_ROUND-1 reversed DEC-11, no field is added at
all; `ClientConn` / `ChatConn` are unchanged, so the SDK's public struct keeps
its existing shape and no consumer breaks. The reasoning below applied only to
the reverted deadline backstop and is kept for the audit trail.

*Superseded original resolution:* a public `expires_at: Option<std::time::Instant>`
field on `ClientConn` (and `ChatConn`), not a parallel map.
**Basis:** convention — the registry's whole design is one authoritative
`HashMap<ConnId, Conn>` plus a `by_user` index, with `remove_conn` as the single
helper maintaining both. A third structure keyed by `ConnId` would add a fourth
invariant to keep in sync for no benefit. Adding a required field is a
compile-time break at every construction site (exactly 2 handlers + the crates'
own test helpers), which is the desired failure mode — a defaulted field could
silently leave new call sites opted out of the backstop. `None` is the explicit
opt-out for a token with no `exp`.

### DEC-13: The two registries now carry near-identical sweep logic across a crate boundary. Extract a shared generic, or accept the duplication?

**Resolution:** Accept it, deliberately. Do not extract.
**Basis:** convention — after FIX_ROUND-1 removed the deadline machinery, what
is duplicated is two ~12-line `is_closed()` sweeps over structurally different
types (`ClientConn<P>` behind a `Principal` bound vs a concrete `ChatConn` that
also owns per-conversation replay buffers) with different limit sources (private
consts vs a config-driven `ChatStreamLimits`). A generic extraction would put an
app-owned registry's internals behind an SDK trait to save ~24 lines, inverting
the framework/app split the module docs establish. The two registries were
already near-duplicates before this change for the same reason. Flagged `high`
by a blind auditor and consciously overruled — recorded here so it reads as a
decision, not an oversight.

### DEC-14: The chat handler's guard hoist cannot be tested behaviourally. Ship it untested, or add a structural (source-shape) test?

**Resolution:** A structural test, explicitly labelled as such, whose doc names
the behavioural proof it stands in for and states why one is not available here.
**Basis:** codebase + measurement — the never-polled path needs an unpolled
response body. `tower::oneshot` gives that in the framework crate, but the chat
handler needs a live DB-backed `TestServer` (so, real HTTP), and over real HTTP
hyper always polls the body while writing it — measured, not assumed: 400
concurrent abandoned raw sockets leak 0 slots. The alternatives were to ship the
hoist with no test at all (a blind auditor confirmed reverting `handler.rs`
alone left the entire chat suite green) or to ship a behavioural test that
passes either way, which is worse than none because it looks like proof. A
source-shape assertion is honest about being one and genuinely fails if someone
moves the guard back.

### DEC-15: Which cap is checked first, and does it matter?

**Resolution:** Global first, then per-user — preserving the pre-existing order.
**Basis:** convention + a blind-audit finding. Both caps surface 429, but with
DIFFERENT machine-readable error codes (`*_GLOBAL_LIMIT` vs `*_USER_LIMIT`), and
both are documented OpenAPI responses. Checking per-user first means a user who
is at their own cap on a globally-saturated deployment is told "too many
connections for this account" when the truth is "the deployment is out of
capacity" — masking a capacity incident as a per-account problem in logs and in
client error branching. The cost argument for per-user-first is moot because
each sweep is already gated on its own cap being about to trip.

### DEC-16: The chat handler's guard fix had no behavioural test. Ship a source-shape assertion, or refactor for testability?

**Resolution:** Refactor. `open_chat_stream(user_id, exp, token_ver)` is extracted
from `subscribe_chat_stream`, so the register → guard → stream construction can
be driven with no extractor, no HTTP and no database; the test calls it, drops
the returned `Sse` WITHOUT polling it, and asserts the slot was released.
**Basis:** B7 ("verification means RUNNING it") + a blind-audit finding. The
first attempt was a `include_str!` source-shape assertion, shipped because the
never-polled path is unreachable over real HTTP (measured). An auditor correctly
pushed back that the blocker was only the inlined construction, not anything
fundamental — and separately proved one of that test's two assertions was VACUOUS
(it matched its own error-message string literal). The extraction is a smaller,
stronger change than a string lint plus its apologia, and the resulting test is
verified red before the fix (`left: 1, right: 0`).
