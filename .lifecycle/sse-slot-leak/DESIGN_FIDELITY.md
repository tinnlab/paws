# DESIGN_FIDELITY — does the plan uphold each design invariant?

One verdict per `INV-N` from `PLAN.md` § Invariants.

- **INV-1** — fidelity: UPHELD — "Unregister on ANY stream termination — client
  disconnect, exp, or deactivation. Drop runs even when the client vanishes
  mid-await." The comment already asserts this; the code does NOT honor it,
  because the guard is a local of a generator body that may never run
  (measured: 5/5 slots leaked when the response is dropped before its first
  poll). ITEM-1 + ITEM-2 make the claim TRUE by constructing the guard eagerly
  at registration and moving it into the generator, so "ANY termination"
  genuinely includes "terminated before the body was ever polled". ITEM-3/4/5
  add a second, independent reclamation path so the invariant survives a future
  refactor that loses the guard. Pinned by TEST-4 (handler level) and TEST-6 /
  TEST-7 (real HTTP endpoints).

- **INV-2** — fidelity: UPHELD — "has a matching cleanup on **every** exit path
  (success/error/timeout) — prefer a RAII guard." The plan keeps the RAII guard
  (does not replace it with an explicit unregister in the `select!` terminal
  arm, which would cover only the exit paths the author remembered) and closes
  the one exit path it did not cover: dropped-before-first-poll. TEST-11
  enumerates all three exit paths — dropped-before-poll, dropped-after-poll,
  normal `exp`-deadline end — and asserts reclamation on each, so the word
  "every" is machine-checked rather than asserted in prose.

- **INV-3** — fidelity: UPHELD — "Caps: 512 global / 12 per-user / 1024 bounded
  channel depth (a stalled reader is pruned → the client reconnects + resyncs)."
  No cap constant changes (`GLOBAL_MAX_CONNECTIONS = 512`,
  `PER_USER_MAX_CONNECTIONS = 12`, `SYNC_CHANNEL_CAPACITY = 1024`; chat's
  `ChatStreamLimits` default 24/512 + 2048 likewise). ITEM-5 only stops the caps
  being charged for connections that no longer exist — which is what "a stalled
  reader is pruned" already promises, generalized from "stalled" to "gone".
  ITEM-6 + TEST-8 pin that 12 genuinely LIVE connections still 429 the 13th, so
  the self-heal cannot silently become a cap raise. This is the invariant most
  at risk of being quietly reframed ("the fix is to raise the cap"); it is
  explicitly refused.

- **INV-4** — fidelity: UPHELD — "The wire payload is notify-and-refetch only —
  `{entity, action, id}`, never row data … Each emitting handler picks the
  `Audience` explicitly at the `publish(...)` call site." Nothing in the plan
  touches `SyncEvent`/`SyncSseEvent`, `publish`, any `Audience` selection, any
  emit site, or `deliver`'s routing match. The only registry mutation is
  REMOVAL of dead entries, which can change delivery only by not delivering to a
  connection that no longer exists. TEST-10 re-proves owner-scoping + the
  notify-only frame shape end-to-end after the change.

No invariant is AT-RISK or DROPPED.
