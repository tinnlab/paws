# TESTS — ask-user-stringified-schema

Every ITEM is covered by ≥1 TEST; every `INV-N` is pinned by ≥1 `[acceptance]`
test that would FAIL if the invariant were violated.

Tier homes follow the codebase convention: unit = in-source `#[cfg(test)]` (Rust)
or a co-located `*.test.ts` (vitest); integration = `src-app/server/tests/<module>/`;
e2e = `src-app/ui/tests/e2e/`.

## The shared helper (ITEM-1, ITEM-2)

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-3] file: `src-app/server/src/common/tool_args.rs` — asserts: the EXACT reported live payload — `schema` as the string `"{\"properties\": {\"name\": …, \"description\": …, \"instructions\": …}, \"required\": [\"name\"], \"type\": \"object\"}"` — decodes to a JSON OBJECT whose `properties` has all three keys `name`/`description`/`instructions`, whose `name.title` is `"Project name"`, and whose `required` is `["name"]`. Fails if the value is left as a string.
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/common/tool_args.rs` — asserts: a DOUBLE-encoded object string (`to_string(to_string(obj))`) decodes to the same object — one nested re-encoding is unwrapped.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-1, ITEM-2] file: `src-app/server/src/common/tool_args.rs` — asserts: a TRIPLE-encoded string (one more layer than `MAX_STRING_UNWRAPS = 2`) is REFUSED rather than unwrapped, the error names the bound, and the unwrap count for any input is `<= MAX_STRING_UNWRAPS` (proved by driving a 50-deep nesting and asserting it returns an error in bounded time rather than unwrapping to the core). Fails if the unwrap is an unbounded `while let`.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-1] file: `src-app/server/src/common/tool_args.rs` — asserts: for `ArgShape::Object`, a string decoding to a NUMBER, an ARRAY, a BOOL and to `null` are each REFUSED — the decoded value is never returned as the argument and no default is substituted in its place.
- **TEST-5** (tier: unit) [covers: ITEM-1, ITEM-2] file: `src-app/server/src/common/tool_args.rs` — asserts: a string that is not JSON at all (`"not json {"`) is refused and the error carries the underlying parse detail.
- **TEST-6** (tier: unit) [acceptance] [invariant: INV-8] [covers: ITEM-1] file: `src-app/server/src/common/tool_args.rs` — asserts: an already-correct `Value::Object` (and `Value::Array` for `ArgShape::Array`) is returned BYTE-IDENTICALLY (`serde_json::to_vec` equality, not just `==`), and an absent key and an explicit `null` both yield `None` so the caller's own default applies.
- **TEST-7** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/common/tool_args.rs` — asserts: `ArgShape::Array` accepts a stringified ARRAY and refuses a stringified OBJECT (the shape requested is the shape enforced, in both directions).
- **TEST-8** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-2] file: `src-app/server/src/common/tool_args.rs` — asserts: for EVERY one of the four error causes (not-JSON, decoded-to-wrong-type, received-wrong-type, over-the-unwrap-bound) the message contains (a) the argument NAME, (b) the RECEIVED type word, (c) the EXPECTED shape word, and (d) the caller-supplied literal-JSON EXAMPLE verbatim. Fails if any cause ships a message missing any of the three required elements.
- **TEST-9** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/common/tool_args.rs` — asserts: `coerce_args_in_place` rewrites only the named keys and leaves every other key of the arguments object untouched (including a sibling STRING value that happens to contain JSON text — the over-coercion guard).

## `ask_user` (ITEM-3, ITEM-4, ITEM-5, ITEM-6)

- **TEST-10** (tier: unit) [acceptance] [invariant: INV-6] [covers: ITEM-3, ITEM-6] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: `prepare_ask_user_schema` on the reported stringified payload returns an object that (a) carries the three properties AND (b) carries `x-ziee-askuser: true` — i.e. the decode happens early enough that the marker is stamped — and that a stringified schema which itself contains a FORGED `"x-ziee-askuser": true` still ends up marked only because the trusted stamp ran, verified by asserting the strip-then-stamp order via `cap_requested_schema` being applied to the DECODED value. Fails if the decode is moved after the strip.
- **TEST-11** (tier: unit) [acceptance] [invariant: INV-8] [covers: ITEM-3, ITEM-5] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: (a) a well-formed OBJECT schema produces exactly the same output as before this change (the pre-existing `cap_requested_schema` → `stamp_ask_user_marker` composition, byte-compared), and (b) an ABSENT `schema` still defaults to `{"type":"object"}` + marker and is NOT an error.
- **TEST-12** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-4] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: an oversized *encoded* schema — a STRING longer than `MAX_STRUCTURED_CONTENT_BYTES` — is refused, with a message naming the byte count and the limit; AND the ordering invariant that makes the guard authoritative in both forms holds: for a representative set of schemas, `len(serialize(raw_encoded)) >= len(serialize(decoded))`, so the raw-first measurement can never be smaller than the decoded one. Fails if the guard measures only the decoded value (a 2 MB string would then slip through).
- **TEST-13** (tier: unit) [covers: ITEM-4] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: the pre-existing oversized-OBJECT rejection still fires and still refuses BEFORE `cap_requested_schema` replaces the schema with its error marker (regression guard on the existing `helpers.rs:298-317` reasoning).
- **TEST-14** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-5] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: EVERY `ask_user` rejection path returns text carrying received + expected + a literal-JSON example — enumerated: missing `message`, empty/whitespace `message`, schema-not-JSON, schema-decodes-to-non-object, schema-over-unwrap-bound, schema-oversized-encoded, schema-oversized-decoded-object, and explicitly-supplied-object-with-no-`properties`. Each assertion checks the TEXT, not merely that it is an error. Fails if any path returns a bare "invalid schema".
- **TEST-15** (tier: unit) [covers: ITEM-5] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: the zero-`properties` decision of DESIGN §3.3 exactly — an EXPLICITLY supplied `{"type":"object","properties":{}}` is an error whose example shows one property, while an ABSENT schema is NOT an error (the asymmetry is deliberate, so it is pinned).
- **TEST-16** (tier: unit) [covers: ITEM-5] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: no rejection message ever contains the `x-ziee-askuser` marker string (a rejected schema must never leak the trusted marker into model-visible text) — extends the existing assertion at `helpers.rs:1000-1003` to the new paths.
- **TEST-17** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-3, ITEM-4, ITEM-5] file: `src-app/server/tests/mcp/ask_user_stringified_schema_test.rs` — asserts: through the REAL chat path (a scripted `StubChat` tool call emitting `ask_user` with the reported STRINGIFIED schema, a real tool-capable model row, the real MCP tool loop), the `mcpElicitationRequired` SSE frame carries a `requested_schema` that is a JSON OBJECT with the three properties and `required: ["name"]` — a usable form, not a string. Fails on the unfixed code with a string payload.
- **TEST-18** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/mcp/ask_user_stringified_schema_test.rs` — asserts: through the same real path, a NON-decodable `schema` string yields a tool RESULT (not a hang, not an elicitation) whose text carries the received/expected/example triple, so the model can self-correct on the next turn.

## Elicitation ingress + response path (ITEM-7, ITEM-8)

- **TEST-19** (tier: unit) [acceptance] [invariant: INV-6] [covers: ITEM-7] file: `src-app/server/src/modules/mcp/elicitation/models.rs` — asserts: `cap_requested_schema` given a STRING-encoded schema whose decoded object contains a forged `"x-ziee-askuser": true` returns an OBJECT with that key STRIPPED — the decode runs before the strip, so string-encoding is not a bypass for the forgery guard. Fails if the decode is added after the strip (the natural wrong order), which would let an external MCP server forge the trusted rich-UX marker.
- **TEST-20** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/modules/mcp/elicitation/models.rs` — asserts: an oversized STRING-encoded schema is dropped to the `x-ziee-error` marker object WITHOUT being parsed (size checked on the raw value first), and the existing pass-through / oversized-object / forged-marker tests remain green.
- **TEST-21** (tier: integration) [covers: ITEM-8] file: `src-app/server/tests/mcp/ask_user_stringified_schema_test.rs` — asserts: `POST /api/mcp/elicitation/{id}/respond` with `action:"accept"` and a STRING-encoded object `content` is decoded (the persisted `response_content` is an object and the model's tool result is the answer object, not a double-encoded string), while a `content` that cannot be an object is refused with a 400 carrying the received/expected/example triple; `decline`/`cancel` and an absent `content` are unchanged.

## `control_mcp` (ITEM-9, ITEM-10)

- **TEST-22** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-9] file: `src-app/server/src/modules/control_mcp/handlers.rs` — asserts: stringified `body`, `query` AND `path_params` each decode before `InvokeArgs` deserialization — specifically that a stringified `query` is no longer SILENTLY DROPPED (it reaches the URL as query pairs) and a stringified `path_params` no longer hard-fails serde. Fails on the unfixed code for all three.
- **TEST-23** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-9, ITEM-10] file: `src-app/server/src/modules/control_mcp/handlers.rs` — asserts: a `body` that cannot be an object is refused with text naming what was received, that an object is expected, and a literal-JSON example; and that `validate_body`'s pre-existing bare `"request body must be a JSON object"` has been replaced by the same triple. Checks the TEXT.
- **TEST-24** (tier: integration) [covers: ITEM-9] file: `src-app/server/tests/control_mcp/stringified_args_test.rs` — asserts: `invoke_capability` with a STRINGIFIED `body` against a real mutating operation reaches the real loopback route and SUCCEEDS (the entity is actually created), instead of the 422 the unfixed code produces.
- **TEST-25** (tier: unit) [covers: ITEM-10] file: `src-app/server/src/modules/control_mcp/handlers.rs` — asserts: a non-object body is now rejected even when the operation declares NO `request_schema` (the widened check of ITEM-10), and that a well-formed object body against a schema-less operation still passes (no regression).

## Remaining siblings (ITEM-11 … ITEM-15)

- **TEST-26** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-11] file: `src-app/server/src/modules/citations/handlers.rs` — asserts: the two SILENT-WRONG-ANSWER paths are fixed — a stringified `format_citations.items` is decoded and formats THOSE records instead of falling through to the user's entire library, and a stringified `remove_citations.ids` actually removes instead of reporting `"0 citation(s) deleted."` as success. Fails on the unfixed code with a silent wrong answer rather than an error.
- **TEST-27** (tier: unit) [covers: ITEM-11] file: `src-app/server/src/modules/citations/handlers.rs` — asserts: a stringified `items` in `parse_items` decodes (no more "missing `items` array" when `items` was present), and a stringified nested `items[].csl` decodes so the entry is stored with a real CSL record rather than an empty one.
- **TEST-28** (tier: integration) [covers: ITEM-11] file: `src-app/server/tests/citations/stringified_args_test.rs` — asserts: over the real `/api/citations/mcp` JSON-RPC surface, `add_citations` with a stringified `items` persists the entries and `remove_citations` with stringified `ids` removes them.
- **TEST-29** (tier: unit) [covers: ITEM-12] file: `src-app/server/src/modules/background_mcp/tools.rs` — asserts: a stringified `spawn_background.spec` decodes so `spec.task` is found, replacing the misleading `"spec.task must be a non-empty string"`; and a non-decodable `spec` errors with the received/expected/example triple.
- **TEST-30** (tier: unit) [covers: ITEM-13] file: `src-app/server/src/modules/workflow_mcp/tools.rs` — asserts: `coerce_inputs` now actually coerces a stringified inputs object; `Object`/`Null` still pass through unchanged; a non-decodable value still errors (the pre-existing `coerce_inputs(&json!("nope")).is_err()` test stays green) but with the actionable message.
- **TEST-31** (tier: unit) [covers: ITEM-14] file: `src-app/server/src/modules/knowledge_base/handlers.rs` — asserts: a stringified `knowledge_base_ids` decodes into the typed `Vec<Uuid>`, restoring the graceful conversation-attached-KB fallback instead of a serde hard error.
- **TEST-32** (tier: unit) [covers: ITEM-15] file: `src-app/server/src/modules/lit_search/handlers.rs` — asserts: stringified `queries`, `ids`, `record_sets` and `decisions` each decode before their typed deserialization, and that a stringified INNER element is no longer silently counted as `dropped` / `skipped` but is either decoded or reported.

## Frontend (ITEM-16, ITEM-17, ITEM-18)

- **TEST-33** (tier: unit) [acceptance] [invariant: INV-7] [covers: ITEM-16] file: `src-app/ui/src/modules/mcp/chat-extension/components/elicitationOptions.test.ts` — asserts: `normalizeElicitationSchema` returns a NOTICE (not silently-empty fields) for every unusable shape — a JSON string, `null`, an object with no `properties`, `properties: {}`, a non-object `properties` — and surfaces the server's `x-ziee-error` text as that notice. Fails if any unusable shape yields "no notice + zero fields", which is exactly the dead card.
- **TEST-34** (tier: unit) [covers: ITEM-16] file: `src-app/ui/src/modules/mcp/chat-extension/components/elicitationOptions.test.ts` — asserts: a non-iterable `required` (`3`, `{a:1}`) does NOT throw (the `new Set(3)` render-crash guard) and yields an empty required-set; and that a JSON-STRING schema (a content block persisted BEFORE this fix) is parsed so reopening an old conversation renders its fields.
- **TEST-35** (tier: unit) [covers: ITEM-16] file: `src-app/ui/src/modules/mcp/chat-extension/components/elicitationOptions.test.ts` — asserts: a well-formed schema is normalized to exactly today's `properties`/`requiredFields`/`isRich` values (no-regression on the happy path).
- **TEST-36** (tier: e2e) [acceptance] [invariant: INV-7] [covers: ITEM-17, ITEM-18] file: `src-app/ui/tests/e2e/chat/ask-user-degraded-schema.spec.ts` — asserts: for an elicitation whose schema renders no fields, the card shows the explanatory notice and does NOT present a Submit control that fabricates an empty answer; and for a schema carrying `x-ziee-error`, the server's reason is displayed to the user. Fails on today's code, which renders an empty form with a working Submit.
- **TEST-37** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-3, ITEM-17] file: `src-app/ui/tests/e2e/chat/ask-user-stringified-schema.spec.ts` — asserts: END TO END through the REAL backend — a scripted OpenAI-compatible fixture (`tests/e2e/helpers/oai-stub-server.ts`, registered as a `custom` provider with a tool-capable model row) emits an `ask_user` tool call whose `schema` argument is the reported STRINGIFIED payload; the rendered card shows REAL form fields (`[data-testid^="elicitation-field-"]` present, covering Switch/Select/DatePicker as well as text inputs, per the selector lesson in `control-ask-user-for-input.spec.ts`) and the field for `name` is present. This is the whole feature proved at the user-visible layer, deterministically and unskippably. Fails on the unfixed backend with an empty form.
- **TEST-38** (tier: e2e) [covers: ITEM-17] file: `src-app/ui/tests/e2e/chat/ask-user-stringified-schema.spec.ts` — asserts: with a REAL configured LLM (`test.skip(!TEST_LLM, NO_LLM_SKIP)` — a conditional env gate, never an unconditional skip), an under-specified request still renders an `ask_user` form with real fields, i.e. the decode path introduced here does not regress the real-model flow. Retried like its sibling real-LLM control specs.
- **TEST-39** (tier: unit) [covers: ITEM-18] file: `src-app/ui/src/dev/gallery/fixtures/chat-deep.ts` — asserts: via `npm run check`'s `check:state-matrix` + `check:gallery-coverage` gates, the new conditional render states introduced by ITEM-17 have gallery cells (including a 390px narrow-viewport state), so the state matrix does not drift.

## Closing the test-suite gap (ITEM-19, ITEM-20, ITEM-21)

Ranked by the only criterion that matters — **would this test have caught THIS
bug before it shipped?** TEST-40 and TEST-41 would have. TEST-42 is the written
analysis that makes the gap non-recurring.

- **TEST-40** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-19] file: `src-app/server/src/common/tool_args.rs` — asserts: the shared conformance battery itself is sound — driven against a deliberately UNFIXED (pass-the-value-through) extractor closure it FAILS, and against the fixed helper it passes. **This is the anti-tautology check** (D2): a battery that cannot fail on the old behaviour would prove nothing, and the old behaviour is exactly what shipped. WOULD have caught the bug: yes — by construction, it is red on the pre-fix code path.
- **TEST-41** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-19, ITEM-3, ITEM-7, ITEM-9, ITEM-11, ITEM-12, ITEM-13, ITEM-14, ITEM-15] file: `src-app/server/src/common/tool_args.rs` — asserts: EVERY coerced call site passes the same battery, via one conformance call per site placed in that module's own `#[cfg(test)]`. The battery is applied uniformly rather than per-site ad hoc, so a NEW built-in tool with an object argument inherits the whole shape distribution instead of one author's mental model of it. WOULD have caught the bug: yes, at `ask_user` and at `invoke_capability` simultaneously.
- **TEST-42** (tier: unit) [covers: ITEM-20] file: `.lifecycle/ask-user-stringified-schema/TEST_GAP_ANALYSIS.md` — asserts: (as a written, evidence-carrying artifact reviewed at phase 8 rather than executed by a runner) what tests existed, why they passed, the CLASS that was missing, and which sibling call sites share the same object-only-fixture weakness — every claim backed by a file:line citation a reader can independently check.
- **TEST-43** (tier: unit) [covers: ITEM-21] file: `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — asserts: a string `schema` NEVER REACHES `stamp_ask_user_marker` — the end-to-end outcome the pre-existing isolated leaf test traded away when it asserted a string "passes through unchanged". The leaf's own no-panic contract is retained. WOULD have caught the bug: yes — this is the precise assertion whose absence let the isolated test ratify the defect.

## Coverage map

| ITEM | Covering TESTs |
|---|---|
| ITEM-1 | 1,2,3,4,5,6,7,9 |
| ITEM-2 | 3,5,8 |
| ITEM-3 | 1,10,11,17,37 |
| ITEM-4 | 12,13,17 |
| ITEM-5 | 14,15,16,17,18 |
| ITEM-6 | 10 |
| ITEM-7 | 19,20 |
| ITEM-8 | 21 |
| ITEM-9 | 22,23,24 |
| ITEM-10 | 23,25 |
| ITEM-11 | 26,27,28 |
| ITEM-12 | 29 |
| ITEM-13 | 30 |
| ITEM-14 | 31 |
| ITEM-15 | 32 |
| ITEM-16 | 33,34,35 |
| ITEM-17 | 36,37,38 |
| ITEM-18 | 36,39 |
| ITEM-19 | 40,41 |
| ITEM-20 | 42 |
| ITEM-21 | 43 |

| INV | Pinning `[acceptance]` TESTs |
|---|---|
| INV-1 | 1, 17, 22, 26, 37, 40, 41 |
| INV-2 | 4 |
| INV-3 | 3 |
| INV-4 | 12 |
| INV-5 | 8, 14, 23 |
| INV-6 | 10, 19 |
| INV-7 | 33, 36 |
| INV-8 | 6, 11 |

## Notes

- No new permission is introduced (BASE.md), so the A9 backend-deny and A10
  `[negative-perm]` restricted-user e2e gates do not apply. The surfaces touched
  are already gated by pre-existing permissions (`mcp_servers::read` for
  elicitation, `control::use`, `citations::use`, …) and those gates are unchanged.
- TEST-37 is deliberately a DETERMINISTIC e2e rather than a real-LLM one: a real
  model cannot be made to stringify its arguments on demand, so a real-LLM test
  of the stringified case would be a coin flip. TEST-38 keeps a real LLM in the
  loop for the no-regression half, conditionally gated.
