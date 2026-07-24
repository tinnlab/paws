# PLAN_AUDIT — bg-push-resume (audited against the codebase)

Verified against the base worktree at `ec00a14de`. Every call-chain claim below
was read from source (file:line cited).

## Breakage risk

- **ITEM-1 (tool descriptions + notes)** — pure JSON string edits in
  `tool_list()` + the two `note:` fields. No caller depends on the description
  TEXT. Two unit tests assert tool STRUCTURE (`tool_list_advertises_the_trio`,
  `spawn_kind_enum_advertises_sandbox_exec`) — they check names/required/enum, NOT
  description prose, so they stay green. Low risk. The `note` strings are returned
  to the model only; no test asserts their content.
- **ITEM-2 (config OnceCell)** — additive `static` + `pub fn` + one `.set()` line
  in `init`. `OnceCell::set` returns `Result`; discard with `let _ =` exactly as
  `scheduler/mod.rs:137` does. Cannot break existing callers (new symbol). The
  `once_cell` crate is already a dependency (scheduler uses it). No risk.
- **ITEM-3 (resume.rs)** — new file; new `pub async fn` + new `pub mod resume;`.
  Zero existing callers. `start_generation` is `pub` on `StreamingService`
  (streaming.rs:792) and already invoked from `scheduler/dispatch.rs:394` from a
  detached task — the exact precedent. `auto_register_extensions(pool, config)`
  is `pub` (extension_registration). `is_generating(cid)` is a free `pub fn`
  (registry.rs:295). All imports confirmed present. No risk to existing code.
- **ITEM-4 (Completed-branch hook)** — inserts a `tokio::spawn(...)` INSIDE the
  existing `if let BackgroundOutcome::Completed` block in `execute_subagent_run`,
  AFTER the existing `post_completion_notification` call. It does not change the
  function's return (`outcome` is still returned unchanged), so the runner's
  terminal transition is unaffected. The spawn is detached → cannot block or fail
  the run. Risk: capturing borrowed `&str`/`&PgPool` into a `'static` spawn — must
  clone (`pool.clone()`, `task.to_string()`, `final_text` owned String) before the
  spawn. Called out in DECISIONS (DEC-6) and enforced by `cargo check`.

## Pattern conformance

- **ITEM-2** mirrors `scheduler/mod.rs:30-35` (`SCHEDULER_CONFIG` static +
  `scheduler_config()` accessor) and `:137` (`let _ = SCHEDULER_CONFIG.set(...)`
  in `init`). `app_config(ctx)` is `crate::module_api::app_config`
  (module_api/mod.rs:20). Exact conformance.
- **ITEM-3** mirrors `scheduler/dispatch.rs:373-407` — build `SendMessageRequest`
  via `serde_json::from_value`, `auto_register_extensions`,
  `StreamingService::new(pool).with_extensions(registry)`, `start_generation`,
  then the `while is_generating(cid) { sleep }` wait-for-idle with fixed-const
  bounds (`dispatch.rs:44-45`). Difference from scheduler: the resume does NOT set
  `unattended:true` (this is the user's foreground conversation, not an unattended
  fire) — justified in DEC-2. Conforms.
- **ITEM-4** mirrors the sibling `post_completion_notification` gate already in
  the same branch (notify-must-not-fail-the-run; log + continue). The subagent
  gate is structural (hook only in `execute_subagent_run`), matching the existing
  separation between `execute_subagent_run` and `execute_sandbox_run`. Conforms.
- **Tests** mirror `tests/background_mcp/mod.rs`'s stub-model lifecycle test
  (`create_stub_model` → real detached turn, no LLM key) and the in-source
  `#[cfg(test)]` unit-test convention in `tools.rs`. Conforms.

## Migration collisions

None. This feature adds NO migration (DEC-5: the only tunable is a fixed const).
Highest existing migration `202607191300_agent_delegate_enabled.sql` is untouched.
No collision surface.

## OpenAPI regen

Not required. No handler signature change, no new REST route, no
`#[derive(JsonSchema)]` type change. `tool_list()` returns a runtime MCP JSON
value, not an OpenAPI schema. Neither `ui/` nor `desktop/ui/` regen is implied;
the diff is not treated as UI work by the phase-3/8 frontend gates.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — pure string edits; structural unit tests unaffected; no caller depends on description prose.
- **ITEM-2** — verdict: PASS — additive static+accessor mirroring scheduler/mod.rs verbatim; `once_cell` already a dep; no migration/regen.
- **ITEM-3** — verdict: PASS — new file, new symbols; all imported APIs (`start_generation`, `auto_register_extensions`, `is_generating`, `SendMessageRequest`) confirmed `pub` and precedented by scheduler/dispatch.rs.
- **ITEM-4** — verdict: CONCERN — must clone all borrowed captures (`pool`, `task`, `final_text`, `system` if used) into the `'static` `tokio::spawn`; resolved by owning them before the spawn. Otherwise sound; no behavioral break to the runner.
- **ITEM-5** — verdict: PASS — fixed named consts mirroring the scheduler's `TERMINAL_WAIT`/`POLL_INTERVAL`; no migration, no settings row (rationale in DEC-5).
- **ITEM-6** — verdict: PASS — (iteration) deploy kill switch mirrors the `BioMcpConfig`/`LitSearchConfig`/`JsToolConfig` `Option<XxxConfig>`+`enabled`-bool convention verbatim; `Config` is deployment YAML (Debug+Deserialize+Clone, no Serialize/JsonSchema) so NO OpenAPI regen and NO migration; the guard sits in the resume gate (`should_resume`/`Completed`-branch spawn) per CODING_GUIDELINES §16; default true preserves behavior.
- **ITEM-7** — verdict: PASS — (iteration 2, UN-DESCOPED) the `observation` content type mirrors the existing `thinking` content-type seam of the text extension exactly (variant in `MessageContentDataVariants` + `TextContent` + `handled_content_types` + `process_content_for_llm`); wire role stays `user` (set by the message row's role, not the content type), so the model sees it with ZERO new turn-start plumbing. The `#[serde(skip)]` injection flag is server-internal (no OpenAPI/client surface, no spoofing). Verified against streaming.rs:1032/1134 (System dropped; user role → Role::User) and transcript.rs:247 (agent-core reuses the shared converter).
- **ITEM-8** — verdict: PASS — the FE renderer mirrors `ThinkingContent` + the registry `contentTypes` map (`extension.tsx`); the bubble-geometry gate (`renderAsUser`) is a minimal, localized change to `ChatMessage.tsx` — the block-type→card dispatch already exists (`renderContent`). No new slot/registry invented.
- **ITEM-9** — verdict: PASS — mechanical regen; `MessageContentData` union gains `Observation`; the golden `types_ts_parity` test regenerates from the reviewed source, run for BOTH `ui/` + `desktop/ui/` via `just openapi-regen`.
