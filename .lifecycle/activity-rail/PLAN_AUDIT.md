# PLAN_AUDIT — Activity Rail

Audit of `PLAN.md` against the codebase at `b29adbad5`, before any code is written.
Claims below were re-verified directly; sweep summaries were not taken on trust (one sweep's
"correction" about the `tool_result` catch-all was itself wrong and is corrected here).

## Breakage risk

**The three core files are the most-churned on the branch.** `registry.tsx` and
`mcp/chat-extension/extension.tsx` were both modified 2026-07-26; `ChatMessage.tsx` 2026-07-24,
amid an ongoing sweep (hooks-in-a-loop refactor, lazy-loaded extension surfaces, bounded approval
card). Mitigation is structural, not procedural: **ITEM-1 adds a registry beside
`contentTypeRegistry` rather than rewriting `renderContent`**, so a concurrent edit to renderer
resolution merges cleanly. Rebase before each gate.

**Retiring the group card is the real breakage surface.** `McpToolUseGroup.contentSpan`
(`extension.tsx:400-408`) currently consumes `tool_result` blocks owned by other extensions. Any
window where the rail segments a span but the group card still claims `tool_use` yields
double-rendering or dropped blocks. ITEM-5 removes the class of bug by computing the span once;
the port must be atomic within the commit, not staged.

**Behaviour change with an existing test surface**: ITEM-17 redacts arguments that the chat card
renders verbatim today. Any e2e asserting on a rendered argument value will change meaning. Must be
audited during implementation, not discovered at phase 8.

**`observation` must not be swept in.** `ChatMessage.tsx:106-111` computes `isObservation` and
forces `renderAsUser=false`; it rides a user-role message but is a *message*, not a step. Segmentation
must exclude it explicitly (design § Explicitly out of the rail).

## Pattern conformance

- Contribution registry mirrors the existing `contentTypes` + `contentMatch`/`contentSpan` statics
  idiom (`registry.tsx:926-975`) — same registration shape, same first-wins discipline. **Conforms.**
- Rail row mirrors `ActivityRow` (`workflow/.../AgentActivityTimeline.tsx:38-119`), which already
  ships icon + label + status + "Show details". **Conforms** — and reusing it is what lets ITEM-23
  delete the central map instead of extending it.
- Detail panel mirrors the two existing tool-result panel openers (`lit:${tool_use_id}`,
  `kb:${file_id}:${page}:${char_start}`). **Conforms.**
- Status vocabulary reused verbatim (`chat/core/tool-status.ts:27-33`). **Conforms** (INV-9).
- Index migration mirrors `tool_use_approvals`' own `UNIQUE (message_id, tool_use_id)` — a direct
  in-module precedent for the column pair. **Conforms.**

## Migration collisions

**None.** Verified: `src-app/server/migrations/` does not exist; migrations are per-module and
timestamp-named, 99 files, highest `202607191300`. The single new migration (ITEM-13) lands in
`modules/mcp/migrations/` with a later timestamp. `mcp_tool_calls` currently has five indexes
(`conversation_id`, `created_at`, `server_id`, `(user_id, created_at DESC)`, `workflow_run_id`) —
**none on `tool_use_id` or `message_id`**, so the index is genuinely required. The
`unique_tool_use UNIQUE (message_id, tool_use_id)` constraint at line 165 belongs to
`tool_use_approvals`, NOT `mcp_tool_calls` — checked, because if it had been on `mcp_tool_calls` the
index would already exist and ITEM-13 would shrink.

## OpenAPI regen

**REQUIRED.** Verified: `McpToolCompleteData` carries `result` (truncated to 2000 chars) and
`is_error`, and **no timing field of any kind**. ITEM-14 adds `started_at`/`duration_ms`, a backend
response-type change ⇒ `just openapi-regen` for **both** binaries, `types_ts_parity` golden test kept
green. ITEM-13's new query params are additive on an existing endpoint but still regen-visible.

---

## Item verdicts

- **ITEM-1** — verdict: CONCERN — additive registry is the right shape, but `registry.tsx` changed 2026-07-26; rebase before each gate and keep the change purely additive.
- **ITEM-2** — verdict: CONCERN — `ChatMessage.tsx:143-163` run-loop is the correct host and already runs a `normalizeToolResultOrder` pre-pass, but segmentation must explicitly exclude `observation` (`:106-111`) and user attachments (`:117-133`).
- **ITEM-3** — verdict: PASS — exporting a host primitive to extensions is an established pattern (`CollapsibleBlock` consumed by mcp/file/skill).
- **ITEM-4** — verdict: PASS — `ToolStatusKey` already covers all six states incl. `timeout`; reuse is a deletion, not an addition.
- **ITEM-5** — verdict: PASS — computing the span once structurally removes the `shouldWrapRun` dual-call invariant (`toolRun.ts:45-54`).
- **ITEM-6** — verdict: PASS — degradation is mandatory and verified necessary: `cap_structured_content` drops oversized payloads (`helpers.rs:178-200`) and `ask_user`/`delegate`/`schedule_next` emit none.
- **ITEM-7** — verdict: PASS — inverse disclosure; no technical obstacle.
- **ITEM-8** — verdict: PASS — `MessageViewState` already persists `CollapsibleBlock` and `InlineFilePreview` state by key; the rail joins an existing mechanism.
- **ITEM-9** — verdict: PASS — `timed_out` from code_sandbox is the only in-tree producer of `timeout`; failure states are otherwise available from status.
- **ITEM-10** — verdict: CONCERN — the force-open invariant exists (`toolRun.ts:76-81` `deriveGroupOpen`) but is currently entangled with the group card being retired; it must be re-established on the rail in the same commit, or approvals become hideable.
- **ITEM-11** — verdict: PASS — `renderContent({content})` with no neighbour list is the documented non-recursion guard (`registry.tsx:955-963`).
- **ITEM-12** — verdict: PASS — panel contract is serializable-by-design with 4 existing types and 5 open-from-message call sites.
- **ITEM-13** — verdict: PASS — `message_id uuid`, `tool_use_id varchar(255)`, `duration_ms bigint` all exist; no covering index; owner-scoped repository pattern to mirror at `repository.rs:89-133`.
- **ITEM-14** — verdict: CONCERN — verified no timing on the frame today, so the work is real; cost is a dual-binary regen plus the parity golden test, and it is the only wire change in the feature.
- **ITEM-15** — verdict: PASS — the `#message-<id>` consumer already exists (`ConversationPage.tsx:761-782`) with no producer; adding one is additive.
- **ITEM-16** — verdict: CONCERN — `isEditable={!server.is_system}` (`McpServersSettings.tsx:191`) gates the whole action row, not just the Calls tab, so the fix must open the tab WITHOUT opening edit affordances on system servers. Owner-scoping in `repository.rs:120,196` already prevents cross-user reads, so the data boundary holds.
- **ITEM-17** — verdict: CONCERN — confirmed exact-key matching (`record.rs:58-61`, `SECRET_KEYS.contains(&k)`), and the list omits `cookie`, `credentials`, `x_auth_token`, `openai_api_key`; `Bearer-Token` also misses because only the bare `bearer` key is listed. Tension with INV-2 recorded in DESIGN_FIDELITY.
- **ITEM-18** — verdict: PASS — all five renderers keep their components as `renderDetail`; catch-all order verified as kb@70 (has `contentMatch`) → workflow@74 → **literature@75 (no `contentMatch` — the real catch-all)** → file@80.
- **ITEM-19** — verdict: CONCERN — six tool families, all with real structured shapes, but `memory_mcp` stringifies its text channel (`handlers.rs:225`) and `files_mcp` image/binary reads emit no `structuredContent`; both must ride ITEM-6's degradation.
- **ITEM-20** — verdict: PASS — shapes confirmed for background/control/skill/js_tool/tool_result.
- **ITEM-21** — verdict: CONCERN — `delegate`/`schedule_next` return `structured_content: None`, and `task_update` duplicates the `taskListChanged` SSE frame; without de-dup the rail double-reports.
- **ITEM-22** — verdict: PASS — markers are stamped at `mcp/chat_extension/mcp.rs:3155-3185` and consumed at `scheduler/dispatch.rs:426-440`; `cancelled` (neutral) is the correct status, not `failed`.
- **ITEM-23** — verdict: PASS — deleting the central map is the point of the feature; `AgentActivityTimeline` already imports `ToolStatusIcon` from chat, so the direction of dependency is already correct.
- **ITEM-24** — verdict: PASS — removes three cross-module imports. Note `knowledge-base`'s is already unreachable (its `contentMatch` scopes it), so that one is dead-code removal; `literature`'s is a live fallback.
- **ITEM-25** — verdict: PASS — both couplings are hardcoded literals with no dynamic dependency.
- **ITEM-26** — verdict: PASS — gallery coverage must include the 390px populated state (plan checklist).
- **ITEM-27** — verdict: CONCERN — seed anchors verified (`:892`, `:1258`, `:1402`) and ordinals are `numeric`, but a **live "Running…" step is not seedable** (SSE-only); the streaming state must be proven by a real-LLM/stub e2e instead. Conversation `11111111-…` must stay present (gallery assertion).
- **ITEM-28** — verdict: CONCERN — verified `bio_mcp/handlers.rs` is a pure proxy with no tool names in-tree, so the probe is genuinely the only way; it needs a live sidecar and therefore cannot run in a hermetic test. Its output must be captured as a fixture so the contribution itself is testable offline.
