# PLAN — control-describe-schema

Two defects in the built-in **control MCP** server: `describe_capability` hands
the model an unresolvable `$ref` (and a false `required_permission: null`), and
nothing tells the model to collect missing input with `ask_user` instead of chat
prose.

## Design source

Realizes `.lifecycle/control-describe-schema/DESIGN.md` §1 (the defects), §2 (the
promises), §3 (the inlined-schema contract), §4 (the text channel + nested
structure) and §5 (the D2 guidance). No prior design doc existed for these two
defects, so DESIGN.md was written first as the design of record and this plan is
derived from it.

## Invariants

- **INV-1**: "What `describe_capability` returns must be sufficient, on its own,
  for the model to construct a valid request body — no `#/components/schemas/…`
  pointer the model cannot dereference." (DESIGN §2.1)
- **INV-2**: "It must be bounded, and it must degrade to a smaller but still-valid,
  still-self-contained JSON Schema rather than to invalid or silently-cut JSON."
  (DESIGN §2.2)
- **INV-3**: "A self-referential or mutually recursive component may never hang,
  blow the stack, or expand forever." (DESIGN §2.3)
- **INV-4**: "The reported permission must be the one the route actually enforces,
  for every operation that declares one — never `null` because a doc string was
  overwritten." (DESIGN §2.4)
- **INV-5**: "When a mutating capability needs input the user has not supplied, the
  model collects it with `ask_user` — one field per schema property, pre-filled
  with a default where the schema or the context implies one — instead of asking
  for values in chat text." (DESIGN §2.5)
- **INV-6**: "The digest therefore walks the body RECURSIVELY and lists the inner
  fields under their parent … And the exact inlined JSON Schema is always emitted
  alongside the digest, never in its place." (DESIGN §4)

## Items

- **ITEM-1**: New app-side module `control_mcp/schema_inline.rs` — a recursive
  `$ref` inliner over `serde_json::Value`. Resolves `#/components/schemas/…`
  through `properties`, `items`, `additionalProperties`, `patternProperties`,
  `prefixItems`, `not`, `allOf`, `oneOf`, `anyOf`. Cycle-safe via an explicit
  resolution STACK (not a blind depth cap): a ref re-entering a schema already on
  the stack is cut to `{"$ref": "#/$defs/<Name>"}` and the name deferred. Same cut
  on exceeding `MAX_DEPTH` or `MAX_EXPANSIONS`. Deferred names are emitted into a
  root `$defs`, ref-rewritten to a fixpoint, so the output never references
  `#/components/`. Dangling ref → `{"$comment": "unresolved $ref: …"}`.
- **ITEM-2**: Byte-budget degradation — if the fully-inlined form exceeds
  `MAX_SCHEMA_BYTES`, re-emit the compact `$defs` form (root ref-rewritten + one
  `$defs` entry per reachable component, each appearing exactly once). If even
  that exceeds a hard cap, drop the largest `$defs` entries to
  `{"$comment": "omitted for size"}` placeholders (deterministic order) and flag
  it. Report the outcome as `schema_form` ∈ `inline|defs` and `schema_truncated`.
- **ITEM-3**: `describe_capability` returns the inlined schema. `structuredContent`
  keeps its existing keys, with `request_schema` now self-contained, plus
  `schema_form` + `schema_truncated`. **Amended in phase 5 (DRIFT-1.1):** the
  operation's `parameters` are inlined too — a query parameter's schema is also a
  `$ref` (`{"$ref": "#/components/schemas/HubCategory"}`) and is as much part of
  the input contract as the body.
- **ITEM-4**: `describe_capability`'s TEXT channel becomes a readable digest
  (operation/method/path, permission, approval, path + query params, then a
  RECURSIVELY-walked request-body field list: `name` / `parent.child` /
  `items[].child`, with type, required, default, enum options, description),
  followed by the exact inlined JSON Schema block. Replaces the
  `to_string_pretty(&structured)` dump. **Amended in phase 5 (DRIFT-1.2):** each
  field also carries a compact constraint hint (`len 1..255`, `>=0`,
  `format=uuid`) — several ziee request types declare no JSON-Schema `required`
  array yet constrain the value, so without it the digest reads as "optional".
- **ITEM-5**: Fix `required_permission` in the SDK's `catalog::build_catalog` —
  when the description carries no `**Required Permission:**` marker (because a
  hand-written `.description()` overwrote it), fall back to the 403 response
  example's `details.required_permissions[0].value`. Restores the permission on
  201 of 446 operations.
- **ITEM-6**: Model guidance in the SDK's `tools.rs` — the `describe_capability`
  and `invoke_capability` descriptions state the ask-with-a-form rule: for a
  mutating capability whose required inputs the user has not supplied, call
  `ask_user` with one property per schema field (carrying `title`, `description`,
  `enum` + `enumNames`, and `default` where one is implied); do not ask for values
  in prose.
- **ITEM-7**: The same rule, one sentence, in the app-side control chat-extension
  nudge (`chat_extension/control.rs::CONTROL_NUDGE`).
- **ITEM-8**: Remove the byte-identical duplicate of `resolve_schema_ref` in
  `handlers.rs` — `validate_body` uses the new `schema_inline` resolver instead, so
  there is ONE ref-resolution implementation app-side.

## Files to touch

- `src-app/server/src/modules/control_mcp/schema_inline.rs` (new)
- `src-app/server/src/modules/control_mcp/mod.rs` (declare the module)
- `src-app/server/src/modules/control_mcp/handlers.rs` (describe digest +
  structured payload; drop the duplicate resolver)
- `src-app/server/src/modules/control_mcp/chat_extension/control.rs` (nudge)
- `sdk/crates/ziee-control-mcp/src/catalog.rs` (403-example permission fallback)
- `sdk/crates/ziee-control-mcp/src/tools.rs` (tool descriptions)
- `sdk` (submodule pointer bump)
- `src-app/server/tests/control_mcp/mod.rs` (integration)
- `src-app/ui/tests/e2e/control/control-ask-user-for-input.spec.ts` (new e2e)

No migration. No OpenAPI/type regen: the control surface is JSON-RPC over an
untyped `Response`, so no `#[derive(JsonSchema)]` type changes.

## Patterns to follow

- **Recursive schema walk** — mirror `catalog.rs::schema_has_secret_field_rec`
  (resolve-then-descend over `properties` / `items` / `anyOf`+`oneOf`+`allOf`),
  but replace its blind depth-6 cap with a real resolution stack, since a
  truncating cap is correct for a boolean probe and wrong for an emitted schema.
- **Text digest + typed `structuredContent`** — mirror the `web_search` retrofit
  and `list_capabilities` in the same file (`text_result(text, Some(structured))`).
- **Tool-description regression guard** — mirror
  `elicitation_mcp/tools.rs::description_documents_rich_conventions`.
- **Nudge unit test** — mirror
  `control_mcp/chat_extension/control.rs::apply_attach_sets_shared_flag_and_prepends_nudge`.
- **Integration test shape** — mirror the existing
  `describe_permitted_returns_schema_and_approval_flag` in
  `server/tests/control_mcp/mod.rs` (`call_tool` + `structured`).
- **Real-LLM e2e** — mirror `ui/tests/e2e/control/control-tool-in-chat.spec.ts` and
  its `helpers/control-llm-helpers.ts` (`TEST_LLM` / `NO_LLM_SKIP` /
  `setupControlChat`), and the elicitation card selector used by
  `ui/tests/e2e/chat/ask-user-decision-ux.spec.ts`.

## UI-surface checklist

Not applicable — this feature adds **no UI surface**. The only frontend path in
the diff is a new Playwright spec under `src-app/ui/tests/e2e/`; no page, drawer,
card, panel, component, store, or route is added or changed. The surface the e2e
exercises (the `ask_user` elicitation card) already exists and is unchanged.
