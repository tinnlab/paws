# PLAN — Background sub-agent PUSH-TO-RESUME (kill the polling loop)

## Summary

Today the chat model must POLL `check_status`/`collect_result` in a loop after
`spawn_background`, because the tool descriptions bake in polling and there is NO
agent-facing completion signal. This feature replaces polling with
**detached + push-to-resume**: the model spawns a background sub-agent, ENDS its
turn, and when a **conversation-bound** sub-agent run reaches terminal
`Completed`, the backend injects the result as a new turn and re-invokes the chat
agent loop via `StreamingService::start_generation`, which streams the
continuation to the user over the existing per-user SSE. The completion event
drives the agent — no polling. (User-decided; not re-litigated.)

BACKEND-ONLY. No new UI surface — the resumed turn renders through the existing
chat SSE + `applyStreamFrame` path. No new permission (reuses `background::use`
for spawn and the chat pipeline's own gating for the resumed turn). No migration
(the sole tunable is a fixed const — see DEC-5).

## Items

- **ITEM-1**: Rewrite the three `tool_list()` tool descriptions in
  `background_mcp/tools.rs`. REMOVE the polling instruction from `collect_result`
  ("poll `check_status` (or retry) until it is complete"). Add to
  `spawn_background`: after spawning, END the turn — do NOT poll; when a
  conversation-bound sub-agent run finishes you are automatically re-engaged in
  this conversation with its result. Reframe `check_status` as an OPTIONAL
  one-off peek, not the completion mechanism. Update the two `note` strings
  returned by `spawn_subagent`/`spawn_sandbox_exec` to match (subagent: "you'll
  be re-engaged automatically"; sandbox_exec keeps the notification-only framing).
- **ITEM-2**: Add a `static BACKGROUND_MCP_CONFIG: OnceCell<Arc<Config>>` +
  `pub fn background_mcp_config() -> Option<Arc<Config>>` accessor to
  `background_mcp/mod.rs`, set once in `BackgroundMcpModule::init` from
  `crate::module_api::app_config(ctx)`. Mirrors `scheduler/mod.rs:30-35,137`
  verbatim. Needed because the completion hook (inside the runner driver closure)
  has no `Config` in scope but `auto_register_extensions` requires `Arc<Config>`.
- **ITEM-3**: New file `background_mcp/resume.rs` with
  `pub async fn resume_conversation_with_result(pool, user_id, conversation_id,
  model_id, task, final_text)`: fetch `background_mcp_config()` (skip + log if
  `None`); wait-for-idle on `chat::stream::registry::is_generating(cid)` with a
  bounded deadline + poll interval (mirrors `scheduler/dispatch.rs:401-407`);
  resolve the active branch via `Repos.chat.core.get_conversation`; build the
  resume `SendMessageRequest` via JSON (`content` = the framed
  "[Background task complete] …" text, `model_id`, `branch_id`, `enable_mcp:true`);
  build the extension registry (`auto_register_extensions`) + `StreamingService`
  and call `start_generation`. Return `Result<(), AppError>`; the caller logs
  Ok/Err and NEVER propagates into the run outcome. Includes a pure, unit-tested
  helper `build_resume_message(task, final_text) -> String` (framing + a
  defensive char cap that appends a pointer to `collect_result` when truncated).
- **ITEM-4**: Wire ITEM-3 into the `BackgroundOutcome::Completed` branch of
  `execute_subagent_run` (tools.rs ~:332). Extract `final_text` (full, not the
  500-char summary); when `conversation_id.is_some()` AND `final_text` is
  non-empty, `tokio::spawn` `resume_conversation_with_result(...)` so it does NOT
  block the runner's terminal transition. The subagent-kind gate is STRUCTURAL —
  the hook lives only in `execute_subagent_run`, never `execute_sandbox_run`
  (sandbox stays notification-only). The completion fires exactly once → the
  resume is idempotent by construction.
- **ITEM-6**: (iteration round) Deploy-level kill switch for push-to-resume.
  Add `Config.background_mcp: Option<BackgroundMcpConfig>` with `resume_enabled:
  bool` (default true, mirroring `BioMcpConfig`/`LitSearchConfig`); read it via
  `resume::resume_enabled_from_config()` and gate it into `should_resume(resume_enabled,
  conversation_id, final_text)`; the `Completed`-branch spawn passes the flag.
  Operator opt-out only (no admin/runtime row, no migration). Preserves current
  behavior by default. (User-directed via the coordinator; see DEC-5.)
- **ITEM-7**: [DESCOPED] (iteration round) Render the injected result as a distinct
  SYSTEM/observation turn instead of a USER message (DEC-1). Investigated →
  BLOCKED: both turn-start paths hardcode `MessageRole::User`, `MessageRole` has
  no observation role, and System-role messages are dropped from the LLM context,
  so it needs non-trivial new shared-pipeline + context-builder + UI plumbing.
  Reported to the coordinator per the pre-agreed STOP-and-report-BLOCKED guardrail;
  the interim keeps the user-role delivery. Cut this round (no code shipped) — see
  the DESCOPED disposition in DECISIONS.md.
- **ITEM-5**: [DEC] Bounded-wait + resume-enable disposition — resolved in
  DECISIONS.md as fixed named consts `RESUME_MAX_IDLE_WAIT` +
  `RESUME_POLL_INTERVAL` (mirroring the scheduler's `TERMINAL_WAIT`/`POLL_INTERVAL`
  fixed consts) and NO separate settings row / kill switch, with rationale
  (internal coordination timeout, security-neutral; the feature is already gated
  by whether the background MCP tools are attached). No migration, no OpenAPI
  change.

## Files to touch

- `src-app/server/src/modules/background_mcp/tools.rs` — ITEM-1 (descriptions +
  notes), ITEM-4 (Completed-branch hook), plus unit tests.
- `src-app/server/src/modules/background_mcp/mod.rs` — ITEM-2 (config OnceCell +
  accessor + `pub mod resume;`), set in `init`.
- `src-app/server/src/modules/background_mcp/resume.rs` — NEW, ITEM-3 (resume fn +
  consts + `build_resume_message` + unit tests).
- `src-app/server/tests/background_mcp/mod.rs` — new integration test module wiring
  (add `mod resume;`).
- `src-app/server/tests/background_mcp/resume.rs` — NEW, integration test proving
  a completed conversation-bound sub-agent injects a NEW turn without polling.

## Patterns to follow

- **Config OnceCell + accessor** → `scheduler/mod.rs:30-35` (`SCHEDULER_CONFIG`
  static + `scheduler_config()`), set in `init` at `:137` via `app_config(ctx)`.
- **Headless turn-start from a detached task** → `scheduler/dispatch.rs:373-407`:
  build `SendMessageRequest` via `serde_json::from_value`, `auto_register_extensions`,
  `StreamingService::new(pool).with_extensions(registry).start_generation(...)`,
  then wait-for-idle loop on `chat::stream::registry::is_generating`. Imports:
  `chat::core::extension::SendMessageRequest`, `chat::core::services::StreamingService`,
  `chat::extension_registration::auto_register_extensions`. Fixed-const wait
  bounds → `dispatch.rs:44-45` (`TERMINAL_WAIT`/`POLL_INTERVAL`).
- **Completion-hook + notify-must-not-fail-the-run** → the existing
  `execute_subagent_run` Completed branch + `post_completion_notification`
  (tools.rs:332-373) — log-and-continue on failure, exactly this feature's rule.
- **Module conventions / built-in MCP** → `background_mcp/tools.rs`,
  `background_mcp/handlers.rs` (unchanged idioms).
- **Integration test seam** → `tests/background_mcp/mod.rs`
  (`spawn_background_runs_a_real_agent_turn_to_completion`) which drives a real
  detached sub-agent to completion with a STUB model (`create_stub_model` →
  "Hello from stub") and NO real LLM key. Reuse the stub-model + conversation +
  jsonrpc helpers.

## UI-surface plan checklist

Not applicable — this feature adds NO UI surface. The resumed turn is a normal
assistant message rendered by the existing chat stream (`applyStreamFrame`), on
the existing `/api/chat/stream` SSE. No page/drawer/card/panel is added; no
frontend workspace file changes. (The phase-3 e2e gate only fires on a
frontend-path diff — this diff touches none, so it is a backend-only lifecycle.)
