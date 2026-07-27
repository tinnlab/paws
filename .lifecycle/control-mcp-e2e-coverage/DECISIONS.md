# DECISIONS — control-mcp-e2e-coverage

Every human/product input the implementation needs, resolved up front.

### DEC-1: Where does the multi-word matcher live — app-side `handlers.rs` or the `ziee-control-mcp` SDK crate?
**Resolution:** app-side, in `control_mcp/handlers.rs`, next to the permission filter it composes with.
**Basis:** codebase — the split recorded in `control_mcp/mod.rs` puts the DB-free dispatch core (catalog/policy/tools) in the SDK and keeps `handlers.rs` (the forwarded-JWT invoke + the per-user permission filter) app-side "in v1 (decisions N1/N5)". The query filter is part of that same per-user list pipeline. Keeping it app-side also keeps this branch a single-repo, fast-forwardable diff with no `sdk/` submodule pointer bump.

### DEC-2: Relevance scoring — what ranks above what?
**Resolution:** per term, take the best field hit: `operation_id` segment-exact (split on `.`/`_`/camel boundaries) 8 > `operation_id` substring 6 > tag exact 4 > summary word-boundary 3 > summary substring 1. Sum across terms; sort score DESC, then `operation_id` ASC.
**Basis:** convention — `operation_id` is the key the model addresses and is the most precise signal (the catalog doc-comment calls it "the stable key the model addresses"); summary text is the noisiest. Segment-exact above substring is what makes `Project.create` (both terms segment-exact, 16) beat `Project.createFrom…`-style substring hits and `Project.duplicate` (one term only). The `operation_id` ASC tie-break preserves today's byte-identical ordering whenever every candidate shares a score (notably the no-query case).

### DEC-3: Should the query also match `path_template` / `description`?
**Resolution:** no — keep the three fields the shipped code searched (`operation_id`, `summary`, `tags`).
**Basis:** convention — the design's fix is about the MATCH SEMANTICS ("tokenize on whitespace and require ALL terms to match"), not about widening the corpus. Widening the fields would change which ops match a single term, breaking "keep single-term behavior at least as good as today" in the other direction (more noise) and making the change harder to reason about. A field widening is a separate, evidence-driven change.

### DEC-4: On what condition does the title generation retry?
**Resolution:** retry ONCE, only when the collected answer text is empty AND `is_budget_exhausted(finish_reason)` is true (`length` / `max_tokens`). Never on an empty completion that ended `stop`; never more than once.
**Basis:** codebase — `tests/common/stub_chat.rs` returns the empty title completion with `finish_reason: "stop"` (verified at `stub_chat.rs:768-785`), and `an_empty_generation_leaves_the_title_unset_not_the_raw_message` asserts exactly ONE title call there. Keying on budget-exhaustion preserves that contract and targets precisely the measured failure mode (DESIGN §6). It also keeps the deliberate "an empty generation leaves the title UNSET" design property intact for genuinely-empty models.

### DEC-5: How is INV-6 ("the op is not offered/denied") satisfied, given that `Project.create` declares no permission in the catalog?
**Resolution:** cover BOTH halves: **not offered** is asserted with `MemorySettings.update` (whose handler docs declare `**Required Permission:** memory::write`, so `Operation.required_permission` is populated and the per-user filter really hides it); **denied + nothing created** is asserted with `Project.create` (offered, but the forwarded-JWT loopback call is refused by the route's own `projects::create` gate).
**Basis:** codebase — extracted from the committed `openapi.json`: `Project.create` / `Assistant.create` / `Project.update` carry no `Required Permission` marker, while `Project.list` (`projects::read`) and `MemorySettings.update` (`memory::write`) do. Asserting "not offered" against an op whose `required_permission` is `None` would be a test that cannot fail; asserting only "denied" would drop the half of the invariant the control surface itself implements.

### DEC-6: Is the title token budget a fixed constant or an admin-configurable setting?
**Resolution:** fixed constants (`TITLE_MAX_TOKENS` / `TITLE_RETRY_MAX_TOKENS`), NOT a new settings row.
**Basis:** convention + explicit rationale. This is not an operator-facing tunable: it is an internal, once-per-conversation output cap on a hidden helper call with no user-visible behavior to tune, and its correct value is a property of the MODEL (how much reasoning it emits), not of the deployment's policy. Promoting it to a settings row would hand operators a footgun (set it to 50 and every conversation silently goes untitled — precisely the shipped bug) in exchange for no real control. Both values live as named constants with the measured rationale in their doc-comments, so a later promotion to a settings row is a mechanical change, not a rewrite. The genuinely operator-facing behavior (whether titles are generated at all) already exists and is unchanged.

### DEC-7: Which mutating operations does the table-driven e2e cover?
**Resolution:** `Project.create` (the design's own live-session repro), `Assistant.create` (the op the pre-existing spec covered, so nothing is lost), and `MemorySettings.update` (a settings update, and the one op in the set whose permission IS declared — so it doubles as the INV-6 "not offered" subject).
**Basis:** convention — the design asks for "at minimum `Project.create` and `Assistant.create`, plus 1-2 more you judge representative (e.g. a settings update, a workflow)". A workflow op was considered and rejected: `Workflow.create` takes a full `WorkflowDef` body, so a 35B bridge model composing one from a natural-language prompt would make the spec's failure signal about model fidelity rather than about the control surface. `MemorySettings.update` is a small, typed, idempotently-verifiable body — the same class of write, without the noise.

### DEC-8: Which LLM do the un-gated specs run against, and what is the skip condition?
**Resolution:** whichever the environment configures, resolved in ONE place per language (`configured_test_llm()` / `configuredTestLlm()`), preferring the OpenAI seam (`OPENAI_BASE_URL` + `OPENAI_API_KEY` + `ZIEE_TEST_LLM_MODEL`), then the Anthropic seam, then the global `ZIEE_TEST_LLM_BASE_URL`. Skip ONLY when none resolves.
**Basis:** user — the design states it directly: "run them against the configured test LLM … If no LLM is configured at all, the spec may skip — but it must NOT skip merely because Anthropic specifically is absent." The resolution order mirrors the existing `tests/e2e/chat/helpers/agent-llm-helpers.ts` (`OPENAI_BASE_URL || ZIEE_TEST_LLM_BASE_URL`) so both languages behave the same.

### DEC-9: How does the e2e prove the model DISCOVERED the op rather than being told it?
**Resolution:** assert against the recorded MCP tool-call history (`GET /api/mcp/tool-calls?conversation_id=…`) that a `list_capabilities` call exists for that conversation, and keep every operation id out of the prompt text.
**Basis:** codebase — `mcp_tool_calls` records every invocation at the `McpSession::call_tool` chokepoint, is owner-scoped and permission-checked, and is already the assertion surface for `tests/e2e/07-mcp/mcp-tool-call-history.spec.ts`. It is durable (survives the stream ending) and unambiguous, where DOM-scraping the transcript is neither.

### DEC-10: Do the new e2e specs get their own Playwright port/lock allocation?
**Resolution:** yes — run them with a dedicated port base and lock dir (55000/56000/62000 family) and `--workers=1`, never against the two live instances (`:1520/:29500` audit rig, `:1530/:29600` user view).
**Basis:** user — an explicit rule in the brief. Also matches the existing real-LLM e2e convention (`--workers=1` for SSE + tool round-trips).
