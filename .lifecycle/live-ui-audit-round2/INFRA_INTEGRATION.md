# INFRA_INTEGRATION — live-ui-audit round 2

The three mandatory per-item walks (user-experience, infrastructure-integration,
entity-lifecycle), plus ITEM-3's measurement record.

---

## ITEM-1 — summary read-model trigger

**UX walk.** The user never sees this fetch. What they see is the in-thread
`SummaryBoundaryMarker` on the message at `summary.summarized_up_to_id`. The only
UX question that matters is: after a turn completes, does the marker move to the
right message? It does — the new trigger fires precisely at the streaming
true→false edge, which is when the server's `after_llm_call` hook has written.
The old trigger additionally fired 3 more times mid-turn, each returning the
PREVIOUS turn's summary, so the extra reads never improved what the user saw.

**Infra walk.**
- *chat pipeline* — `isStreaming` is owned by `sendMessage` (true) and
  `applyStreamFrame` (`started` → true, `complete`/`error`/abort → false), and
  `loadConversation` resets it to false. Every path that ends a turn therefore
  produces the edge; `stopStreaming` (user cancel) goes through the same
  `complete`/abort handling.
- *split panes* — the pill reads through the pane bridge, so each pane's own
  `isStreaming` drives its own pill. Pane A streaming does not re-read pane B's
  summary (the old `messages.size` trigger had the same property).
- *sync/SSE* — a turn started on ANOTHER device flips `isStreaming` on this one
  too, because `applyStreamFrame` handles `started`/`complete` frames for the
  conversation this device has open. So the cross-device refresh the old trigger
  provided via `messages.size` is preserved (TEST-1's last case pins it).
- *summarization settings* — unaffected; the mode PUT is a different endpoint
  and deliberately emits no sync event (documented in the pill).

**Entity-lifecycle walk.** The entity the pill holds is a conversation id.
- ADD (open/switch): `conversationId` changes while idle → one read.
- REMOVE (conversation deleted locally): `Chat.conversation` becomes null →
  effect runs → `ConversationSummarizationStore.clear()`; unchanged from before.
- REMOVE via SYNC (deleted on another device): same path — the chat store drops
  the conversation, `conversation?.id` → null → `clear()`.
- MUTATE: a new turn → the streaming edge → one read.
- ACCESS-LOSS: `loadConversation` sets `lastLoadErrorStatus` and clears the
  conversation → `clear()`. No stale summary survives.

---

## ITEM-4 — remove the per-turn `/api/memories` refetch

**UX walk.** The user's job is "see the facts the assistant remembered about me",
on `/memories` or `/settings/memory`. Before: a full list refetch after every
turn, whether or not that page existed. After: the page refreshes when the server
says something changed. A user watching `/memories` while chatting in another tab
still sees new facts appear — that is TEST-4, run live.

**Infra walk.**
- *chat pipeline* — `afterStreamComplete` is optional on `ChatExtension`; the
  aggregator iterates the extensions that declare it, so removing one cannot
  break the others (verified in `chat/core/extensions`).
- *sync* — `Memories.init` registers `on('sync:memory', reload)` +
  `on('sync:reconnect', reload)`; `load()` is self-gated on the same permission
  the endpoint enforces, so the no-403-on-reconnect rule still holds.
- *server* — `SyncEntity::Memory` is published from
  `memory/engine/extractor.rs` (3 sites: extract, update, delete) and
  `memory/reaper.rs`. Audience is owner-scoped. This is the same `after_llm_call`
  extraction the deleted hook was chasing.
- *store lifecycle* — the hook `import()`ed the store, which INSTANTIATED it
  (running `init`, its own `load()`, and registering its sync listeners) for
  users who never open the page. Removing the hook also removes that
  instantiation; the store now initialises when a surface actually reads it,
  which is the store-kit lazy contract.

**Entity-lifecycle walk.** Entity = a memory row. ADD/MUTATE/REMOVE all arrive as
`sync:memory` frames (the server publishes on all three), and the local mutation
path (`Memories.create/update/remove` on the page) already updates the store
directly. Bulk clear arrives as a nil-id Delete, which `load()` handles — noted
in the store's own comment.

---

## ITEM-5 — `/api/background/runs` off the compose path

**UX walk.** The job is "is my agent still working?", answered by a footer row
under the last turn. In a conversation the user just started by typing, the
answer is trivially "there are no tasks" — and the footer renders nothing either
way. The moment a turn spawns a sub-agent, the backbone emits
`sync:workflow_run` and the footer appears. So nothing the user can see changes;
one request per conversation-open disappears.

**Infra walk.**
- *sync* — `retainConversationScope` is called FIRST and unconditionally, so the
  store's `sync:workflow_run` handler still refreshes this scope. This is the
  load-bearing detail: the store's own comment explains the refcount (not the
  data map) is what the live refresh iterates, precisely so a scope whose first
  load failed — or, now, never ran — is still covered.
- *right panel* — `BackgroundRunsPanel` performs its own load when the Tasks tab
  is opened, so an explicit user request always fetches.
- *chat pipeline* — the marker is written from the `conversation.created`
  EventBus event that `sendMessage`/`createConversation` already emit; no new
  signal, no new emit site.
- *module system* — the subscription lives in the background module's
  `initialize()`. Ordering was checked against the real code:
  `initializeModules()` registers the EventBus core store in step 0 and runs
  module `initialize()`s in step 1, and `background` is a core module (no
  `shouldLoad`), so it is in wave 1 — well before any send. The two alternatives
  both lose the race: `sendMessage` emits `conversation.created` BEFORE it awaits
  the extension lifecycle, and the store is lazy (first instantiated by the
  footer, which mounts only after the conversation exists).

**Entity-lifecycle walk.** Entity = the session-created id set.
- ADD: on `conversation.created`.
- REMOVE: eviction past `SESSION_CREATED_CAP`, and implicitly on reload. Both
  degrade to "probe once", the pre-change behaviour.
- DELETE of the conversation itself: the id may linger in the set; harmless —
  the footer never mounts for a conversation that no longer exists, and a new
  conversation cannot reuse the uuid.
- ACCESS-LOSS: same as delete.

---

## ITEM-6 — send re-entrancy latch

**UX walk.** The reported job is "break the composer": two Enter presses in
quick succession — which real users also do on a slow network. Before: two
concurrent sends, a permanently spinning send button, and an orphan empty
assistant bubble; the conversation was unusable without a reload. After: exactly
one turn, and the composer re-enables when it ends.

**Infra walk.**
- *chat pipeline* — the latch wraps the whole action body, which resolves after
  `Message.send` returns (the reply streams separately), so it does not extend
  across the stream and legitimate back-to-back turns are unaffected.
- *extensions* — the `beforeSendMessage` veto contract is mirrored exactly: a
  quiet return only for `options.allowSilentCancel` (the user composer), a throw
  for programmatic callers (regenerate, edit-resubmit, tool-approval transmit)
  that have already mutated the transcript.
- *split panes* — the latch is a closure variable of the action factory, which
  runs per store INSTANCE, so pane A's send never blocks pane B's.
- *tool approval* — an approval transmit re-enters `sendMessage` only after the
  previous send has resolved (it is triggered by a UI action on a settled turn),
  so the latch is already released.

**Entity-lifecycle walk.** Entity = the in-flight send. It is created before the
first await and destroyed in `finally` — including on the abort path, the
extension-veto throw, and the `POST` failure path, all of which run the existing
`catch` and then the `finally`. There is no path that leaves it set.

---

## ITEM-3 — boot-waterfall measurement record

Measured on the branch rig (`http://127.0.0.1:1560` → backend `:29511`) with the
committed `.lifecycle/net-hygiene/boot-probe.mjs` (median of 3) and with
`reqfail-probe.mjs` (per-request failure reason + `requestStart` timing).

**Median of 3 cold boots of `/`:** `total=25`, `serial-chain-depth=6`,
`auth/me starts @38ms`, `shell-burst @167ms`.

**The single deepest chain the probe reported** was 3 requests / 176 ms:
`/api/auth/me → /api/app/setup/status → /api/onboarding/progress`.

**A representative full timeline** (`reqfail-probe`, ms from first request):

```
 185- 259  GET /api/sync/subscribe
 253- 262  GET /api/auth/me
 265- 271  GET /api/app/setup/status
 280- 284  GET /api/onboarding/progress
 597- 617  GET /api/server-update/status
 600- 617  GET /api/notifications
 617- 696  GET /api/llm-models/downloads
 617- 912  GET /api/conversations          (295 ms server-side)
 912-1005  GET /api/chat/stream, /api/mcp/defaults, /api/memory/*  (parallel burst)
1005-1030  GET /api/knowledge-bases, /assistants, /user-llm-providers, … (parallel burst)
```

### Classification

1. **The head of the chain is a DETECTOR ARTIFACT.** `/auth/me`, `/setup/status`
   and `/onboarding/progress` are issued ~11 ms apart and each completes in
   4–9 ms. The audit's waterfall rule is `start[i] >= end[i-1] - 20ms`, i.e. a
   20 ms slack that is LARGER than these requests' whole duration — so any burst
   of fast local requests reads as a "serial dependent chain". On the branch rig
   `/auth/me` and `/setup/status` are effectively simultaneous (overlap 0–1 ms),
   which is exactly the shape `.lifecycle/net-hygiene` ITEM-5 shipped. Nothing to
   remove here.
2. **The gaps between bursts are module-chunk delivery + execution**, not request
   dependencies (`280 → 597`, `696 → 912`). The lever that removes them —
   registering `ctx.isAuthenticated`-gated modules in wave 1 off a persisted
   token — is a **rejected design**: `.lifecycle/net-hygiene` ITEM-6 / DEC-15
   implemented it, three blind-audit angles found it widens the
   authenticated-tier trust boundary for a REVOKED-but-unexpired token, and
   re-measurement showed **no change to any metric it was meant to move**. A
   committed test (`loadContext.nochange.test.ts`) turns red on reintroduction.
   This round inherits that decision (DEC-3) rather than re-litigating it.
3. **Zero genuine request failures.** The earlier boot-probe run showed several
   `-1` rows; the failure-reason probe attributed the only reproducible one to
   `net::ERR_ABORTED` on `PUT /api/chat/stream/subscription` — the benign stream
   teardown the audit already mutes — and the rest did not recur. So the chain is
   not being lengthened by an abort+retry ladder.
4. **What IS genuinely reducible is the request COUNT in the measured windows**,
   which is what ITEM-1/4/5 do: fewer requests in a step means fewer candidates
   for a serial run. That is the mechanism by which the waterfall number moves in
   this round, and it is reported as such rather than claimed as a
   parallelisation win.

**Transport note (for whoever reads the raw numbers next):** the rig serves over
HTTP/1.1 (`nextHopProtocol: 'http/1.1'`), and a cold boot pulls ~1450 non-API
assets. The API requests were NOT stalled behind them — every one measured
`requestStart ≈ 0` — because the closure prefetch uses `<link rel="prefetch">`,
the browser's lowest priority. Worth knowing before attributing any future gap to
socket contention.
