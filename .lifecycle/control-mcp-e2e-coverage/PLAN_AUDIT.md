# PLAN_AUDIT — control-mcp-e2e-coverage

Audit of `PLAN.md` against the actual codebase on `origin/feat/agent-core @ 11cda3d5d`.

## Breakage risk

- **`list_capabilities` filter (ITEM-1/2)** — the only in-tree callers of the
  filter are the tool itself and `tests/control_mcp/mod.rs`. Two existing
  integration tests exercise query behavior:
  `list_capabilities_filters_by_permission` (uses `tag`, not `query`) and
  `list_reports_total_and_truncation` (uses no query / a single term). A
  tokenized ALL-terms matcher is a strict SUPERSET of whole-phrase `.contains`
  for **single-term** queries (one term ⇒ identical predicate), so those pass
  unchanged. It is a strict superset for multi-term queries too (today: 0 results
  unless a field literally contains the spaced phrase — which no
  `operation_id`/`tag` ever does and no `summary` in the spec does for the
  observed queries).
  **Ordering change is the real breakage surface**: the current sort is
  `operation_id` ASC. Any assertion depending on alphabetical order would break.
  Verified: no existing test asserts the ORDER of `operations[]` — they assert
  membership (`.iter().any(...)`) and `total`. Deterministic tie-break on
  `operation_id` ASC keeps the no-query and single-relevance-class cases
  byte-identical to today.
- **Title budget (ITEM-5/6)** — `TITLE_MAX_TOKENS` is referenced in exactly two
  places: `build_title_request` and the error message in
  `generate_title_with_ai`. One test pins the value
  (`title_request_carries_the_reasoning_safe_token_budget`, asserts `Some(512)`)
  and MUST be updated in the same commit (ITEM-7) or the suite goes red — this is
  a planned edit, not a break.
  The escalated retry changes call COUNT on the budget-exhausted path only.
  `tests/chat/title_test.rs::an_empty_generation_leaves_the_title_unset_not_the_raw_message`
  asserts `title_call_count == 1` after a turn whose title call returns EMPTY
  text — the stub's `STUB_TITLE_EMPTY` path. **Risk: if that stub emits a
  budget-exhausted `finish_reason`, the retry would make the count 2 and break
  the test.** Checked `tests/common/stub_chat.rs`: the empty-title path returns an
  empty completion with `finish_reason: "stop"`, NOT `length`, so the retry does
  not fire and the count stays 1. The retry must therefore key on
  `is_budget_exhausted(finish_reason)` AND empty text — never on empty text
  alone. Captured as DEC-4.
- **`thinking: ThinkingConfig::disabled()` (ITEM-5)** — `build_title_request`
  currently leaves `thinking: None`. Setting `Disabled` is inert for the OpenAI
  adapter (it only suppresses the `reasoning_effort` emission, which is already
  absent because no `effort` is set) and is an existing, tested mode for the
  Anthropic/Gemini adapters. No provider gains a new required field.
- **Real-LLM gate swap (ITEM-9/10/12)** — widening a skip condition can only make
  MORE tests run. The risk is the opposite of breakage: tests that previously
  no-op'd now execute and may expose further latent defects. That is the point of
  the feature (INV-1).
- **Tool-capable model row (ITEM-11)** — the current e2e uses
  `createModelViaAPI`, which hardcodes `capabilities.function_calling: false` and
  omits `tools`. `ControlExtension::before_llm_call` bails on
  `!ensure_model_tools_capable(...)`, so the control tools were never attached.
  **The existing spec could not have passed even with `ANTHROPIC_API_KEY` set** —
  it is not merely skipped, it is also wrong. Fixing it via a direct
  `POST /api/llm-models` with `capabilities.tools=true` mirrors
  `agent-llm-helpers.ts::createBridgeToolModel` exactly.

## Pattern conformance

- **ITEM-1/2/3** mirror `control_mcp/handlers.rs`'s own established convention:
  `control_call_needs_approval` → pure `needs_approval_decision` + `#[cfg(test)]`
  in the same file. The new `query_terms` / `op_match_score` follow it verbatim.
- **ITEM-5/6** mirror the same file's `build_title_request` / `is_budget_exhausted`
  extraction ("extracted so the token budget and prompt shape are unit-testable
  without a provider").
- **ITEM-9/10** mirror `tests/chat/helpers.rs::test_provider_base_url` — the
  existing, in-tree real-LLM bridge seam. Additive only (B3: no shared-harness
  behavior is changed, a new function is added next to the existing one).
- **ITEM-11..16** mirror `tests/e2e/chat/helpers/agent-llm-helpers.ts`
  (`HAS_BRIDGE`/`BRIDGE_MODEL`/`createBridgeToolModel`/`BRIDGE_SKIP`) — the
  codebase's working answer to "real-LLM spec against the configured bridge, skip
  cleanly when unset".
- **ITEM-13** uses `GET /api/mcp/tool-calls?conversation_id=…` (the owner-scoped
  MCP tool-call history, `mcp_servers::read`) to prove WHICH tools the model
  called. That is a durable, permission-checked record — strictly better than
  DOM-scraping the transcript, and it is the same surface
  `tests/e2e/07-mcp/mcp-tool-call-history.spec.ts` already asserts against.
- **ITEM-16** mirrors the A10 pattern (log in as a user LACKING the permission,
  assert absence).

## Migration collisions

None. `ls` of the module-local `migrations/` dirs puts the newest at
`202607191300_agent_delegate_enabled.sql`; **this feature adds no migration and
no permission**, so there is nothing to collide. (Consequence: the deterministic
A9/A10 permission gates are not triggered by this diff — the `[negative-perm]`
e2e in ITEM-16 is written because the DESIGN asks for it, not because the gate
forces it.)

## OpenAPI regen

**Not required.** `list_capabilities` is an MCP JSON-RPC tool, not a REST route;
its structured response keys (`operations`/`returned`/`total`/`truncated`) are
unchanged, and no `#[derive(JsonSchema)]` type, handler signature, permission or
`SyncEntity` variant is touched. Confirmed by inspection of the files-to-touch
list: every server-side edit is inside a function body, a constant, or a
`#[cfg(test)]` block. No `just openapi-regen`; no `api-client/types.ts` delta in
either workspace; no desktop `ui/` override to mirror (R2-3 N/A — no
`src-app/ui/src/**` logic changes).

## Per-item verdicts

- **ITEM-1** — verdict: PASS — a one-function change inside `list_capabilities`; single-term behavior is provably identical (one term ⇒ same predicate).
- **ITEM-2** — verdict: CONCERN — changes result ORDER, which is observable to the model. Mitigated: no existing test asserts order, and the tie-break keeps the no-query case byte-identical. Must be verified against the real 368-op catalog, not a fixture (covered by ITEM-4).
- **ITEM-3** — verdict: PASS — pure-function unit tests, mirrors `needs_approval_decision`'s `#[cfg(test)]`.
- **ITEM-4** — verdict: PASS — extends `tests/control_mcp/mod.rs`, whose `call_tool` helper already exists.
- **ITEM-5** — verdict: PASS — constant + one field; the measured evidence (DESIGN §6) justifies 4096 over the starving 512.
- **ITEM-6** — verdict: CONCERN — must key on `is_budget_exhausted(finish_reason) && text.is_empty()`, NOT on empty text alone, or it breaks `an_empty_generation_leaves_the_title_unset_not_the_raw_message` (which asserts exactly one title call after a `finish_reason: "stop"` empty completion). Resolved as DEC-4.
- **ITEM-7** — verdict: PASS — a required companion edit; without it the suite is red.
- **ITEM-8** — verdict: PASS — the INV-8 anchor. Must drive a REAL reasoning model (the stub cannot reproduce the bug: it always returns text).
- **ITEM-9** — verdict: PASS — additive helper beside the existing seam; no existing behavior changed (B3-safe).
- **ITEM-10** — verdict: PASS — swaps the gate only; the setup body already applies the base-url seam.
- **ITEM-11** — verdict: PASS — new file under the control e2e folder; no shared harness edit.
- **ITEM-12** — verdict: PASS — the INV-2 anchor.
- **ITEM-13** — verdict: CONCERN — a real 35B bridge model choosing to call `list_capabilities` from a bare natural-language prompt is non-deterministic. Mitigated by `test.describe.configure({ retries: 2 })` (already the convention in this spec) + `test.slow()`; the assertion is on the RECORDED tool-call history, so a model that discovers via a different read-only tool first still passes as long as `list_capabilities` was among the calls. If it proves flaky in phase 8 the fallback is a system-level nudge in the prompt that still never names the operation id.
- **ITEM-14** — verdict: PASS — three rows, each verified through REST.
- **ITEM-15** — verdict: PASS — keeps the existing test as one table row (A5: no TEST-ID is dropped).
- **ITEM-16** — verdict: CONCERN — `Project.create` / `Assistant.create` declare NO `**Required Permission:**` in their handler docs, so the catalog's `required_permission` is `None` and the per-user filter is a no-op for them: they ARE offered to any `control::use` holder, and the real gate is the forwarded-JWT loopback call (403). So "not offered" is only assertable for an op that DOES declare a permission. Resolved by covering BOTH halves of INV-6: `MemorySettings.update` (`memory::write`) for **not offered**, `Project.create` for **denied + nothing created**. Recorded as DEC-5. (The missing permission markers on those two routes are a pre-existing catalog-precision gap, not a security hole — the route still enforces — and are out of scope here.)
- **ITEM-17** — verdict: PASS — a cheap, deterministic guard; the only executable way to keep INV-1/INV-2 from silently regressing.
