# INFRA_INTEGRATION — the three per-item walks

## User-experience walk

A user asks the agent to do something long. The agent spawns a sub-agent; the run
row is bound to the conversation. The user keeps chatting. After the last turn a
single quiet row appears: "1 agent running", with a pulsing dot. They click it;
the right panel opens a "Tasks" tab listing that run with its status, tokens,
steering composer and cancel. They steer it without leaving the conversation.
When it finishes, the row's status flips live (`sync:workflow_run`, no reload)
and the notification bell announces the result; clicking the bell's item
navigates back to this conversation. At no point are they pulled to a separate
global page listing every run they have ever launched.

An ordinary conversation with no sub-agents gains NO chrome at all — the footer
component renders `null`.

## Infrastructure-integration walk

| Subsystem | Constraint found | Handling |
|---|---|---|
| **Chat extension registry** | `initialize` runs per PANE mount, not once globally; `loadConversation` restores the persisted panel snapshot AFTER `initialize`, so a renderer registered anywhere else misses rehydrated tabs. | `registerPanelRenderer('background', …)` is in `initialize` (idempotent `Map.set`), mirroring literature. |
| **Chat slots** | `SlotRegistration.component` is a **zero-prop** `ComponentType`. | The footer takes no props and resolves its conversation from `useChatPaneOrNull()`. |
| **MessageList** | The empty-conversation branch (`!loading && count === 0`) early-returns and does NOT render `message_list_footer`. | Correct in production (no turns ⇒ no sub-agents). E2E fixtures therefore seed one real message; recorded as DRIFT-1.7. |
| **Right panel** | `data` must be fully serializable (it is persisted + rehydrated). | `{ conversationId }` only — no live objects, no run snapshots. |
| **Split panes** | Two panes can hold two conversations at once; a global store slice would clobber. | Store keyed by conversation; footer + panel read the PANE's store. |
| **Realtime sync** | `sync:workflow_run` fires on every background-run state change — i.e. constantly while the user watches — and the pre-existing handler refetched an UNSCOPED page. Under the new disjoint semantics that returns a different scope and blanks the panel. | The handler now refetches every tracked conversation scope with its own id (DEC-4), pinned by TEST-7. |
| **Permissions** | `background::use` is already granted to the Users group; no new permission. The store must self-gate so a reconnect can't 403. | `hasPermissionNow` guard retained on every fetch path; asserted by TEST-8 (unit) + TEST-13 (e2e). |
| **Notifications** | The bell is the design's stated replacement for the removed nav entry and needs a live deep-link target. | `/notifications/background` route + the `sidebarBottom` bell are explicitly KEPT (DEC-2); TEST-12 asserts both still work. |
| **Scheduler** | Scheduled tasks own their own run history; double-reporting would break the disjunction. | The unfiltered endpoint returns only conversation-less runs, so a conversation run cannot also appear in a global list. The scheduler surface is untouched. |
| **OpenAPI / desktop** | Desktop has no `background` module of its own; its vite `localOverridePlugin` falls back to `../../ui/src`. Only the generated client differs. | `just openapi-regen` (both binaries); no desktop module mirror needed. |
| **testid / gallery gates** | `check:testid-registry` writes into the `sdk` SUBMODULE; `check:gallery-coverage` / `check:state-matrix` have BOTH generated and hand-maintained halves. | Regenerated + the two hand-maintained files (`coverage.ts`, `stateCoverage.ts`) edited; sdk commit + pointer bump (DEC-11). |

## Entity-lifecycle walk

Entities the new surfaces hold: **the conversation** (via the pane store) and
**its background runs** (the keyed slice).

| Event | Local same-session path | Sync / SSE path |
|---|---|---|
| **run ADDED** | the spawning turn completes → the backbone emits `sync:workflow_run` → the tracked-scope refetch adds it; the footer appears. | same event, cross-device — same handler. |
| **run MUTATED** (running → completed/failed) | `cancelRun` refetches the tracked scopes directly as a backstop. | `sync:workflow_run` → scoped refetch → the card's badge flips with no reload (TEST-18 asserts this live). |
| **run REMOVED** | no delete API exists for background runs. | verified by RUNNING it in the e2e: rows deleted out from under an OPEN panel + a reload → the panel renders its empty state rather than stale cards (the empty leg of TEST-14). |
| **conversation DELETED** | the pane unmounts, so the footer/panel unmount with it; the slice is keyed by that id and simply never read again — it cannot leak into another conversation's panel. `workflow_runs.conversation_id` is `ON DELETE SET NULL`, so the run itself survives as a conversation-less (detached) run rather than dangling. | same — the conversation store's own delete handling is unchanged by this feature. |
| **access LOST** (`background::use` revoked) | the store's `hasPermissionNow` gate short-circuits the next fetch; no request, no 403. | `sync:reconnect` re-runs the same self-gated path, so a revoked user's reconnect issues nothing (TEST-8 + TEST-13). |
