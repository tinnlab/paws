# DECISIONS — live-ui-audit round 2

Every human/product input the implementation needs, resolved up front. Nothing is
left unresolved.

### DEC-1: What is the correct trigger for the conversation-summary read-model?
**Resolution:** conversation-change **plus** the streaming `true → false` edge —
never message count. Implemented as a pure predicate
(`shouldReloadSummary(prev, next)`) so it is unit-testable outside React, with
the effect in `SummarizationStatusPill` (the trigger stays in that component, as
its own doc-comment demands).
**Basis:** codebase — the server writes the summary in its `after_llm_call` hook
(`server/src/modules/summarization/chat_extension`), which is exactly the moment
the client's stream ends. Message count is a proxy that fires 3–4× per turn for
one server-side write.

### DEC-2: Should the in-flight GET coalescer be extended to cover the summary storm?
**Resolution:** No. Document why at the call site and leave `inflight.ts`
untouched.
**Basis:** codebase — `inflight.ts` is explicitly "a de-duplicator, deliberately
NOT a cache: an entry exists only while its request is unsettled". The four
summary GETs are SEQUENTIAL (each is triggered by the previous response
landing), so there is never a second caller while one is in flight; and the
intervening `POST …/messages` calls `bumpFetchEpoch()`, which by design makes any
surviving entry unjoinable. Making it cover this would mean turning the
de-duplicator into a cache — reopening the staleness class its header says it was
built to avoid.

### DEC-3: Do we parallelise the rest of the boot chain by deriving `isAuthenticated` from the persisted token?
**Resolution:** **No — inherit the existing CUT.** ITEM-3 becomes measurement +
classification with no change to `loadContext.ts` / `loader.ts`.
**Basis:** codebase — `.lifecycle/net-hygiene` ITEM-6 / DEC-15 implemented exactly
this, three blind-audit angles (security ×2, design-conformance) found it widens
the authenticated-tier trust boundary for a REVOKED-but-unexpired token (modules
are never unloaded, so a later failed verification cannot undo it), it
contradicts `bootSessionVerify.desktop.ts`'s own reasoning, and re-measurement
showed **no change to any metric it was meant to move**. A committed guard test
(`loadContext.nochange.test.ts`) turns red on reintroduction. Re-litigating a
decision that was made on measurement plus three security findings is not a
judgement call this round gets to make alone.

### DEC-4: `/api/memories` per turn — delete the hook, or debounce it?
**Resolution:** Delete it.
**Basis:** convention + codebase — the `Memories` store's `init` already does
`on('sync:memory', reload)` + `on('sync:reconnect', reload)` and the server
publishes `SyncEntity::Memory` from `memory/engine/extractor.rs` (three sites)
and `memory/reaper.rs`. `CLAUDE.md` §Realtime Sync makes notify-and-refetch THE
freshness contract; an extra eager refetch beside it is duplication, and the
hook's own comment already concedes "the `sync:memory` event subscription handles
eventual consistency".

### DEC-5: How is "this conversation was created in this session" known, and where does it live?
**Resolution:** A tiny module-level, bounded `Set<string>` in the background
module (`sessionCreatedConversations.ts`), written from the `conversation.created`
EventBus event the background chat-extension already can observe, read by
`BackgroundRunsFooter` to skip its probe. Bounded (cap + oldest-eviction) so a
long session cannot grow it without limit. NOT store state — nothing renders it,
mirroring `BackgroundRuns.store`'s own module-local `inFlight` guard rationale.
**Basis:** codebase — `EventBus.emit({type:'conversation.created'})` is already
fired by `Chat.sendMessage` for exactly this moment, and `NewChatPage` already
consumes it, so no new signal is invented.

### DEC-6: Do we fix the 2× `memory-mode` / `summarization-mode` reads? (ITEM-10)
**Resolution:** DESCOPE this round.
**Basis:** codebase + measurement — the double read is the composer genuinely
REMOUNTING across the `/` → `/chat/{id}` navigation (`NewChatPage` and
`ConversationPage` each render their own `<ChatInput/>`, so both toolbar pills
mount twice). Collapsing it needs a cross-conversation mode cache, which would
introduce staleness the current code deliberately avoids (both endpoints
intentionally have NO sync subscription — see the pill's own comment). Two small
GETs is a worse trade than a new staleness class.

### DEC-7: Do we fix the 2–4× `GET /api/conversations` per `(load)` step? (ITEM-11)
**Resolution:** DESCOPE this round.
**Basis:** measurement — on the boot probe the repeats are the notify-and-refetch
contract working (`sync:conversation` → `syncRecentFront`) plus the history
surface's own load, each already guarded by `recentLoading`/`recentLoadingMore`.
Suppressing them means suppressing sync-driven refresh, which INV-2 forbids.

### DEC-8: Do we chase `control-collision` / `palette-drift` / `spacing-grid`? (ITEM-12)
**Resolution:** DESCOPE this round.
**Basis:** convention + the brief — `control-collision` is documented LOW "with
known false-positive pressure … do NOT chase it unless clearly real";
`palette-drift` on the accent swatches is the deliberate `data-allow-custom-color`
opt-out round 1 shipped (its DEC-7) — a swatch IS genuinely dynamic colour;
`spacing-grid` is documented in the SKILL as "LOW (informational) …
drift-tracking, never gating".

### DEC-9: Is the audit script itself tuned to stop flagging the sr-only skip link?
**Resolution:** No. `agent-kit` stays byte-identical; the disposition is recorded
here and proven by TEST-8 instead.
**Basis:** convention — INV-1 requires BEFORE and AFTER be scored by the same
code, and editing the detector mid-measurement would make the before→after
numbers meaningless. (A carve-out for visually-hidden bypass links is a
reasonable future tuning for the skill, and is recorded as such in
TEST_RESULTS.md — but it belongs in an `agent-kit` change of its own, not inside
a measurement run.)

### DEC-10: Re-entrancy on `sendMessage` — throw or return quietly?
**Resolution:** Return quietly ONLY for the user-composer path
(`options.allowSilentCancel`); THROW for every programmatic caller.
**Basis:** codebase — this is the contract the same function already documents
for an extension veto: "most callers of `sendMessage` are PROGRAMMATIC
(regenerate, edit-resubmit, transmitting a tool approval/denial) and for them a
veto is a genuine failure that must not evaporate … Only a USER-INITIATED
composer submit opts into the quiet path". A concurrent send is the same class of
event, so it gets the same treatment.

### DEC-11: Is any operational tunable introduced, and is it fixed or admin-configurable?
**Resolution:** One: `SESSION_CREATED_CAP`, the bound on DEC-5's session set.
Fixed named constant, not an admin setting.
**Basis:** convention — it is a memory-safety bound on an in-tab, per-session Set
with no operator-visible behaviour (exceeding it only means an old conversation
re-probes once, which is the pre-change behaviour), exactly like
`PANEL_PAGE_SIZE` in `BackgroundRuns.store` ("a named constant, not an inline
literal, so it can be promoted to a setting later without a rewrite"). No other
limit, retention, quota, threshold or toggle is added by this round.

### DEC-12: Which rig do the before/after numbers come from?
**Resolution:** A branch-local rig isolated from the 24/7 rig: backend `:29511`
with rate limiting disabled, database `ziee_liveaudit` = a `pg_dump` clone of the
24/7 rig's database, static server `:1560` (a copy of `rig-serve.mjs` with its
client-disconnect upstream teardown intact), audit script = the unmodified copy
in the main checkout's `agent-kit`.
**Basis:** user instruction (stand up your OWN rig on unique ports, rate limiting
disabled, do not touch `:1520`/`:29500`) + INV-1. Cloning the database rather
than seeding a fresh one keeps the fixtures — 1118 conversations, the Qwen
provider — identical to the run that produced the findings.

## Descope dispositions

- DESCOPED: ITEM-10 — the 2× per-conversation mode reads are a genuine composer remount across the `/` → `/chat/{id}` navigation; collapsing them needs a cache that reintroduces the staleness those endpoints deliberately avoid (DEC-6) [approved: measured on the branch rig + the pill's own documented no-sync contract, 2026-07-27]
- DESCOPED: ITEM-11 — the repeat `GET /api/conversations` are the notify-and-refetch contract plus the history surface's own load, already in-flight-guarded; suppressing them would violate INV-2 (DEC-7) [approved: measured on the branch rig boot probe, 2026-07-27]
- DESCOPED: ITEM-12 — `control-collision` is documented LOW with known false-positive pressure and the brief says not to chase it; `palette-drift` on the accent swatches is round 1's deliberate `data-allow-custom-color` opt-out; `spacing-grid` is documented informational drift-tracking, never gating (DEC-8) [approved: user brief "lower priority, use judgement … do NOT chase it unless clearly real" + the SKILL's own severity notes, 2026-07-27]
