# PLAN — control-mcp-e2e-coverage

## Design source

Realizes `.lifecycle/control-mcp-e2e-coverage/DESIGN.md` §2 (guiding rule), §3
(FIX 1 — multi-word capability search), §4 (FIX 2 — title generation never runs)
and §5 (BUILD — the e2e matrix that would have caught this). §6 records the two
root causes verified during this phase-1 research pass (a live curl reproduction
of the title-budget starvation against the same bridge + model the `:1530`
instance runs).

## Invariants

Lifted VERBATIM from the design (§2–§5).

- **INV-1**: a test must fail if the feature breaks
- **INV-2**: If no LLM is configured at all, the spec may skip — but it must NOT skip merely because Anthropic specifically is absent.
- **INV-3**: the model discovers the op via `list_capabilities` (do NOT name the operation id in the prompt)
- **INV-4**: the mutating invoke is FORCED through the approval card even in an auto-approve chat
- **INV-5**: Approve → **the entity really exists via the REST API**; **deny → nothing created**
- **INV-6**: a user LACKING the permission → the op is not offered/denied
- **INV-7**: tokenize on whitespace and require ALL terms to match (each term may match any field), and order results by relevance so `Project.create` ranks first for "create project". Keep single-term behavior at least as good as today.
- **INV-8**: add a test that fails if titles stop being generated

## Items

### FIX 1 — multi-word capability search

- **ITEM-1**: Replace the whole-phrase `.contains(q)` filter in
  `control_mcp/handlers.rs::list_capabilities` with a tokenized matcher:
  whitespace-split the lowercased query into terms; an operation matches only
  when EVERY term matches at least one field (`operation_id`, `summary`, `tags`).
  Empty/whitespace-only query keeps the current "everything" behavior.
- **ITEM-2**: Rank matches by relevance instead of `operation_id` ASC: score each
  term against the best field it hits (operation_id segment-exact > operation_id
  substring > tag exact > summary word > summary substring), sum across terms,
  sort score DESC then `operation_id` ASC (deterministic tie-break). `Project.create`
  must rank first for `"create project"`. The `tag` filter, permission filter,
  `MAX_LIST_RESULTS` truncation and the `total`/`truncated`/`returned` structured
  fields are unchanged.
- **ITEM-3**: Unit-test the matcher directly (pure functions, no MCP, no DB),
  including the EXACT failing query `"create project"`, single-term parity with
  the old behavior (`"project"` / `"create"` still match everything they did),
  case-insensitivity, and the empty-query passthrough.
- **ITEM-4**: Tier-3 integration test over the real JSON-RPC surface:
  `list_capabilities{query:"create project"}` returns a non-empty list whose FIRST
  operation is `Project.create` — the live-session repro, end to end.

### FIX 2 — title generation never runs

- **ITEM-5**: Raise `TITLE_MAX_TOKENS` 512 → 4096 in
  `chat/extensions/title/title.rs` with the measured rationale (§6 table) in the
  doc-comment, and ask the provider to skip reasoning where the unified request
  supports it (`thinking: ThinkingConfig::disabled()`) — a no-op for
  OpenAI-compatible bridges, a real saving for Anthropic/Gemini.
- **ITEM-6**: One escalated retry: when the title stream ends
  budget-exhausted (`finish_reason` ∈ `length`/`max_tokens`) with no usable text,
  retry the SAME request ONCE at `TITLE_RETRY_MAX_TOKENS` (8192) before soft-failing.
  Reasoning length is unbounded, so a bigger constant alone is a fix for today's
  model, not for the failure MODE. Extracted as a pure decision fn so it is
  unit-testable.
- **ITEM-7**: Update `tests/chat/title_test.rs::title_request_carries_the_reasoning_safe_token_budget`
  to the new constant, and add stub-level coverage of the escalated retry
  (budget-exhausted first call → second call at the larger budget → title stored).
- **ITEM-8**: Add the test that would have caught the live bug: a REAL-LLM
  integration test driving a real first exchange through the configured test LLM
  and asserting the conversation ends up TITLED. Fails if titles stop being
  generated. Skips only when no LLM is configured at all (INV-2).

### BUILD — real e2e coverage of the control surface

- **ITEM-9**: Shared Rust seam `configured_test_llm()` in `tests/chat/helpers.rs`
  (next to the existing `test_provider_base_url`): resolves the configured test
  LLM from the OpenAI seam, the Anthropic seam, or the global
  `ZIEE_TEST_LLM_BASE_URL`, returning provider name/type + key + base_url + model
  name. `None` only when NOTHING is configured.
- **ITEM-10**: Re-gate `tests/control_mcp/real_llm_test.rs` on `configured_test_llm()`
  instead of `ANTHROPIC_API_KEY`, and drive whichever provider it resolves.
- **ITEM-11**: Shared TS seam `tests/e2e/control/helpers/control-llm-helpers.ts`:
  `configuredTestLlm()` (same resolution order as ITEM-9) + `setupControlChat()`
  which creates the provider, a **tool-capable** model row (`capabilities.tools=true`
  — `createModelViaAPI` forces `function_calling:false`, so the current spec could
  never have attached the control tools even with a key), assigns the provider to
  Administrators and opens a new chat on that model.
- **ITEM-12**: Re-gate `tests/e2e/control/control-tool-in-chat.spec.ts` on
  `configuredTestLlm()` (INV-2) and drop the vendor-specific Anthropic setup.
- **ITEM-13**: The natural-language DISCOVERY→MUTATION journey e2e: prompt
  "create a new project called <Foo>" with NO operation id, assert the model
  actually called `list_capabilities` (the tool-call is visible in the
  conversation transcript via REST), the mutating invoke raised the approval card
  in an auto-approve chat, Approve → the project EXISTS via `GET /api/projects`,
  and the chat reflects it.
- **ITEM-14**: Table-driven approve leg over representative mutating ops —
  `Project.create` (ITEM-13), `Assistant.create`, `MemorySettings.update`
  (a settings update) — each from a natural-language prompt: approval forced →
  approve → the entity/state really changed via REST.
- **ITEM-15**: Table-driven deny leg (`Project.create`, `Assistant.create`):
  approval card appears → Deny → nothing created. Keeps and strengthens the
  existing `denying the control write leaves nothing created` test rather than
  replacing it (it becomes the `Assistant.create` row of the table).
- **ITEM-16**: Negative-permission e2e (`[negative-perm]`): a user holding
  `control::use` but NOT the op's permission drives the same natural-language
  prompt — the op is NOT offered (the control surface's own
  `list_capabilities`/`describe_capability` omit it for that user) and nothing is
  created.
- **ITEM-17**: A guard that pins INV-1/INV-2 executably: a test asserting no spec
  under `tests/e2e/control/` gates on a single vendor's key
  (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` alone). Without it, the next author can
  silently reintroduce the exact "covered by tests that never execute" state.

## Files to touch

- `src-app/server/src/modules/control_mcp/handlers.rs` — ITEM-1/2/3 (matcher + its `#[cfg(test)]`)
- `src-app/server/src/modules/chat/extensions/title/title.rs` — ITEM-5/6 (+ unit tests)
- `src-app/server/tests/control_mcp/mod.rs` — ITEM-4
- `src-app/server/tests/control_mcp/real_llm_test.rs` — ITEM-10
- `src-app/server/tests/chat/helpers.rs` — ITEM-9 (additive helper only)
- `src-app/server/tests/chat/title_test.rs` — ITEM-7
- `src-app/server/tests/chat/title_real_llm_test.rs` (new) — ITEM-8
- `src-app/server/tests/chat/mod.rs` — register the new test module
- `src-app/ui/tests/e2e/control/helpers/control-llm-helpers.ts` (new) — ITEM-11
- `src-app/ui/tests/e2e/control/control-tool-in-chat.spec.ts` — ITEM-12/13/14/15
- `src-app/ui/tests/e2e/control/control-negative-perm.spec.ts` (new) — ITEM-16
- `src-app/ui/tests/e2e/control/control-spec-gating.spec.ts` (new) — ITEM-17

No migration, no new permission, no REST/type change ⇒ **no OpenAPI regen**, no
`SyncEntity`, no desktop `ui/` override to mirror. No `src-app/ui/src/**` change
⇒ no new UI surface, no gallery state, no `gate:ui` obligation (the diff touches
`src-app/ui/tests/**` only).

## Patterns to follow

- **Matcher (ITEM-1/2/3)** — mirror the existing pure-function-plus-`#[cfg(test)]`
  style already in `control_mcp/handlers.rs` (`needs_approval_decision` is
  extracted from `control_call_needs_approval` precisely so the security-critical
  decision is unit-testable without the global `OnceLock`). Same shape: pure
  `query_terms` / `op_match_score`, thin call site.
- **Title fix (ITEM-5/6)** — mirror the file's own `build_title_request` /
  `is_budget_exhausted` extraction convention (documented as "extracted so the
  token budget and prompt shape are unit-testable without a provider").
- **Real-LLM Rust tests (ITEM-8/10)** — mirror `tests/chat/helpers.rs`'s
  `test_provider_base_url` seam and the existing
  `tests/control_mcp/real_llm_test.rs` setup shape.
- **Real-LLM e2e (ITEM-11..16)** — mirror
  `tests/e2e/chat/helpers/agent-llm-helpers.ts` (`HAS_BRIDGE` / `BRIDGE_MODEL` /
  `createBridgeToolModel`) — the codebase's existing, working answer to "run a
  real-LLM spec against the configured bridge, skip cleanly when unset".
- **Negative-perm e2e (ITEM-16)** — mirror the A10 pattern used elsewhere in
  `tests/e2e/`: log in as a user LACKING the permission, assert absence.

## UI-surface plan checklist

**Not applicable — this feature adds NO UI surface.** The diff touches
`src-app/ui/tests/**` (Playwright specs) only; no page, drawer, card, panel,
component, store or route is added or changed, so there is no precedent /
cardinality / responsive / populated-render / progress / input-economy / JTBD /
multi-instance / URL-focus / platform-affordance decision to make. The two
product bugs fixed are backend-only (a search matcher and an LLM token budget).
