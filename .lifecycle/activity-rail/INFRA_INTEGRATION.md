# INFRA_INTEGRATION — Activity Rail

The three mandatory phase-5 walks. One pass per concern, over the whole diff — not per item,
because the interesting failures are the ones that fall BETWEEN items.

---

## 1. User-experience walk

Per surface, what the user wants, and what the diff actually gives them.

| Surface | JTBD | What ships | Gap / risk |
|---|---|---|---|
| A turn with ONE tool call (84% of tool-using messages) | "don't make me read machinery" | One quiet muted line — no spine, no summary, no collapse control (DEC-3). Still expandable; still offers the full record. | None. This is strictly less chrome than today's bordered card. |
| A turn with 2+ tool calls | *while it runs*: "what is it doing, is it stuck?" | Rail OPEN while streaming, steps accreting, running step pulsing with a ticking elapsed timer. | The tick needs `started_at` on the SSE frame (ITEM-14). Without it a live step shows no timing — degraded, not broken. |
| The same turn, once answered | "get out of my way, but let me audit any step" | Collapses to `✓ Worked for 12s · 4 steps · 3 files`. User-toggleable; the choice persists per message. | None. |
| A turn containing a FAILURE | "show me, don't hide it" | Rail forced open, failed step visible, and the collapse control is **suppressed** rather than made inert — a control that looks live but refuses is worse than none. | A user who wants the failure out of the way cannot collapse it. Deliberate: INV-5 outranks tidiness. |
| A turn needing APPROVAL / an elicitation | "answer and move on" | Breaks OUT of the rail entirely, full width, non-collapsible (INV-3). Never a row. | None. Stronger than the retired card's force-open: the request never *enters* a collapsible container. |
| A step that produced FILES | "where's my chart?" | Artifact chips on the row itself, no expansion needed; capped at 4 + "+N". | Today `InlineFilePreview` renders each file as a bordered box **open by default** — the largest single card multiplier measured. Chips are a real reduction; the preview is one click away. |
| Auditing one step | "what exactly did it send and get back?" | Level 1 inline (the owning extension's own body); level 2 right-panel with the full record — duration, `source`, result size, timeout-vs-failure, error. | Duration/`source`/size were previously reachable ONLY from an admin drawer, never from the message. Net gain. |
| Auditing arguments that contain a credential | — | Redacted by default in both surfaces; an admin-gated reveal for the operator debugging a failing call. | A holder of no permission loses sight of a value the old card printed. Deliberate, narrow, recorded against INV-2. |
| Sharing a step with a colleague | "send them the exact spot" | Copy arguments, copy result, copy a `#message-<id>` deep link. | The consumer for that hash has existed all along with **no producer anywhere**; this is the first one. |
| 390px | "read it on a phone" | Label truncates first and never wraps; timing drops below 360px; the page body never scrolls horizontally. | Pinned by TEST-8, which asserts the computed line-box, not just visibility. |

**Affordance-by-affordance check** (every control the diff adds):
- rail summary row → toggles the rail; `aria-expanded`; disabled + chevron hidden when forced open.
- step row → toggles inline detail; `aria-expanded` only when a body exists; accessible name leads with the STATUS so a screen-reader user hears "Failed" before the tool name.
- "Open full record" icon button → right panel, tab id derived from `tool_use_id`, so re-opening focuses rather than stacks.
- artifact chip → currently non-interactive (a label). The file itself remains reachable via the step body's existing preview. Noted as a deliberate non-affordance, not an oversight.
- copy arguments / copy result / copy link → transient "Copied" confirmation.
- "Reveal raw" → rendered only inside `<Can>`; the endpoint refuses independently of the UI.

---

## 2. Infrastructure-integration walk

Every subsystem the diff touches, and what it had to respect.

| Subsystem | Touched how | Integration constraint honoured |
|---|---|---|
| Chat extension registry | New `railContributions` map BESIDE `contentTypeRegistry`; resolution logic split into a pure `railRegistryCore.ts`. | Additive — `registry.tsx` is one of the three hottest files on the branch, so a rewrite would not merge. `renderContent`'s resolution is byte-for-byte unchanged apart from the `contentSpan` removal. |
| Extension auto-discovery | Three NEW `modules/*/chat-extension/extension.tsx` (js-tool, tool-call panel, plus the contribution modules). | Glob-discovered; zero wiring. Registration is priority-sorted and HMR-safe (re-register unregisters first). |
| `renderContent` / `contentSpan` | `contentSpan`, `blocks` and `index` **removed**; `renderContent` now returns `ReactNode \| null`. | The ONLY `contentSpan` implementor was the group card being retired, so this leaves no dead mechanism (§15). Grouping moved to the rail, computed once. |
| `MessageViewState` store | Two new maps (`rails`, `steps`) + two actions; `actions.gen.ts` regenerated. | Scoped selectors only — a rail subscribes to ITS key, so toggling one never re-renders another. `resetViewState(messageIds)` evicts `<messageId>#`-prefixed keys, preserving the split-pane scoping contract. |
| Right-panel registry | New `tool_call` tab type via declaration merging + `registerPanelRenderer` in `initialize`. | Registered in `initialize` because `loadConversation` rehydrates the persisted snapshot only after it. Payload is plain strings ⇒ survives the localStorage round-trip. |
| Split panes / multi-instance | `RailStep` opens through `useChatPaneOrNull()?.store ?? Chat`. | A step opened in pane B lands in pane B's panel. Rail state is per-MESSAGE, so two panes on the same conversation share it — deliberate. |
| Virtualised message list | Rail + step expansion keyed by message id. | This is INV-7. The precedent it does NOT copy is `ThinkingContent`, whose `useState` silently re-collapses on scroll-away. |
| Live tool SSE frames | New core-owned `liveSteps.ts` seam; mcp registers a source in `initialize`. | Dependency points core ← extension, never the reverse. With no source registered (unit test, reload, gallery) the rail degrades to block-derived status rather than breaking. |
| `mcp_tool_calls` REST | Two new filters + an index migration. | Owner-scope predicate untouched — pinned by a dedicated test, because it is the cross-user guard. |
| MCP SSE wire types | `started_at` / `duration_ms` / `always_reprompt` added. | Backend response-type change ⇒ `just openapi-regen` for BOTH binaries + `types_ts_parity`. |
| Permissions | **No new permission, no migration.** The reveal reuses `mcp_servers_admin::edit`. | `DECISIONS.md` DEC-2 named `mcp_servers::manage`, which does not exist in this repo — see DRIFT-1. |
| Redaction recorder | Denylist gaps closed; a client-side mirror added. | Kept EXACT-match, because a substring rule would redact `token_count` / `password_policy` and break INV-2 for legitimate arguments. |
| Gallery / testid / state-matrix registries | New components + a new panel renderer ⇒ generated registries regenerate. | `npm run check` runs `check:testid-registry`, `check:state-matrix`, `check:gallery-coverage`; all must be regenerated and committed. |
| Desktop workspace | Only via the generated `openapi.json` + `types.ts` twins. | No desktop-specific rail code; the chat module is shared. |

---

## 3. Entity-lifecycle walk

For every entity a new surface HOLDS, prove add / remove / delete / mutate / access-loss — from **both** the local mutation path and the sync/SSE path, because they are different handlers.

### E1 — a rail STEP (derived, not stored)

| Event | Local path | Sync/SSE path |
|---|---|---|
| add | A `tool_use` block lands in `message.contents`; the next render re-segments and the step appears. | `mcpToolStart` injects the block into `streamingMessage` **and** writes `McpComposer.toolCalls` → the live seam bumps → the rail re-renders. Both halves land; neither alone is sufficient (the block gives the row, the store gives `pending-approval` + timing). |
| mutate | A `tool_result` arrives → re-segmentation flips the status to success/failed and grows `consumed`. | `mcpToolComplete` writes status + `duration_ms` into the store; the ticking timer settles onto the real duration. |
| remove | Editing/regenerating a message replaces `contents`; the step vanishes with it. | `applyStreamFrame` replaces the message; stale rail view-state keys are `<messageId>#…` and are evicted by `resetViewState`. |
| delete | Deleting the conversation drops the messages; `resetViewState` on store destroy clears every key. | Same handler. |
| access-loss | — | The step is derived from data the user already holds; there is no separate fetch to 403. |

**Verified gap → closed**: a step whose contribution is later UNREGISTERED (extension disabled) stops resolving, and the block falls back to prose via `ContentRenderer`. Nothing is dropped.

### E2 — rail / step VIEW STATE (`MessageViewState.rails` / `.steps`)

| Event | Local path | Sync/SSE path |
|---|---|---|
| add | `setRailOpen` / `setStepOpen` on user toggle. | n/a — deliberately client-only, per-device ephemeral UI state. Not synced, so no `SyncEntity` and no audience decision is owed. |
| remove | `resetViewState(messageIds)` on conversation switch evicts exactly that conversation's keys (prefix match). | `loadConversation` calls it with the OUTGOING message ids — split-pane safe. |
| delete | `resetViewState()` (no args) on store destroy → fresh empty maps. | Same. |
| mutate | Toggling overwrites the boolean. | n/a |
| access-loss | n/a — no permission gates it. | n/a |

**Verified gap → closed**: before this change `resetViewState(ids)` deleted only `collapsed[id]`; rail keys would have leaked across conversation switches indefinitely. `forgetRailKeys` was added for exactly that.

### E3 — the `tool_call` PANEL TAB

| Event | Local path | Sync/SSE path |
|---|---|---|
| add | `displayInRightPanel` upserts by id; a repeat open FOCUSES. | n/a |
| mutate | The panel refetches on `toolUseId` change; there is no `updateRightPanelTab` write, so no stale-write race. | n/a |
| remove | `closeRightPanelTab` / `closeAllRightPanelTabs`, as for every other tab type. | n/a |
| delete | The underlying `mcp_tool_calls` row can be PRUNED by the retention policy while the tab is open or persisted. | The panel handles a missing record explicitly with a "No stored record" state naming retention as the likely cause — it does not render an error or an empty shell. |
| access-loss | A user losing `mcp_servers::read` gets a failed list call → the panel's error state. A user losing `mcp_servers_admin::edit` loses the reveal affordance on the next render (`Can` is reactive) and the endpoint refuses regardless. | The tab itself rehydrates from localStorage after the permission is gone; it renders its error state rather than blank. |

**Verified gap → closed**: a rehydrated tab whose row has been pruned previously would have rendered an indefinite skeleton; the explicit empty state is the fix.

### E4 — the LIVE-STEP SOURCE (`liveSteps.ts`)

| Event | Path |
|---|---|
| add | mcp's `initialize` registers it. Idempotent. |
| mutate | Registering a second source DETACHES the first before attaching, so an HMR reload or a re-mounted pane cannot leak a subscription. |
| remove | `setRailLiveSource(null)` detaches. `__resetRailLiveSourceForTests` gives specs a clean slate so a source cannot leak between spec files. |
| absent | Every consumer treats "no source" as the normal case — a reload, a unit test and a gallery render all see it. |
| throwing | `getRailLiveStep` catches: a broken store must degrade a row, never break the transcript. |

### E5 — the `mcp_tool_calls` ROW (backend)

| Event | Path |
|---|---|
| add | Recorded fire-and-forget inside `McpSession::call_tool`; a DB hiccup cannot fail the tool call. |
| mutate | Never updated after insert. |
| delete | The retention prune loop (`mcp_user_policy.tool_call_retention_days`, admin-configurable, reused not duplicated — DEC-6). |
| access-loss | Every read is `WHERE user_id = $1`; a cross-user single-row read is 404. The new filters compose INTO that predicate rather than replacing it — pinned by its own test. |
| never-created | Scheduler-skipped tools push a `tool_result` but never call the recorder, so those steps legitimately have no row. The panel's empty state covers it. |
