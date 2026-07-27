# PLAN — Activity Rail

Replace the per-tool card stack in the chat transcript with a **contribution-based activity rail**:
core owns a registry and a row primitive; **each extension contributes its own step descriptor and
detail body**. The rail never imports, names, or special-cases any extension.

Grounded in three sweeps of the real tree @ `b29adbad5`: a 36-surface card inventory, a per-message
grouping simulation over the whole database, and a per-module contribution audit.

## Why this shape (the evidence, not the aesthetic)

- A realistic agentic turn renders **~18 bordered boxes, ~9 expanded**. The largest multiplier is
  `InlineFilePreview` (one box per resource link, **open by default**), not the tool card.
- The obvious cheap fix is a **measured no-op**: making `thinking` run-continuing changes the card
  count by **exactly 0** across every population. The real run-breaker is a short narration `text`
  block (78 occurrences, median 51 chars).
- **The anti-pattern already exists in-tree.** `workflow/components/run/activityDescriptors.ts:19-30`
  hardcodes **nine other modules'** tool names in one map. Extending that map is the failure mode.
- **Three modules import `file`'s internal component as a manual fallback**
  (`literature/components/LiteratureToolResultCard.tsx:6`,
  `knowledge-base/chat-extension/components/SearchKnowledgeToolResultCard.tsx:7`,
  `workflow/chat-extension/components/WorkflowWorkspaceRunCard.tsx:11`), and the comments openly
  document it as forced by the first-wins registry. A composing registry deletes all three imports —
  the strongest single argument for the redesign.

## Prior art we REUSE (building a second one is a defect)

| Asset | Location |
|---|---|
| Status vocabulary `success/failed/cancelled/running/pending-approval/timeout` | `chat/core/tool-status.ts:27-33`, icon `ToolStatusIcon.tsx:20` |
| A working rail row (icon + label + status + "Show details") | `workflow/components/run/AgentActivityTimeline.tsx:38-119` |
| Rail-shaped backend descriptor `{title,detail,kind,seq,status,tool}` | `ProgressKind::agent_activity`, `api-client/types.ts:4592-4600` |
| Right-panel renderer registry (serializable tabs, 4 types, 5 open-from-message call sites) | `chat/core/stores/chat/index.ts:41-139` |
| Full per-call history incl. `duration_ms` | `mcp_tool_calls` + `GET /api/mcp/tool-calls` |
| Host primitives exported to extensions (the pattern the rail row must follow) | `chat/components/*` consumed by assistant/file/mcp/skill |

## Registry resolution — verified, and one audit was wrong

`tool_result` order is `knowledge-base@70` (**has** `contentMatch`, claims only `search_knowledge`,
`SearchKnowledgeToolResultCard.tsx:142-144`) → `workflow@74` (has `contentMatch`) →
`literature@75` (**no `contentMatch` → the real catch-all**) → `file@80` (never reached for
`tool_result`). A sweep claimed knowledge-base was the catch-all; verified false before planning.

---

## Items

### A. Core rail (additive — never a rewrite of `renderContent`)

- **ITEM-1**: Add a `railContributionRegistry` to `chat/core/extensions/registry.tsx`, **beside** the
  existing `contentTypeRegistry`. Extensions register `{contentTypes, describeActivity, renderDetail}`.
  Additive so concurrent edits to `renderContent` merge cleanly (see BASE.md — this file changed yesterday).
- **ITEM-2**: Segment a message's normalized blocks into **activity spans** vs prose inside the core
  run-loop (`chat/components/ChatMessage.tsx:143-163`), after the existing `normalizeToolResultOrder`
  pre-pass. Span membership is decided by *contributions*, not by a hardcoded type list.
- **ITEM-3**: Export a `RailStep` row primitive from the chat host (mirroring how `CollapsibleBlock` /
  `PlusMenuItem` are already consumed by extensions), so contributors render rows without re-styling.
- **ITEM-4**: Reuse `ToolStatusKey` + `ToolStatusIcon` verbatim. No second status vocabulary.
- **ITEM-5**: Make the `contentSpan`/render desync **structurally impossible**. Today it holds only
  because two branches both call `shouldWrapRun` (`mcp/chat-extension/toolRun.ts:45-54`); the rail
  computes the span once and renders from that single value.
- **ITEM-6**: `describeActivity` must degrade to **name-only** when `structured_content` is absent.
  It is not guaranteed: `cap_structured_content` **drops** oversized payloads
  (`mcp/chat_extension/helpers.rs:178-200`), and `ask_user` / `delegate` / `schedule_next` /
  `files_mcp` image+binary reads emit none.

### B. Lifecycle + the constraint "we can't just collapse everything"

- **ITEM-7**: Rail is **open while streaming, auto-collapsed on completion** to one summary line
  (`✓ Worked for 12s · 4 tools · 3 files`), user-toggleable.
- **ITEM-8**: Persist expanded state in `MessageViewState` keyed by message. Fixes a live bug: today
  `ThinkingContent`'s state is component-local and the list is virtualised, so scrolling away and back
  **silently resets it to closed** mid-read (`ThinkingContent.tsx:16`).
- **ITEM-9**: A **failed or timed-out** step forces the rail open. A red dot inside a collapsed
  summary is a silent failure. (`timed_out` from code_sandbox is the only in-tree producer of
  `ToolStatusKey.timeout`.)
- **ITEM-10**: **Blocking requests break out of the rail**, full width, **non-collapsible**:
  `elicitation_request`, `run_js_approval`, pending tool approval, `ask_user`. The existing
  force-open invariant (`toolRun.ts:76-81` `deriveGroupOpen`) must survive the refactor.
- **ITEM-11**: Level 1 detail — expanding a step renders the owning extension's `renderDetail` inline,
  via `renderContent({content})` with no neighbour list (the existing non-recursion guard,
  `registry.tsx:955-963`).
- **ITEM-12**: Level 2 detail — a **`tool_call` right-panel renderer**: full arguments, full result,
  `structured_content`, status, `source`, size, error. Uses the existing serializable-tab contract and
  a stable tab id derived from `tool_use_id` (mirroring `lit:${tool_use_id}` / `kb:${file_id}:…`).
- **ITEM-13**: Join the transcript to `mcp_tool_calls` by `tool_use_id`: add `tool_use_id` +
  `message_id` filters to `GET /api/mcp/tool-calls` and an **index migration** (neither column is
  indexed today). This is what makes duration/timeout/`source`/size reachable from a message at all.
- **ITEM-14**: Add `started_at` + `duration_ms` to the `mcpToolComplete` SSE frame so a **live** step
  shows timing (the DB join alone loses the in-flight case). Backend response-type change →
  `just openapi-regen` for **both** binaries + `types_ts_parity` green.
- **ITEM-15**: **Copy** arguments/result from a step (nonexistent on both surfaces today) and a
  **deep-link producer** for `#message-<id>` — the consumer already exists
  (`ConversationPage.tsx:761-782`) with no producer anywhere.
- **ITEM-16**: Let a **non-admin** reach built-in servers' call history. Today `isEditable={!server.is_system}`
  (`user/McpServersSettings.tsx:191`) blocks the Calls tab for every built-in server.
- **ITEM-17**: Decide + implement ONE canonical detail source. History is redacted; **the chat card
  renders `tool_use.input` completely unredacted**. The detail view must not widen exposure.

### C. Contributions (each module ships its own descriptor + detail)

- **ITEM-18**: Port the 5 existing chat-extension renderers to contributions: `mcp`, `file`,
  `knowledge-base`, `literature`, `workflow` — reusing their current components as `renderDetail`.
- **ITEM-19**: New contributions for tool families that render as a raw JSON dump today:
  `web_search` (`web_search`, `fetch_url`), `code_sandbox` (`execute_command` + 5 file tools),
  `lit_search` (**6** tools — CLAUDE.md documents 2), `memory` (`remember`/`recall`/`forget`),
  `citations` (6), `files_mcp` (`semantic_search`, `grep_files`, writes).
- **ITEM-20**: Contributions for `background_mcp`, `control_mcp`, `skill_mcp`, `js_tool`,
  `tool_result_mcp`.
- **ITEM-21**: `agent` meta-tools (`delegate`, `schedule_next`, `task_create/update/get/list`,
  intercepted in-process at `agent-core/src/core_tools.rs:62-72`). **De-dup required**: `task_update`
  and the `taskListChanged` SSE frame carry the same data — emitting both doubles the rail.
- **ITEM-22**: Scheduler **skipped-tool markers** (`{unattended_denied:true}` / `{admin_disabled:true}`,
  stamped `mcp/chat_extension/mcp.rs:3155-3185`) — unowned steps today. Status `cancelled` (neutral),
  **not** `failed`.

### D. Anti-pattern removal (the point of the exercise)

- **ITEM-23**: Delete the centralized tool map `workflow/.../activityDescriptors.ts:19-30` (AP-1),
  replacing it with each module's own contribution; `AgentActivityTimeline` consumes the registry.
- **ITEM-24**: Remove the three cross-module `MessageFilesView` imports (AP-2) — the composing
  registry makes the manual fallback unnecessary.
- **ITEM-25**: Remove `mcp`'s hardcoded `control_mcp` UUID + tool name (AP-3,
  `ToolCallPendingApprovalContent.tsx:28`) and `mcp`'s ownership of `js_tool`'s approval UI
  (AP-4, `extension.tsx:710-748`).

### E. Surfaces, seed, responsive

- **ITEM-26**: Narrow-viewport behaviour at **390px** — 16px gutter, label truncates first, timing
  drops below 360px, label never wraps.
- **ITEM-27**: Extend the showcase seed (`src-app/server/seeds/showcase/showcase.sql`) at its
  documented anchors — `:892` tool-call turns, `:1258` `mcp_tool_calls` rows, `:1402` scenario
  conversations — with rail-exercising turns: a multi-tool run, an artifact-producing run, a failure,
  a pending approval, a knowledge-base search (**`knowledge_base` has zero seed coverage today**).
  Ordinals are `numeric`, so new turns slot between existing ones without renumbering.

---

## Files to touch

**Core (additive)**
- `src-app/ui/src/modules/chat/core/extensions/registry.tsx` — rail contribution registry (ITEM-1)
- `src-app/ui/src/modules/chat/components/ChatMessage.tsx` — span segmentation (ITEM-2)
- `src-app/ui/src/modules/chat/components/rail/` — **new**: `ActivityRail.tsx`, `RailStep.tsx`,
  `railSegmentation.ts`, `railTypes.ts` (ITEM-2/3/5)
- `src-app/ui/src/modules/chat/core/stores/chat/` — `tool_call` panel renderer + `MessageViewState`
  rail state (ITEM-8/12)
- `src-app/ui/src/modules/chat/core/tool-status.ts` — reused unchanged (ITEM-4)

**Contributions** — `chat-extension/` of: `mcp`, `file`, `knowledge-base`, `literature`, `workflow`,
plus **new** contribution modules for `web-search`, `code-sandbox`, `citations`, `js-tool`, `agent`,
`memory`, `skill`, `background`, `scheduler`, `file-rag` (ITEM-18..22)

**Backend**
- `src-app/server/src/modules/mcp/tool_calls/{handlers,repository,models}.rs` — `tool_use_id`/
  `message_id` filters (ITEM-13)
- `src-app/server/src/modules/mcp/migrations/<ts>_mcp_tool_calls_lookup_index.sql` — **new**, timestamp
  later than `202607191300` (ITEM-13)
- `src-app/server/src/modules/chat/core/services/streaming.rs` + `mcp/chat_extension/helpers.rs` —
  timing on `mcpToolComplete` (ITEM-14)
- `src-app/ui/openapi/openapi.json` + `src-app/ui/src/api-client/types.ts` + desktop twins — regen (ITEM-14)

**Anti-pattern removal**
- `src-app/ui/src/modules/workflow/components/run/{activityDescriptors.ts,AgentActivityTimeline.tsx}` (ITEM-23)
- `literature/components/LiteratureToolResultCard.tsx`,
  `knowledge-base/chat-extension/components/SearchKnowledgeToolResultCard.tsx`,
  `workflow/chat-extension/components/WorkflowWorkspaceRunCard.tsx` (ITEM-24)
- `mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx`,
  `mcp/chat-extension/extension.tsx` (ITEM-25)

**Seed + tests**
- `src-app/server/seeds/showcase/showcase.sql` (ITEM-27)
- `src-app/ui/tests/e2e/chat/activity-rail*.spec.ts` — **new**
- `src-app/server/tests/mcp/tool_call_lookup_test.rs` — **new**

---

## Patterns to follow

| Area | Mirror this |
|---|---|
| Contribution registry | the existing `contentTypeRegistry` + `contentMatch`/`contentSpan` statics in `registry.tsx:926-975` — same registration idiom, same first-wins discipline |
| Rail row + "Show details" | `workflow/components/run/AgentActivityTimeline.tsx:38-119` (`ActivityRow`) |
| Step descriptor naming | `workflow/components/run/activityDescriptors.ts:34-48` (`titleCaseToolId`, `phraseForTool`) — **move the mechanism, delete the central map** |
| Right-panel detail tab | `literature`'s `lit:${tool_use_id}` tab (`LiteratureToolResultCard.tsx:33-52`) and `knowledge-base`'s `kb_source` (`SearchKnowledgeToolResultCard.tsx:42-49`) |
| Host primitive exported to extensions | `chat/components/CollapsibleBlock.tsx` as consumed by `mcp`/`file`/`skill` |
| Owner-scoped list endpoint + filter | `mcp/tool_calls/repository.rs:89-133` (page/per_page clamp, owner-scoped SQL, cross-user → 404) |
| Index migration | any `modules/<mod>/migrations/<ts>_*.sql`; `CREATE INDEX CONCURRENTLY` per coding guidelines §4 |
| Seed authoring | `showcase.sql` helpers `pg_temp.msg/blk/cmsg` + the README's extension guide |
| E2E | `ui/tests/e2e/07-mcp/mcp-tool-call-history.spec.ts` and the recently-landed `control-tool-in-chat.spec.ts` (drives Qwen for real) |

## UI-surface checklist

- **Precedent** — the rail's twin is `AgentActivityTimeline`; the detail panel's twins are the
  `literature` and `kb_source` panels. Mirror both before adding anything new.
- **Scale / cardinality** — a turn is bounded by blocks-per-message (observed max **44**). The rail
  renders all steps but the *collapsed* summary is the default, so the initial cost is one row.
  Artifact chips cap at 4 + "+N"; the panel pages the result body.
- **Responsive** — 390 / 768 / 1280 per ITEM-26; gallery coverage must include the 390px state.
- **Populated render** — the design-critic pass runs against **seeded, populated** rails (ITEM-27),
  never the empty state.
- **User-visible progress** — the rail IS the progress surface: live step pulsing, elapsed timing,
  steps accreting. This is the JTBD it exists to serve.
- **Input economy** — blocking requests keep their forms (ITEM-10); the rail adds no new input.
- **JTBD** — *while it runs*: "what is it doing, is it stuck?" *after*: "get out of my way, but let me
  audit any step." *when it fails*: "show me, don't hide it in a collapsed summary."
- **Multi-instance** — panes: every store read must go through `useChatPaneOrNull()?.store ?? Chat`,
  as the existing panel actions already do. Rail state is per-message, so split panes showing the same
  conversation share it deliberately.
- **Platform** — no `__TAURI__`-specific affordance; the deep-link producer (ITEM-15) must yield a URL
  valid in both web and desktop.

## Open — needs owner approval before phase 3 (candidate descopes)

These are the honest scope edges. Each is either IN (and needs a test) or must be `[DESCOPED]` with a
recorded `[approved: …]` disposition — the gate forbids silent cuts.

1. **ITEM-16** (non-admin built-in call history) — a permission-surface change, arguably its own feature.
2. **ITEM-17** (redaction canonicalisation) — the denylist is **exact-key only**, so `Bearer-Token`,
   `openai_api_key`, `x_auth_token`, `cookie`, `credentials` are NOT redacted even on the "redacted"
   path. That is a security fix that stands alone, independent of the rail.
3. **ITEM-14** (SSE timing + OpenAPI regen) — the only backend/wire change; droppable if we accept
   "no duration until reload".
4. **`bio_mcp` contribution** — **not determinable in-tree**: the module is a pure reverse proxy with
   no tool names in the repo (names come from the external sidecar at runtime). Needs a live probe or
   a name-only degradation (ITEM-6 covers the fallback).
