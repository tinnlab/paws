# PLAN — ask-user-stringified-schema

A model-supplied object argument that arrives JSON-encoded as a string is decoded
to what the model meant; when it cannot be, the model gets an actionable error
and the user gets a card that tells the truth.

## Design source

Realizes `.lifecycle/ask-user-stringified-schema/DESIGN.md` §2.1 (decode what the
model meant), §2.2 (never invent a value), §2.3 (bounded unwrapping), §2.4 (the
size guard in both forms), §2.5 (every rejection is actionable), §2.6 (the
rich-UX marker trust property), §2.7 (no card that lies), §2.8 (no regression),
§3 (what is and is not coerced, incl. §3.1 external ingress, §3.2 the response
path, §3.3 zero-field schemas) and §4 (where the helper lives).

No prior design doc existed for this defect, so DESIGN.md was written first as
the design of record and this plan is derived from it.

## Invariants

- **INV-1**: "A model-supplied argument that declares an object or array shape
  and arrives as a JSON-encoded string is decoded to the value the model meant,
  at **every** such argument of every built-in tool — not only at `ask_user`."
  (DESIGN §2.1)
- **INV-2**: "Coercion decodes; it never substitutes. A string that does not
  decode to the DECLARED shape … is **refused**, never silently accepted as the
  argument and never replaced by a default that hides the mistake." (DESIGN §2.2)
- **INV-3**: "Unwrapping is therefore repeated, but bounded by a compile-time
  constant. Model- and server-controlled input can never drive an unbounded loop
  or unbounded allocation." (DESIGN §2.3)
- **INV-4**: "It is extended so a payload over the limit is refused whether it is
  over the limit **encoded** (a 2 MB string) or **decoded** (an object that
  inflates past the limit)." (DESIGN §2.4)
- **INV-5**: "Every rejection path — new and pre-existing — returns feedback that
  states three things: 1. **what was received** … 2. **what is expected**;
  3. **a concrete corrective example the model can copy**, shown as literal JSON,
  not described in prose." (DESIGN §2.5)
- **INV-6**: "Decoding a string into an object must therefore happen **before**
  the strip, never after." (DESIGN §2.6)
- **INV-7**: "A user is never shown an elicitation card that looks answerable but
  is not. When no field can be rendered, the card says so and offers a real
  choice, and when the server supplied a reason (`x-ziee-error`) that reason is
  shown." (DESIGN §2.7)
- **INV-8**: "A well-formed object argument passes through byte-identically. An
  absent argument behaves exactly as before (`ask_user` still defaults to
  `{"type":"object"}`)." (DESIGN §2.8)

## Items

### The shared helper

- **ITEM-1**: New `src-app/server/src/common/tool_args.rs` — the single shared
  coercion helper, exported from `common/mod.rs`. Public surface:
  `ArgShape { Object, Array }`, `ArgError` (carrying an already-actionable
  message), `MAX_STRING_UNWRAPS: usize = 2`, and
  `coerce_value(value, shape, arg_label, example) -> Result<Value, ArgError>` /
  `coerce_arg(args, key, shape, example) -> Result<Option<Value>, ArgError>` /
  `coerce_args_in_place(&mut Value, &[ArgSpec]) -> Result<(), ArgError>` (the
  form the typed-`from_value` sites need). Rules: an already-correct shape is
  returned unchanged; absent/`Null` is `None`; a `Value::String` is
  `serde_json::from_str`-decoded, repeating while the result is itself a string,
  at most `MAX_STRING_UNWRAPS` times; anything else is an `ArgError`.
- **ITEM-2**: The helper's message builder — every `ArgError` names the argument,
  the RECEIVED type/shape, the EXPECTED shape, and a literal-JSON EXAMPLE
  supplied by the call site. Four distinct causes: not-JSON (carrying the parse
  error), decoded-to-wrong-type, received-wrong-type (not even a string), and
  over-the-unwrap-bound.

### `ask_user` — the reported bug and all its failure paths

- **ITEM-3**: `mcp/chat_extension/helpers.rs` — extract the whole schema-handling
  preamble into a PURE, directly-unit-testable function
  `prepare_ask_user_schema(input: &Value) -> Result<Value, String>` (decode →
  size-guard → `cap_requested_schema` → `stamp_ask_user_marker`), and have
  `run_ask_user_elicitation` call it. The extraction is required for
  testability: with `sse_tx: None` the existing function returns before the
  schema is observable, so today only its ERROR paths can be unit-tested and the
  successful decode could not be asserted at all. Mirrors the
  `apply_project_context` extraction pattern. Within it, decode `schema` through
  the helper before the size check and before `cap_requested_schema`;
  absent/`Null` still defaults to `{"type":"object"}`.
- **ITEM-4**: Same function — the size guard measures the RAW value first (so an
  oversized *string* is refused without ever being parsed), then the DECODED
  value (so an inflating payload is refused too); both against
  `MAX_STRUCTURED_CONTENT_BYTES`, both before `cap_requested_schema`, preserving
  the existing comment's reasoning verbatim.
- **ITEM-5**: Same function — every rejection is rewritten to the §2.5 shape:
  missing/empty `message`, schema-not-JSON, schema-decodes-to-non-object,
  schema-over-unwrap-bound, oversized-encoded, oversized-decoded, and
  explicitly-supplied-object-with-no-properties (DESIGN §3.3: an error for
  `ask_user`, with an example showing one property).
- **ITEM-6**: `stamp_ask_user_marker` is left semantically unchanged and keeps
  running strictly AFTER `cap_requested_schema` (INV-6). Verified, not edited,
  beyond a doc-comment note that the decode now happens upstream.

### The elicitation ingress shared with external MCP servers

- **ITEM-7**: `mcp/elicitation/models.rs::cap_requested_schema` — decode a
  string-encoded `requestedSchema` at the single chokepoint, ordered raw-size-cap
  → decode → marker-strip, so the trust property (INV-6) is preserved and an
  oversized string is dropped without being parsed. Emits a `tracing::warn!`
  naming the SEP-1330 violation (DESIGN §3.1: repair AND shout). Covers
  `mcp/client/http.rs:710/1861/2257` with no edit at those three sites.
- **ITEM-8**: `mcp/elicitation/handlers.rs::respond_to_elicitation` — the
  RESPONSE path (DESIGN §3.2). An `accept` whose `content` is present decodes
  through the helper; a `content` that cannot be an object is refused with an
  actionable 400. Absent content and `decline`/`cancel` are untouched.

### `control_mcp` — the most likely twin

- **ITEM-9**: `control_mcp/handlers.rs::invoke_capability` — decode `body`,
  `query` and `path_params` through the helper BEFORE
  `serde_json::from_value::<InvokeArgs>`, so the stringified `query` stops being
  silently dropped, the stringified `body` stops being POSTed as a JSON string
  literal, and `path_params` stops hard-failing serde. Each carries its own
  §2.5 example (a body example derived from the operation's own request schema
  where one exists, so the model gets a copyable body for THAT operation).
- **ITEM-10**: `control_mcp/handlers.rs::validate_body` — a body that is present
  and not an object now returns the §2.5 message shape instead of the bare
  `"request body must be a JSON object"`, and is checked even when the operation
  declares no `request_schema` (today that case skips validation entirely and
  lets the real route emit a confusing 422).

### The remaining siblings — mechanical applications of the one helper

- **ITEM-11**: `citations/handlers.rs` — `parse_items` (`items`),
  `format_citations` (`items`, `ids`), `remove_citations` (`ids`), and the nested
  `items[].csl` (`citations/models.rs`). Kills two silent-wrong-answer paths: a
  stringified `format_citations.items` formatting the user's whole library, and a
  stringified `remove_citations.ids` reporting `"0 citation(s) deleted."` as
  success.
- **ITEM-12**: `background_mcp/tools.rs` — `spawn_background.spec`, so a
  double-encoded spec stops producing the lie *"spec.task must be a non-empty
  string"*.
- **ITEM-13**: `workflow_mcp/tools.rs::coerce_inputs` — make the function named
  `coerce_inputs` actually coerce, via the shared helper. Covers both
  `run_from_workspace.inputs` and the per-workflow `wf_<slug>` whole-arguments
  object. The existing test that pins the reject-only behaviour is updated to
  pin the new contract (a non-decodable value still rejects, with a better
  message).
- **ITEM-14**: `knowledge_base/handlers.rs` — `search_knowledge.knowledge_base_ids`
  decoded before the typed `from_value`, restoring the graceful
  conversation-attached-KB fallback instead of a serde hard error.
- **ITEM-15**: `lit_search/handlers.rs` — `literature_search.queries`,
  `fetch_paper_fulltext.ids`, `dedup_records.record_sets`,
  `select_included.decisions`, `fetch_references.ids` decoded before their typed
  `from_value`s, plus the two inner-element paths that today silently count a
  stringified element as `dropped` / `skipped`.

### The frontend — the user must not be left with a dead card

- **ITEM-16**: `mcp/chat-extension/components/elicitationOptions.ts` — a new pure
  `normalizeElicitationSchema(raw)` returning
  `{ properties, requiredFields, isRich, notice }`. It tolerates a JSON-string
  schema (persisted content blocks written BEFORE this fix still hold strings, so
  reopening an old conversation must not stay broken), guards `properties`
  against non-objects, guards `required` against non-iterables (fixing the
  `new Set(3)` render crash of DESIGN §1.4), and surfaces the server's
  `x-ziee-error` as the notice.
- **ITEM-17**: `mcp/chat-extension/components/ElicitationFormContent.tsx` — when
  no field can be rendered, render an explicit no-fields state (an `Alert`
  mirroring `WorkflowElicitForm`'s `wf-elicit-alert` precedent + a truthful
  primary action) instead of an empty `<form>` with a Submit that fabricates
  `content: {}`. Applies BEFORE the rich/flat branch so both paths are covered
  and `AskUserWizardContent` needs no change.
- **ITEM-18**: Gallery + state-matrix coverage for the new conditional render
  states (`chat/gallery.tsx` + `dev/gallery/fixtures/chat-deep.ts`), including a
  narrow-viewport (390px) state, so `npm run check`'s `check:state-matrix` and
  `check:gallery-coverage` gates pass.

### Closing the TEST-SUITE gap that let this ship

`ask_user` is a shipped, tested built-in with a substantial `#[cfg(test)]` block
that already exercises `schema` — yet a stringified `schema` reached a live
session and every test passed. That is a defect in the suite, and it is the more
valuable finding: the same blind spot is protecting other bugs right now.

- **ITEM-19**: A shared, reusable **model-supplied-argument conformance battery**
  in `common/tool_args.rs` (`pub mod conformance`, `#[cfg(any(test, feature = …))]`-free
  — a plain `#[cfg(test)]`-visible support module used by every module's own
  tests). It drives ONE canonical set of shapes — well-formed, stringified,
  double-encoded, over-the-unwrap-bound, decodes-to-wrong-type, not-JSON,
  wrong-type-outright, absent, explicit-null — through a call-site closure and
  asserts the contract each site must satisfy, INCLUDING that every refusal
  message carries received/expected/example. Every coerced site (ITEM-3, 7, 9,
  11, 12, 13, 14, 15) then adds ONE conformance call. This is the CLASS of test
  that was missing; a test pinned to the owner's exact payload would let the next
  variant through.
- **ITEM-20**: `TEST_GAP_ANALYSIS.md` — the written analysis: what tests existed,
  why they passed, the class that was missing, and which SIBLING call sites share
  the same weakness (object-only fixtures) and are therefore where the next
  instance of this bug is hiding today.
- **ITEM-21**: Repair the one existing test that actively RATIFIED the bug.
  `helpers.rs::stamp_ask_user_marker_stamps_objects_idempotently_and_skips_non_objects`
  feeds `json!("just a string")` to `stamp_ask_user_marker` and asserts it
  "passes through unchanged" — pinning the defective behaviour as the intended
  contract (the production comment at `helpers.rs:213-215` says the same:
  "a non-object schema (which the FE renders as an empty form anyway) is returned
  unchanged"). The leaf's no-panic contract is legitimate and stays; what must be
  added is the END-TO-END assertion that a string never REACHES the stamp,
  because that is the outcome the isolated test silently traded away.

## Files to touch

Backend:
- `src-app/server/src/common/tool_args.rs` (NEW)
- `src-app/server/src/common/mod.rs`
- `src-app/server/src/modules/mcp/chat_extension/helpers.rs`
- `src-app/server/src/modules/mcp/elicitation/models.rs`
- `src-app/server/src/modules/mcp/elicitation/handlers.rs`
- `src-app/server/src/modules/control_mcp/handlers.rs`
- `src-app/server/src/modules/citations/handlers.rs`, `citations/models.rs`
- `src-app/server/src/modules/background_mcp/tools.rs`
- `src-app/server/src/modules/workflow_mcp/tools.rs`
- `src-app/server/src/modules/knowledge_base/handlers.rs`
- `src-app/server/src/modules/lit_search/handlers.rs`

Frontend:
- `src-app/ui/src/modules/mcp/chat-extension/components/elicitationOptions.ts`
- `src-app/ui/src/modules/mcp/chat-extension/components/ElicitationFormContent.tsx`
- `src-app/ui/src/modules/chat/gallery.tsx`
- `src-app/ui/src/dev/gallery/fixtures/chat-deep.ts`
- (`src-app/desktop/ui/` has NO override of `modules/mcp` — verified; nothing to
  mirror there.)

Tests:
- `src-app/server/src/common/tool_args.rs` `#[cfg(test)]`
- in-source `#[cfg(test)]` in each touched backend module
- `src-app/server/tests/mcp/ask_user_stringified_schema_test.rs` (NEW) + its
  `mod` line in `src-app/server/tests/mcp/mod.rs`
- `src-app/server/tests/control_mcp/` (appended)
- `src-app/ui/src/modules/mcp/chat-extension/components/elicitationOptions.test.ts`
- `src-app/ui/tests/e2e/chat/ask-user-stringified-schema.spec.ts` (NEW)
- `src-app/ui/tests/e2e/helpers/oai-stub-server.ts` (NEW — the scripted
  OpenAI-compatible fixture)

## Patterns to follow

- **The shared helper** mirrors `src-app/server/src/common/tokens.rs`: a small,
  pure, domain-neutral, fully unit-tested module hanging off `common/mod.rs`.
  The "tolerate a stringified scalar" precedent already in-tree is
  `mcp/client/http.rs:38-45` `json_id_eq`.
- **The `ask_user` guard ordering** mirrors the existing
  `helpers.rs:292-324` block verbatim in structure (measure raw → reject →
  cap → stamp); only the decode step is inserted.
- **Error-message quality** mirrors the existing size-cap message at
  `helpers.rs:310-317` (names the value, the limit, the corrective action).
- **The frontend degraded state** mirrors
  `src-app/ui/src/modules/workflow/components/WorkflowElicitForm.tsx:462`
  (`wf-elicit-alert`) — the one elicitation-shaped surface in-tree that already
  has an error affordance — and the existing `cancelled` card in
  `ElicitationFormContent.tsx:271`, which is the nearest sibling degraded state.
- **The e2e OpenAI-compatible fixture** mirrors
  `src-app/ui/tests/e2e/llm/helpers/repository-health-mock.ts` (an in-worker
  `http.createServer` the RUST backend connects to, because `page.route()` cannot
  intercept server-side reqwest), with the response shapes ported from
  `src-app/server/tests/common/stub_chat.rs:777-855`.
- **The tool-capable model row** mirrors
  `src-app/ui/tests/e2e/control/helpers/control-llm-helpers.ts:102`
  (`createToolCapableModel`) — `createModelViaAPI` hardcodes
  `function_calling:false` and would leave the tools unattached.
- **Integration-test shape** mirrors `src-app/server/tests/chat/stub_chat_tier2_test.rs`
  (scripted `StubToolCall` through the real chat consumer path).

## UI-surface checklist (ITEM-17 / ITEM-18)

- **Precedent** — the twin is the existing `cancelled` elicitation card
  (`ElicitationFormContent.tsx:271`), which is the same Card shell with a
  single explanatory line; the notice styling copies `WorkflowElicitForm`'s
  `wf-elicit-alert`. No new container, typography, or token is introduced.
- **Scale / cardinality** — bounded by construction: this state renders ONE
  message string plus at most one notice line. No list, so no paging concern.
  The message itself is already length-capped upstream by the elicitation
  pipeline.
- **Device size / responsive** — the card inherits the existing elicitation
  Card's responsive behaviour unchanged (it is the same shell); the added notice
  is a full-width block that wraps. A 390px gallery state is added (ITEM-18) and
  is part of the phase-8 `gate:ui` run.
- **Populated-render review** — the gallery cells added by ITEM-18 are POPULATED
  (a real message + a real `x-ziee-error` reason), not empty shells, so the
  design-critic pass reviews the state a user actually sees.
- **User-visible progress** — not applicable; this state is terminal-until-answered
  and carries no background work.
- **Input economy** — this is the exact rule the whole feature serves: the user is
  never asked to type an answer into a form that cannot represent it. In the
  no-fields state there is no input to render, so the card offers the two real
  choices (accept / decline) and says why there is nothing to fill in.
- **JTBD** — the user's job is *"answer the assistant's question and get on with
  the task."* Across the surfaces: on the **pending** card they want to see the
  question and the fields; when the fields cannot be built they want to know
  **that it is not their fault, that the assistant sent something malformed, and
  what their options now are** — not a Submit button that silently sends an
  empty answer and makes the assistant act on it. On the **accepted/declined**
  cards nothing changes. The degraded state therefore explains, then offers
  decline (the safe default) and accept (explicitly labelled as sending no
  values).
- **Multi-instance** — elicitation cards already render per message-content-block
  in any pane; this change adds no cross-instance state (the component stays a
  pure function of its content block plus the existing `McpComposer` entry).
- **URL-as-view-into-focus** — not applicable; no URL reflects an elicitation.
- **Platform-provided affordances** — none added.

## Notes

- No migration, no permission, no REST type change → no `just openapi-regen`,
  and the A9/A10 authz gates do not apply. See BASE.md.
- Base is `origin/feat/agent-core`; every gate runs with
  `--base origin/feat/agent-core`.
