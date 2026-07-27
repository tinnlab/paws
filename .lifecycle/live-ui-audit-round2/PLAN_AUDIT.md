# PLAN_AUDIT — live-ui-audit round 2 (plan vs the codebase)

Audited against the real tree at `24ce5dcca`, not from memory. Every claim below
names the file it was checked in.

## Breakage risk

- **ITEM-1 (`SummarizationStatusPill`)** — the component is the documented
  "read-model driver" for `SummaryBoundaryMarker`
  (`summarization/chat-extension/extension.tsx` registers both slots, and the
  pill's own doc-comment says "DO NOT move the trigger elsewhere (audit lesson
  from the crashed-session redo)"). The trigger therefore must STAY in this
  component — the plan changes only WHICH signal fires it, which honours that
  note. Risk: if the new trigger missed a summary update the marker would render
  stale. Mitigated because the server only writes the summary in its
  `after_llm_call` hook (`modules/summarization/chat_extension`), i.e. exactly at
  the streaming true→false edge the new trigger uses, plus the existing
  conversation-switch load.
  Second risk: reading `Chat.isStreaming` adds one more reactive proxy read. It
  must be hoisted to the top with the others or the hook count varies
  (`REACT_COMPONENT_PATTERNS` / the file's own comment). Accounted for.
- **ITEM-4 (delete `afterStreamComplete`)** — `chatExtensionRegistry` calls each
  extension's optional hooks; removing the hook from ONE extension cannot break
  the aggregator (every other extension declares its own). Verified the store's
  own `init` already registers `on('sync:memory')` + `on('sync:reconnect')`
  (`memory/stores/memories/index.ts`) and the server publishes
  `SyncEntity::Memory` from `memory/engine/extractor.rs:386,453,469` and
  `memory/reaper.rs:188`. So freshness survives the deletion (INV-2). Residual
  gap: a user sitting ON `/memories` while a turn completes now waits for the
  sync frame instead of a same-tick refetch — the sync frame is the documented
  mechanism and arrives on the same server-side event, so this is a nanosecond
  reordering, not a staleness class.
- **ITEM-5 (`BackgroundRunsFooter` probe)** — the footer's own doc-comment
  documents a KNOWN CONSTRAINT (`MessageList` early-returns for a conversation
  with no messages, so the slot does not render) — meaning the probe already does
  not fire for an empty conversation. The change must keep the probe for
  server-loaded conversations, or a reload of a conversation WITH runs would show
  no footer. The plan's "session-created only" scoping preserves exactly that.
  Also verified `retainConversationScope` / `releaseConversationScope` refcounting
  must still run even when the probe is skipped, otherwise the `sync:workflow_run`
  refresh would not cover the scope and a run spawned later would never appear.
- **ITEM-6 (`sendMessage` latch)** — `sendMessage` resolves right after
  `ApiClient.Message.send` returns (the reply streams over the chat-token stream,
  not the response), so the latch is held for the SEND, not for the stream. Legit
  sequential sends are therefore unaffected; the composer is separately disabled
  while `isStreaming`. Programmatic callers (`startRegenerateMessage`,
  edit-resubmit, tool-approval transmit) must not be silently dropped — they have
  already mutated state by the time they call. The plan mirrors the existing
  cancel contract in the same file: THROW for programmatic callers, quiet return
  only for `options.allowSilentCancel` (the user-composer path).
- **ITEM-3** — no code change, so no breakage risk. Its risk was the opposite:
  IMPLEMENTING the obvious fix would have broken the committed guard test
  `loadContext.nochange.test.ts` and re-opened a closed security decision. Caught
  at plan time by reading `.lifecycle/net-hygiene/DECISIONS.md` DEC-15.

## Pattern conformance

- ITEM-1 mirrors `MemoryStatusPill` — the sibling `toolbar_status` pill in the
  same slot, same hoist-reads-first shape, same soft-fail. ✔
- ITEM-5/ITEM-6 mirror `BackgroundRuns.store.ts`'s `const inFlight = new Set()`
  declared inside the `actions: (set, get) => { … }` closure with the explicit
  "module-local rather than store state: it is a request-dedup guard, not
  something any component renders" rationale. ✔
- ITEM-4 removes code rather than adding a pattern; the surviving mechanism is
  the store-kit `init({ on })` contract used by every sync-subscribed store. ✔
- ITEM-9's e2e spec mirrors round 1's
  `src-app/ui/tests/e2e/perf/live-audit-network-hygiene.spec.ts` (real backend,
  `page.on('request')` counting, no `page.route()` mocking). ✔
- Deviation checked: none of the touched files is a `shadcn/`/`kit/` primitive,
  so the "never edit the kit to restyle app UI" rule is not engaged.

## Migration collisions

None. `ls src-app/server/src/modules/*/migrations/` highest is
`202607191300_agent_delegate_enabled.sql`; this round adds **no** migration and
touches **no** `.sql`. There is no flat `src-app/server/migrations/` in this tree
— migrations are per-module and merged by `build.rs::compose_merged_migrations`.

## OpenAPI regen

**Not required.** No handler, route, request/response type, permission or
`SyncEntity` changes. `src-app/ui/openapi/openapi.json`,
`src-app/ui/src/api-client/types.ts` and both desktop twins stay byte-identical,
so `openapi::emit_ts::tests::types_ts_parity` is unaffected. Verified by the fact
that every file in *Files to touch* is under `src-app/ui/src/**`,
`src-app/ui/tests/**` or `.lifecycle/**`.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — mirrors `MemoryStatusPill`; the new trigger matches
  the server's own write point (`after_llm_call`); the "keep the trigger here"
  note is honoured.
- **ITEM-2** — verdict: PASS — comment-only, at the app-side call site; no
  submodule pointer moves (BASE.md).
- **ITEM-3** — verdict: CONCERN — the item as first drafted duplicated a design
  the codebase already CUT (net-hygiene DEC-15) and would have turned the
  committed `loadContext.nochange.test.ts` red. Rewritten to diagnosis +
  classification with no eligibility change. CONCERN, not PASS, because it means
  the waterfall count can only fall as far as the request-count reductions carry
  it — that limit is stated in the acceptance bar rather than hidden.
- **ITEM-4** — verdict: PASS — the removed refetch is provably covered by
  `sync:memory` (client subscription + server publisher both verified).
- **ITEM-5** — verdict: PASS — preserves the refcount/sync path and the
  server-loaded-conversation probe; only the provably-empty case is skipped.
- **ITEM-6** — verdict: PASS — latch scope matches the action's real lifetime;
  the throw/quiet-return split mirrors the file's existing cancel contract.
- **ITEM-7** — verdict: PASS — disposition item; the plan requires RUNNING the
  element (focus it) before classifying, not reading the class list.
- **ITEM-8** — verdict: CONCERN — the finding fired in 2 of 81 cycles and its
  evidence dirs were pruned by the rig's retention, so reproduction may fail
  through no fault of the fix. The plan pre-commits to reporting the measured
  reproduction attempt either way (INV-4) instead of claiming a fix.
- **ITEM-9** — verdict: PASS — the rig is stood up and the BEFORE run is already
  recorded; the AFTER run uses the same unmodified audit script, backend process
  and database.
- **ITEM-10** — verdict: PASS — descoped; the 2× reads are the composer genuinely
  remounting across the `/` → `/chat/{id}` navigation (`NewChatPage` and
  `ConversationPage` each render their own `<ChatInput/>`), so removing them needs
  a cross-conversation mode cache that would introduce a staleness class the
  current code deliberately avoids. Approved disposition: DECISIONS.md DEC-6.
- **ITEM-11** — verdict: PASS — descoped; measured on the boot probe, the repeat
  `GET /api/conversations` are the notify-and-refetch contract working as
  designed (`sync:conversation` → `syncRecentFront`) plus the history page's own
  load, not an unguarded loop. Approved disposition: DECISIONS.md DEC-7.
- **ITEM-12** — verdict: PASS — descoped; `palette-drift` on the accent swatches
  is the deliberate `data-allow-custom-color` opt-out round 1 shipped
  (DEC-7 there), `spacing-grid` is documented informational drift-tracking, and
  `control-collision` is documented LOW with known false-positive pressure that
  the brief explicitly says not to chase. Approved disposition: DECISIONS.md DEC-8.
