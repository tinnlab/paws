# PLAN_AUDIT — ask-user-stringified-schema

Audited against the worktree at `d53db2d11` (`origin/feat/agent-core`). Every
line/behaviour claim below was read out of the tree, not inferred.

## Breakage risk

**The one real risk is over-coercion**: rewriting a string the caller MEANT to be
a string. The plan confines coercion to *named arguments whose tool descriptor
declares `type: object`/`type: array`* and never recurses, which is what keeps it
safe. Verified per site that the argument is declared object/array:

- `ask_user.schema` — `elicitation_mcp/tools.rs:22-25` declares `"type": "object"`.
- `invoke_capability.{path_params,query,body}` — `sdk/crates/ziee-control-mcp/src/tools.rs:40-68`
  declares all three `"type": "object"`.
- `spawn_background.spec` — `background_mcp/tools.rs:58-79` declares `"type": "object"`.
- `run_from_workspace.inputs` — `workflow_mcp/tools.rs:251-255` declares `"type": "object"`.
- `search_knowledge.knowledge_base_ids` — `knowledge_base/tools.rs:20-24` declares `"type": "array"`.
- citations `items`/`ids` — `citations/tools.rs:26-30`, `:88-97` declare arrays.
- lit_search `queries`/`ids`/`record_sets`/`decisions` — arrays in `lit_search/tools.rs`.

Explicitly NOT touched, and each checked to be genuinely scalar so no caller
breaks: `run_js.script` (`js_tool/tools.rs:31-40`, a string that will routinely
contain JSON-looking text — coercing it would be a severe bug), every
`code_sandbox`, `files_mcp`, `memory_mcp`, `web_search`, `skill_mcp`,
`tool_result_mcp` argument, and `invoke_capability.operation_id`.

Second risk: **`workflow_mcp::coerce_inputs` is applied to the WHOLE arguments
object** at `tools.rs:361` for `wf_<slug>` tools, not just to an `inputs` field.
A `wf_<slug>` call whose entire arguments blob is stringified is exactly the same
defect, so coercing there is correct — but it means the change is not confined to
a named field at that one call site. Called out so the phase-6 audit looks at it
deliberately. No caller breaks: the function's only non-error output today is
`Object` or `Null`, and both are preserved unchanged.

Third risk: **ITEM-10 widens `validate_body`** to check a non-object body even
when the operation declares no `request_schema`. Today `invoke_capability` skips
validation entirely in that case. Verified at `control_mcp/handlers.rs:1167-1171`
(the `if let (Some(schema), Some(body))` guard) that a schema-less operation
never validates. Widening it can only reject bodies that would have produced a
422 from the real route anyway — it cannot reject a body the route would have
accepted, because axum's `Json<T>` extractor requires an object for every typed
body. Low risk, but it IS a behaviour change on a path the plan otherwise only
improves messages on.

Fourth risk: **ITEM-7 changes untrusted-ingress behaviour** (`cap_requested_schema`
is called from three external-server sites). The ordering is
raw-size-cap → decode → marker-strip, so an oversized string is dropped BEFORE
being parsed and the marker strip still runs last. INV-6 is preserved by
construction, and the existing test
`cap_requested_schema_strips_forged_ask_user_marker` (`models.rs:174`) continues
to pin it. A new test must pin the string-encoded forgery attempt too.

## Pattern conformance

- **ITEM-1/2 (the helper) → `common/tokens.rs`.** Confirmed `common/mod.rs`
  currently declares `embedded, macros, secret, tokens, r#type, types` and
  re-exports from `r#type`. Adding `pub mod tool_args;` matches exactly. The
  `utils/` alternative was rejected in DESIGN §4: that dir is
  `cancellation.rs`/`http_body.rs`/`url_validator.rs`/`git/` — I/O and network
  infra, not pure data helpers.
- **ITEM-3/4/5 → the existing `helpers.rs:292-324` block.** The guard's comment
  ("Measure the RAW input schema BEFORE `cap_requested_schema`: that helper
  replaces an oversized schema with a tiny error-marker object, so checking the
  capped value would never see the original size and the guard would never fire")
  is load-bearing and the plan preserves it verbatim, inserting only the decode.
- **ITEM-5 message quality → `helpers.rs:310-317`.** That message is the stated
  bar and is already in the right shape.
- **ITEM-11 (citations) →** the module's own `JsonRpcError::invalid_params`
  convention, e.g. the `too many items (N); cap is M. Split into batches.`
  message at `citations/handlers.rs:369-372`, which already meets the §2.5 bar.
  New messages match that voice.
- **ITEM-16/17 (FE) →** `WorkflowElicitForm.tsx:462` (`wf-elicit-alert`) for the
  notice, and `ElicitationFormContent.tsx:271` (the `cancelled` card, whose copy
  *"This form can no longer be submitted — the request expired or was cancelled."*
  is the nearest existing degraded-state voice).
- **e2e fixture → `tests/e2e/llm/helpers/repository-health-mock.ts`.** Its header
  states the exact rationale (server-side reqwest cannot be `page.route()`d).
  Response shapes port from `server/tests/common/stub_chat.rs:777-855`.
- **Tool-capable model row → `control-llm-helpers.ts:102`.** Confirmed
  `createModelViaAPI` (`tests/common/provider-helpers.ts:99`) hardcodes
  `function_calling:false` and never sets `tools`, so it CANNOT be used.

## Migration collisions

**None.** This branch adds no migration. Migrations are per-module
(`modules/*/migrations/`); the highest existing filename across `src-app` is
`202607191300_agent_delegate_enabled.sql`. No new permission, so A9/A10 do not
apply. See BASE.md.

## OpenAPI regen

**Not required.** Verified:

- No `#[derive(JsonSchema)]` type changes shape. `RespondToElicitationRequest`
  (`mcp/elicitation/models.rs:62-69`) keeps `content: Option<serde_json::Value>`
  — ITEM-8 changes the *value* flowing through it and the handler's validation,
  not the type.
- `ElicitationStartedNotification.requested_schema` and
  `SSEChatStreamMcpElicitationRequiredData.requested_schema` are already
  `serde_json::Value`; only the value changes.
- Every tool surface touched (`ask_user`, `invoke_capability`, citations,
  background, workflow, knowledge_base, lit_search) is **JSON-RPC served from an
  untyped `axum::response::Response`**, so none of it is in `openapi.json`.
- No new/changed REST handler signature.

Therefore no `just openapi-regen`, and `openapi::emit_ts::tests::types_ts_parity`
is unaffected. If implementation proves otherwise, the drift log records it and
the regen runs for BOTH binaries.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — `common/mod.rs` confirmed; `common/tokens.rs` is a
  direct structural precedent; no existing helper duplicates this (repo-wide grep
  for `coerce_json`/`unwrap_json_string`/`parseMaybeJson` returned zero hits).
- **ITEM-2** — verdict: PASS — centralizing the message text in the helper is what
  makes §2.5 affordable across 13 call sites; without it each site would ship its
  own quality.
- **ITEM-3** — verdict: PASS — `helpers.rs:302-305` confirmed verbatim as the
  defect site; `.get("schema").cloned()` returns `Some(Value::String(..))`.
- **ITEM-4** — verdict: CONCERN — the "oversized *inflated* object" leg is
  **provably unreachable for JSON**: a JSON-encoded string of a value is always
  LONGER than the value's own serialization (added quotes + escaped inner
  quotes), and JSON has no expansion primitive (no YAML-style anchors), so
  `len(raw) >= len(decoded)` always. The raw-first check therefore already
  subsumes it. The plan must NOT ship a test that pretends to exercise an
  unreachable branch (that would be a hollow/cosmetic test under A4). Resolution
  carried into DECISIONS (DEC-6): keep BOTH measurements as a real guard (cheap,
  and correct independent of that argument), and test the leg as the ORDERING
  INVARIANT `len(raw) >= len(decoded)` plus a real oversized-encoded rejection —
  not as a fabricated "inflating" input that cannot exist.
- **ITEM-5** — verdict: PASS — all seven rejection paths located:
  message-empty (`helpers.rs:289-291`), oversized (`:309-317`), plus the four new
  decode causes and the zero-properties case. The zero-properties decision is
  asymmetric (error for an explicitly-supplied `ask_user` schema, valid for an
  absent one and for external servers) — recorded and justified in DESIGN §3.3,
  and it is what preserves INV-8's "absent argument behaves exactly as before".
- **ITEM-6** — verdict: PASS — `stamp_ask_user_marker` (`helpers.rs:216-224`) and
  its ordering after `cap_requested_schema` (`:322-324`) confirmed; the plan does
  not move or weaken it.
- **ITEM-7** — verdict: CONCERN — this is the item that changes behaviour for
  UNTRUSTED external input, so it carries the most security weight. Mitigations
  are in the plan (order: raw-cap → decode → strip) and the existing forged-marker
  test stays green; a new test must cover the string-encoded forged marker
  explicitly. Passing to phase 6 as a named focus area rather than blocking.
- **ITEM-8** — verdict: PASS — `respond_to_elicitation` (`mcp/elicitation/handlers.rs:24-98`)
  confirmed to accept any `Value` as `content` and to forward it both to the
  registry (→ the model via `ask_user_tool_result`'s `to_string`) and to
  `update_content_json`. Our own FE always sends an object
  (`resolveElicitation` is typed `content?: Record<string, unknown>`), so this is
  hardening a public-API ingress, not fixing an observed break — stated as such.
- **ITEM-9** — verdict: PASS — all three fields confirmed:
  `path_params: HashMap<String,String>` hard-fails serde (`:1147`); `query`
  silently fails the `if let Some(Value::Object(q))` match (`:1182`); `body` is
  `.json()`-ed as a string literal (`:1208-1210`).
- **ITEM-10** — verdict: CONCERN — see "Breakage risk" above. Behaviour change
  beyond message quality. Accepted because it can only convert a confusing
  downstream 422 into a precise upstream error, but flagged for the phase-6
  api-contract angle.
- **ITEM-11** — verdict: PASS — all four citations sites confirmed at
  `handlers.rs:205-216` (`remove_citations.ids` → `unwrap_or_default()` → *"0
  citation(s) deleted."* as SUCCESS), `:292-297` (`format_citations.items` →
  `unwrap_or_default()` → falls through to formatting the whole library at
  `:306`), `:359-372` (`parse_items` → *"missing `items` array"* when present),
  and `models.rs:98` (`csl: Option<Value>`). The two silent-wrong-answer paths
  are the strongest independent justification in the whole plan.
- **ITEM-12** — verdict: PASS — `background_mcp/tools.rs:169-174` confirmed;
  `spec` is a bare `Value` so a string survives `ok_or_else` and fails later with
  a misleading `BACKGROUND_TASK_REQUIRED`.
- **ITEM-13** — verdict: PASS — `workflow_mcp/tools.rs:381-389` confirmed; the
  function is literally named `coerce_inputs` and does not coerce. Its existing
  test (`tools.rs:1412-1416`) pins `coerce_inputs(&json!("nope")).is_err()`,
  which stays TRUE under the new contract (`"nope"` is not decodable JSON), so
  the test does not even need changing — verify at implementation time and record
  it as drift if it does.
- **ITEM-14** — verdict: PASS — `knowledge_base/handlers.rs:109-117` + `:144-145`
  confirmed; a stringified `knowledge_base_ids` hard-fails `from_value` and
  destroys the otherwise-graceful `_ => conversation-attached KBs` fallback at
  `:149-155`.
- **ITEM-15** — verdict: PASS — the five typed-`from_value` sites confirmed
  (`lit_search/handlers.rs:163/178`, `:425/435`, `:491/503`, `:580/591`,
  `:741/755`), plus the two inner-element paths at `:528` (`Err(_) => dropped += 1`)
  and `:599-604` (`else { skipped += 1; continue; }`).
- **ITEM-16** — verdict: PASS — `ElicitationFormContent.tsx:147-149` confirmed as
  the only place `properties`/`required` are read, and `new Set(schema?.required || [])`
  confirmed as a genuine render-crash vector for a non-iterable `required`. Also
  confirmed no error boundary covers message content (only
  `StreamdownErrorBoundary`, scoped to markdown), so the crash blanks the tree.
  Confirmed `src-app/desktop/ui/src` has NO `modules/mcp` — no R2-3 mirror.
- **ITEM-17** — verdict: PASS — placing the guard BEFORE the `isRichAskUser`
  branch (`:296-317`) covers both the wizard and flat paths with one edit and
  leaves `AskUserWizardContent` untouched. Confirmed the wizard's own
  zero-entries handling (`AskUserWizardContent.tsx:316-322`) degenerates
  `isLast` to true and shows Submit — i.e. today it fabricates an answer, which
  is exactly what INV-7 forbids.
- **ITEM-18** — verdict: CONCERN — `npm run check` chains `check:state-matrix` +
  `check:gallery-coverage`, and the existing matrix
  (`dev/gallery/stateMatrix.generated.ts:2499/:2526`) has **no `empty` signal**
  for these components because today the empty case is an unnamed `?.`/`|| {}`
  fallthrough. Introducing a NAMED branch will make the generator emit a new
  signal, so the gallery cell is REQUIRED, not optional — budgeted as its own
  item so it cannot be forgotten at phase 8. Also confirmed
  `stateCoverage.ts:282` currently skips `AskUserWizardContent:error`; that skip
  may need revisiting once the named state exists.

**No `BLOCKED` verdicts.** Three `CONCERN`s (ITEM-4, ITEM-7, ITEM-10, ITEM-18 —
four) are carried into DECISIONS and named as phase-6 focus areas.
