# DRIFT-1 — implementation vs plan/design

Authored DURING phase 5, as each item landed and was RUN. Every entry below was
found by executing the thing, not by reading it.

- **DRIFT-1.1** — verdict: impl-wins — PLAN ITEM-5 said "raise the budget"; the
  implementation raises it to 4096 AND parameterizes `build_title_request`'s
  `max_tokens` so the escalated retry (ITEM-6) can reissue the identical request.
  The two existing call sites in `tests/chat/title_test.rs` needed the extra
  argument. PLAN's ITEM-5/6 wording already anticipated both; no plan amendment
  needed beyond noting the signature change here.

- **DRIFT-1.2** — verdict: resolved — the escalated retry needed a stub mode the
  harness could not express. `StubChat`'s existing `STUB_TITLE_EMPTY` /
  `STUB_TITLE_EMPTY_ONCE` both end `finish_reason: "stop"`, so no stub-backed test
  could drive the budget-exhausted path at all. Added an ADDITIVE
  `STUB_TITLE_BUDGET_ONCE` mode plus `stream_response_with_finish` /
  `json_response_with_finish` (the pre-existing `stream_response`/`json_response`
  now delegate, unchanged in behavior). This is a shared-harness edit, so it was
  weighed against B3: it is not a workaround for this feature's problem, it is a
  missing capability of the fixture — without it the retry would ship with only
  pure-unit coverage. Verified the pre-existing empty-title tests still record
  exactly ONE title call (they do — `an_empty_generation_leaves_the_title_unset_not_the_raw_message`
  passes unchanged).

- **DRIFT-1.3** — verdict: plan-wins — the FIRST run of TEST-9
  (`title_real_llm_test`) FAILED even on the FIXED code. Cause was in the TEST,
  not the fix: the model row was created with `parameters.max_tokens: 512`, which
  starved the ASSISTANT turn itself — the turn produced only `thinking` blocks, so
  `assistant_produced_output` was false and the title extension never fired. The
  test would have "failed for the right feature, for the wrong reason". Raised the
  model row to 4096 and documented why. Re-run: PASS, title "New Project Creation
  Request".

- **DRIFT-1.4** — verdict: resolved — regression proof executed, not assumed
  (B7/D2). With `title.rs` temporarily restored from `origin/feat/agent-core`, the
  new TEST-9 FAILS with the production error verbatim: *"generated title is empty:
  the model exhausted the 512-token budget (finish_reason=length) without emitting
  answer text"*. With `handlers.rs` temporarily restored from the same base, the
  new TEST-4 FAILS with *"'create project' must match at least one operation (got
  0)"*. Both files restored afterwards; both tests green on the fixed code.

- **DRIFT-1.5** — verdict: plan-wins — TEST-17(a) initially asserted that
  `MemorySettings.update` is NOT offered to the restricted user. It IS offered:
  every new account also joins the default **Users** group, which grants
  `memory::write`. The assertion was a false alarm, not a finding. Re-pointed the
  "not offered" leg at `User.delete` (`users::delete`, admin-only — the same
  operation the existing Rust test `list_capabilities_filters_by_permission` uses
  for exactly this reason), keeping the admin positive control so the test cannot
  pass vacuously. DECISIONS DEC-5's reasoning is unchanged (pick an op whose
  permission the catalog actually carries AND the user actually lacks); only the
  concrete subject moved.

- **DRIFT-1.6** — verdict: plan-wins — the `MemorySettings.update` approve leg
  read `body.enabled`, which does not exist: `UserMemorySettings` exposes
  `retrieval_enabled` / `extraction_enabled`. Verified against the committed
  `openapi.json` schema and switched to `retrieval_enabled` (with the prompt
  reworded to name memory RETRIEVAL). Caught only because the test ran — the
  original assertion failed on `before === null` rather than silently passing.

- **DRIFT-1.7** — verdict: impl-wins — the table rows gained a "Use the
  app-control tools; do not ask me first" nudge after a local 35B model stalled on
  a clarifying question. The nudge names the TOOL FAMILY, never an operation id, so
  `list_capabilities` discovery is still required (INV-3 intact). The PRIMARY
  discovery journey deliberately keeps the purely natural phrasing ("Create a new
  project called X for me.") with no nudge at all, because that is the design's
  actual ask; the nudge is confined to the rows whose subject is approval+effect
  across operation classes. PLAN ITEM-13/14 amended in spirit by this note.

- **DRIFT-1.8** — verdict: none — ITEM-9's `configured_test_llm` landed as a PURE
  `resolve_test_llm(get)` plus a thin env-reading wrapper, so its precedence is
  unit-testable without mutating process env (which would race across parallel
  tests). Matches the plan's intent exactly.

**Unresolved drifts:** 0
