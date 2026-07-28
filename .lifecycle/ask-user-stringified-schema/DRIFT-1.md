# DRIFT-1 — implementation vs plan (authored during phase 5)

Recorded as each item landed, not reconstructed afterwards.

- **DRIFT-1.1** — verdict: resolved — ITEM-3 originally said "decode `schema` in
  `run_ask_user_elicitation`". Implementing it showed the successful outcome was
  not assertable there at all: with `sse_tx: None` the function returns before
  the schema is observable, which is exactly why the pre-existing suite could
  only test ERROR paths. PLAN.md ITEM-3 was amended (before implementation) to
  name the pure `prepare_ask_user_schema` extraction, and phases 1-3 re-run
  green. The extraction is what makes TEST-1/10/11/12/15 possible.

- **DRIFT-1.2** — verdict: impl-wins — three further pure extractions were needed
  for the same reason and were NOT named in the plan: `decode_invoke_args`
  (control_mcp), `decode_spec_arg` (background_mcp), `decode_search_args`
  (knowledge_base). Each wraps a coercion that otherwise sits inside an async
  handler needing a DB pool and an authenticated user, i.e. unreachable from a
  unit test. Same rationale as DRIFT-1.1, same shape; the plan's intent is
  unchanged, so the implementation stands and this entry is the record.

- **DRIFT-1.3** — verdict: plan-wins — **the highest-value drift of the round.**
  DEC-9's rule (an EXPLICITLY supplied `ask_user` schema with no `properties` is
  an error) broke THREE pre-existing tests that the plan did not anticipate:
  `ask_user_without_sse_returns_non_error_no_session_marker`,
  `ask_user_stream_close_during_wait_returns_non_error_no_response`, and
  `ask_user_send_time_stream_close_returns_distinct_marker`
  (`helpers.rs:1032/1191/1463`). All three assert STREAM-lifecycle behaviour and
  all three used `"schema": { "type": "object" }` as incidental scaffolding.

  This is itself an instance of the TEST_GAP_ANALYSIS finding, from the other
  direction: a fixture chosen for convenience rather than realism silently
  became load-bearing. The rule is right and stands (plan-wins); the three
  fixtures gained a real property, because a stream test should not depend on
  sending a schema that asks the user nothing. Recorded rather than quietly
  patched, because it means DEC-9 has a blast radius beyond `ask_user`'s own
  argument validation — any caller that sent a field-less schema now gets an
  error, and the phase-6 audit should look for others.

- **DRIFT-1.4** — verdict: resolved — my own test-harness defect, not product
  code: the citations conformance extractor stringified the refusal with
  `format!("{:?}", JsonRpcError)`, whose escaped quotes (`\"doi\"`) can never
  match the raw example literal, so the battery failed on a message that was in
  fact correct. Changed to read `.message`. Worth recording because a
  weaker reaction — relaxing the battery's example assertion — would have
  quietly removed the very check that enforces INV-5 at all thirteen sites.

- **DRIFT-1.5** — verdict: impl-wins — ITEM-10 said `validate_body` would reject
  "a non-object body" even when the operation declares no request schema.
  Implementing it showed that is too broad: a route taking `Json<Vec<T>>`
  legitimately receives an ARRAY body, and the catalog contains such operations.
  Narrowed to reject only SCALARS (string / number / bool), which is the actual
  defect class (a JSON-encoded body is a string) and cannot reject anything a
  real route would have accepted. Arrays are still rejected by the pre-existing
  object-typed-schema branch when the schema says `object`. PLAN's ITEM-10 intent
  ("stop a stringified body producing a confusing downstream 422") is fully met.

- **DRIFT-1.6** — verdict: resolved — ITEM-15 and TEST-32 claim the two
  lit_search INNER-element paths (a stringified record silently counted
  `dropped` at `handlers.rs:528`; a stringified decision silently `skipped` at
  `:599-604`) are covered. The first implementation pass decoded only the
  top-level array arguments and left both inner loops untouched, so the TESTS.md
  claim would have exceeded the code — a phantom leg of exactly the kind the
  phase-6 test-reality angle exists to catch. Found by re-reading TESTS.md
  against the diff and fixed in the same phase: both loops now decode per
  element, falling back to the original value so a genuinely malformed record
  still lands in `dropped`/`skipped` rather than failing the whole call.

- **DRIFT-1.7** — verdict: none — the plan's claim that no OpenAPI regen is
  required held: no `#[derive(JsonSchema)]` type changed shape, and
  `RespondToElicitationRequest.content` stayed `Option<serde_json::Value>` (only
  the handler's validation of the value changed). No regen was run and none is
  implied.


## Addendum (same phase, after the first full unit run)

- **DRIFT-1.8** — verdict: resolved — my own test fixture, not product code:
  `unwrapping_is_bounded_by_max_string_unwraps` built a 50-layer nesting to prove
  the unwrap is bounded. Every re-encode escapes the previous layer's quotes, so
  the FIXTURE grows ~2^n — the test hung (observed: "has been running for over 60
  seconds"), not because the unwrap was unbounded but because constructing the
  input was exponential. Reduced to 10 layers, which is still 8 past the bound.
  Recorded because the failure mode LOOKED like the very defect under test, and
  a hasty reading would have "fixed" the production unwrap instead of the
  fixture.

**Unresolved drifts:** 0
