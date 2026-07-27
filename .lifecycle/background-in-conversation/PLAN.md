# PLAN — background-in-conversation

Surface a conversation's background sub-agent runs INSIDE that conversation
(right-panel "Tasks" tab + an end-of-conversation footer affordance), delete the
global "Background tasks" page + both background sidebar-nav entries, and make
`GET /api/background/runs` disjointly scoped by `conversation_id`.

## Design source

- Realizes the **owner-approved "background runs are disjointly scoped" design**,
  recorded verbatim in `DESIGN.md` (this feature dir) §1 (scoping), §2 (surfaces),
  §3 (backend filter semantics). `DESIGN.md` is the transcription of the design the
  owner approved before the original (uncommitted) implementation; this plan
  realizes it against current `origin/feat/agent-core`.
- Realizes ziee `CLAUDE.md` → *Realtime Sync* (owner-scoped `sync:<entity>`
  refetch contract) and `agent-kit/docs/CODING_GUIDELINES.md` §9 (module
  structure / cross-module UI via slots), §12 (store discipline), §15 (dead code).

## Invariants

- **INV-1**: Background sub-agent runs are **disjointly scoped**: a CONVERSATION's
  sub-agents appear IN that conversation (a right-panel "Tasks" tab + an
  end-of-conversation footer affordance that opens it), and a SCHEDULED TASK's runs
  appear under Scheduled Tasks (which already has its own run history).
- **INV-2**: There is **no global "Background tasks" page and no "Background
  results" sidebar entry** — results surface via the central notification bell,
  whose click navigates to the conversation.
- **INV-3**: `GET /api/background/runs` supports `conversation_id` filtering with
  disjoint semantics (no `conversation_id` ⇒ only conversation-less runs; with one
  ⇒ only that conversation's).

## Items

- **ITEM-1**: `ListBackgroundRunsQuery` gains `conversation_id: Option<Uuid>`
  (`#[serde(default)]`, doc-commented) and `list_background_runs` passes it down;
  the `_docs` description states the disjoint semantics.
- **ITEM-2**: `workflow::repository::list_background_runs_for_user` gains a
  `conversation_id: Option<Uuid>` parameter applying the **two-state disjoint**
  predicate `(($n::uuid IS NULL AND conversation_id IS NULL) OR conversation_id = $n)`
  to **both** the list query and the COUNT query (so `total` matches the page).
- **ITEM-3**: OpenAPI + `api-client/types.ts` regen for **both** `ui/` and
  `desktop/ui/` (`just openapi-regen`), reflecting the new query param.
- **ITEM-4**: `BackgroundRuns.store` gains a **conversation-keyed slice** —
  `runsByConversation` / `totalByConversation` / `loadingByConversation` /
  `errorByConversation` / `loadedPagesByConversation` — fed by a new
  `loadConversationRuns(conversationId, page?)` that sends `conversation_id`.
  The existing `sync:workflow_run` / `sync:reconnect` handler is re-pointed to
  refetch **every tracked conversation scope** instead of the (now-removed)
  global page — without this, a run state-change wipes the panel's list.
- **ITEM-5**: `components/BackgroundRunsPanel.tsx` — the right-panel "Tasks" tab
  for ONE conversation: loading / error / empty / populated states, a
  "Showing N of M" line and a **Load more** control when `loaded < total`.
- **ITEM-6**: `components/BackgroundRunsFooter.tsx` — a `message_list_footer`
  affordance pinned after the last turn; renders **nothing** when the conversation
  has no runs, else one row ("N agents running" / "N tasks") that opens the Tasks
  tab via `displayInRightPanel`. Pane-scoped (`useChatPaneOrNull`), so a split pane
  opens ITS own conversation's tab.
- **ITEM-7**: `background/chat-extension/extension.tsx` — auto-discovered sibling
  chat-extension registering the `background` panel renderer in `initialize()`
  (lazy import, mirrors literature) plus the `message_list_footer` slot.
- **ITEM-8**: `background/types.ts` — `PanelRendererMap` declaration merge adding
  `background: { conversationId: string }`.
- **ITEM-9**: `background/module.tsx` — delete the `sidebarNavigation`
  "Background tasks" entry AND the `/background-tasks` route; delete
  `pages/BackgroundTasksPage.tsx` (unreachable ⇒ dead code, §15). Module keeps
  only the store registration.
- **ITEM-10**: `notification/module.tsx` — delete the `agent-inbox` "Background
  results" `sidebarNavigation` entry. KEEP the `sidebarBottom` bell and KEEP the
  `/notifications/background` route (deep-link target for the bell), per INV-2.
- **ITEM-11**: `BackgroundRunCard` gains an optional `contextConversationId` prop;
  when it equals `run.conversation_id` the "Open conversation" affordance is
  suppressed (new-rendering-context audit: navigating to the conversation you are
  already reading is a no-op affordance, and inside a split pane it would hijack
  the window).
- **ITEM-12**: Gallery — drop the `/background-tasks` page seed; add
  `deep-chat-right-panel-background` (populated), `deep-chat-background-empty`
  and `deep-chat-background-footer` deep states to `chat/gallery.tsx` so the new
  panel + footer have loaded-with-data AND empty gallery coverage at desktop and
  narrow (390px) viewports. The empty delivery is real, not seeded: the
  background cassette becomes conversation-aware (`Background.listRuns` as a
  resolver) and answers one designated id with zero runs.
  (Amended per DRIFT-1.1/1.6.) This also covers the two **hand-maintained**
  tsc-enforced coverage files, which the generated registries do NOT subsume:
  `src/dev/gallery/coverage.ts` (surface-level) and
  `src/dev/gallery/stateCoverage.ts` (state-level) — three stale page keys
  removed, three new surfaces and five new state keys added.
- **ITEM-13**: Retarget the e2e specs that observed runs through
  `/background-tasks` (`15-background/background-sandbox-panel`,
  `chat/background-persist`, `chat/background-status`, `chat/steer-running-agent`)
  onto the in-conversation surface, and update
  `15-background/background-negative-perm` + `15-notifications/background-inbox`
  for the removed nav entries.
- **ITEM-15**: Cancel-on-conversation-delete (added after the phase-6 audit, per the
  owner's DEC-15). `workflow_runs.conversation_id` is `ON DELETE SET NULL`, so
  deleting a conversation would detach its background runs — rows with a NULL
  conversation and tasks still executing, unreachable because (by design) there is
  no global page. New `workflow::repository::list_cancellable_background_runs_for_conversation`
  + `background_mcp::runs::cancel_conversation_background_runs`, called from the
  conversation-delete handler BEFORE the delete; it reuses `cancel_cas` (terminal
  write) + `registry::cancel` (stops the detached task) and emits
  `sync:workflow_run` per cancelled run. Already-terminal runs untouched;
  owner-scoped; best-effort.
- **ITEM-14**: Regenerate the testid registry (`npm run gen:testid-registry`) —
  removes the `background-tasks-*` ids, adds the new panel/footer ids. Output lands
  in the **`sdk` submodule** (`sdk/packages/kit/src/testIds.generated.ts`), so this
  is an sdk commit + a pointer bump, matching the existing
  `chore(kit): regen testid registry` precedent on `sdk/agent-core-and-perf`.

## Files to touch

Backend
- `src-app/server/src/modules/background_mcp/runs.rs` (ITEM-1, ITEM-15)
- `src-app/server/src/modules/workflow/repository.rs` (ITEM-2, ITEM-15)
- `src-app/server/src/modules/chat/core/handlers/conversations.rs` (ITEM-15)
- `src-app/server/tests/background_mcp/runs.rs` (tests)

Generated (excluded from the audit-coverage law)
- `src-app/ui/openapi/openapi.json`, `src-app/ui/src/api-client/types.ts`
- `src-app/desktop/ui/openapi/openapi.json`, `src-app/desktop/ui/src/api-client/types.ts`
- `sdk/packages/kit/src/testIds.generated.ts` (submodule, ITEM-14)
- `src-app/ui/src/dev/gallery/{galleryCoverage,stateMatrix}.generated.ts`

Frontend
- `src-app/ui/src/modules/background/stores/BackgroundRuns.store.ts` (ITEM-4)
- `src-app/ui/src/modules/background/components/BackgroundRunsPanel.tsx` (NEW, ITEM-5)
- `src-app/ui/src/modules/background/components/BackgroundRunsFooter.tsx` (NEW, ITEM-6)
- `src-app/ui/src/modules/background/chat-extension/extension.tsx` (NEW, ITEM-7)
- `src-app/ui/src/modules/background/types.ts` (ITEM-8)
- `src-app/ui/src/modules/background/module.tsx` (ITEM-9)
- `src-app/ui/src/modules/background/pages/BackgroundTasksPage.tsx` (DELETE, ITEM-9)
- `src-app/ui/src/modules/notification/module.tsx` (ITEM-10)
- `src-app/ui/src/modules/background/components/BackgroundRunCard.tsx` (ITEM-11)
- `src-app/ui/src/modules/background/gallery.tsx`, `src-app/ui/src/modules/chat/gallery.tsx` (ITEM-12)
- `src-app/ui/src/dev/gallery/coverage.ts`, `src-app/ui/src/dev/gallery/stateCoverage.ts` (ITEM-12, hand-maintained)
- `src-app/ui/src/modules/background/components/runCardAffordances.ts` (NEW, ITEM-11 — the pure predicate)

E2E
- `src-app/ui/tests/e2e/15-background/background-sandbox-panel.spec.ts`
- `src-app/ui/tests/e2e/15-background/background-negative-perm.spec.ts`
- `src-app/ui/tests/e2e/15-background/background-in-conversation.spec.ts` (NEW)
- `src-app/ui/tests/e2e/chat/background-persist.spec.ts`
- `src-app/ui/tests/e2e/chat/background-status.spec.ts`
- `src-app/ui/tests/e2e/chat/steer-running-agent.spec.ts`
- `src-app/ui/tests/e2e/15-notifications/background-inbox.spec.ts`

**No desktop module mirror is needed.** `src-app/desktop/ui` has no `background/`
module; its vite `localOverridePlugin` resolves `@/modules/background/*` through
`fallbackSrc: ../../ui/src`, so the core module renders verbatim in desktop. Only
desktop's generated `openapi.json` + `types.ts` need the regen (ITEM-3).

## Patterns to follow

- **Chat-extension + right panel** → `modules/literature/chat-extension/extension.tsx`
  (registers its panel renderer in `initialize()` behind a lazy import; force-imports
  `../types` for the `PanelRendererMap` merge). Panel data is fully serializable and
  spread as props by `ChatRightPanel`.
- **`message_list_footer` slot registration** → `modules/projects/chat-extension/extension.tsx`
  (`slots: { message_list_header: { component, order } }`). Slot components take
  **no props** and read pane state via `useChatPaneOrNull()`.
- **Pane-scoped store access** → `modules/literature/components/LiteratureToolResultCard.tsx`
  (`const chat = (useChatPaneOrNull()?.store ?? Chat) as typeof Chat`).
- **Keyed-slice store + sync self-gating** → `BackgroundRuns.store`'s own
  `detailsByRun` / `notesByRun` keying and `McpToolCalls.store` (paginated +
  `sync:` subscribed + `hasPermissionNow` self-gate).
- **Disjoint SQL filter** → the existing `($2::text IS NULL OR status = $2)`
  residual-filter idiom in the same function, extended to the two-state form.
- **Gallery deep state for a right-panel tab** → `modules/chat/gallery.tsx`
  `deep-chat-right-panel-literature` / `deep-chat-right-panel-multi`.

### UI-surface checklist

**Surface A — right-panel "Tasks" tab (`BackgroundRunsPanel`)**
- *Precedent*: `LiteratureScreeningPanel` (same right-panel slot, same narrow
  container); run rows reuse the EXISTING `BackgroundRunCard` verbatim rather than
  a parallel card implementation.
- *Scale / cardinality*: a conversation's runs are unbounded in principle. Initial
  load = `per_page: 20`, page 1 only; renders "Showing N of M" plus a **Load more**
  that appends the next page. Never fetch-all.
- *Device size*: the right panel is already responsive — desktop = a docked column,
  mobile = `mobileDrawerOpen` drawer (handled by `ChatRightPanel`). The panel body
  is a single-column `flex-col gap-3 p-3` stack, so 390px needs no special case; the
  reused `BackgroundRunCard` already ships its own responsive action row.
- *Populated render review*: gallery deep state `deep-chat-right-panel-background`
  seeds FIVE runs (running / completed sub-agent / completed sandbox / failed /
  cancelled) so the design-critic pass reviews real data, at desktop + 390px.
- *User-visible progress*: live status is inherited — the card renders the status
  badge, token count, and result, and the store refetches on `sync:workflow_run`,
  so a running agent visibly moves to its terminal badge without a reload.
- *Input economy*: no new inputs (steering reuses the card's existing composer).

**Surface B — end-of-conversation footer (`BackgroundRunsFooter`)**
- *Precedent*: the `message_list_header` project chip
  (`ProjectChipForConversationHeader`) — a single quiet row bound to the pane's
  conversation, rendering `null` when not applicable.
- *Scale*: renders a COUNT, never a list — O(1) regardless of run count.
- *Device size*: a full-width `Button` with `justify-between`; at 390px the label
  truncates rather than wrapping; tap target is the kit's default `size` (≥40px).
- *Populated render review*: gallery deep state `deep-chat-background-footer`.
- *JTBD*: "I asked the agent to go do something long. I want to (a) know at a glance
  it is still running while I keep chatting, and (b) get to its output in one click
  without leaving this conversation." The footer answers (a) (a pulsing dot + count
  pinned after the last turn, where the user's eye already is); the Tasks tab
  answers (b). Neither takes the user out of the conversation — which is exactly
  what the deleted global page did wrong. Empty/loading: the footer is absent
  entirely (no chrome for a conversation with no sub-agents); error: the footer
  stays absent and the error surfaces in the panel's `ErrorState`, so a failed
  background fetch never breaks an ordinary chat.

**Multi-instance**: split panes are first-class here. The footer and the panel both
resolve their conversation from `useChatPaneOrNull()?.store ?? Chat`, and the store
slice is keyed BY conversation id, so two panes on two conversations each show their
own runs and neither clobbers the other. `displayInRightPanel` is called on the
pane's own store, so the tab opens in the pane the user clicked in.

**Entity lifecycle**: a run's terminal transition arrives via `sync:workflow_run`
(cross-device) and via the local `cancelRun` refetch (same-session); both paths are
covered by ITEM-4's scope-aware reload. A DELETED conversation unmounts its pane, so
its slice is simply never read again (no stale surface); the slice is keyed, not
global, so it cannot leak into another conversation's panel.

## Platform-provided affordances

None added — the footer is in-app chrome for in-app state; no browser-provided
affordance is duplicated.
