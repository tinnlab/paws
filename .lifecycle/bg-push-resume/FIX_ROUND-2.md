# FIX_ROUND-2 — bg-push-resume

Ran a full blind re-audit after FIX_ROUND-1, THEN executed the integration tests
(B7 — verification means RUNNING it), which surfaced test-only defects. All
confirmed findings from this round were fixed.

## Confirmed findings this round + fixes

- **tests-quality (low, from the blind re-audit) — TEST-7 under-asserts** — it
  asserted only `terminal` + `injected==0`, never that the run reached
  `Completed`, so an access-revoke that instead *failed* the sub-agent would pass
  spuriously (resume skipped because Failed, not because of the re-check) → FIXED:
  TEST-7 now asserts `status == "completed"` before checking `injected == 0`, so
  the skip is provably attributable to the fire-time access re-check.

- **tests-quality (HIGH, found by RUNNING the tests) — StubEngine dropped early**
  — the `spawn_subagent_on_stub_conversation` helper bound the `StubEngine` to a
  local and RETURNED before the detached sub-agent turn (which runs asynchronously
  AFTER the helper returns) called it, so the stub server was dropped and the
  sub-agent turn failed with `chat_stream failed: Network error … /v1/chat/completions`
  → the run went `Failed`, never `Completed`, so no resume fired (0 messages). This
  was a TEST harness bug, NOT a production bug (proven: the production hook only
  fires on `Completed`; the run legitimately failed because its model endpoint was
  gone). FIXED: the helper now RETURNS the `StubEngine` and each test binds it as
  `_stub` for the whole test scope (a named `_stub` binding lives to end of scope,
  unlike a bare `_`). Diagnosed via temporary `tracing::warn!` DIAG lines that
  logged the `BackgroundOutcome` variant (`Failed(... Network error ...)`), then
  removed.

- **tests-quality (medium, found by RUNNING the tests) — assistant-reply race** —
  TEST-5 waited for a message-ROW count of 2, but the resumed turn's assistant
  message row is created EMPTY at turn start and its text streams in a moment
  later, so the assertion could catch the empty row and fail ("not an empty row").
  FIXED: added a predicate wait `wait_for_messages_where(...)` that polls until an
  assistant message actually CONTAINS the stub answer ("Hello from stub"), bounded
  by a 45s deadline.

## Verification

All three resume integration tests PASS on a real run (server subprocess + stub
model, no real LLM key):
`test result: ok. 3 passed; 0 failed` — `resume_injects_new_turn_without_polling`,
`resume_fires_exactly_once_per_completion`, `resume_skipped_when_model_access_revoked`.
The 403 `BACKGROUND_RESUME_MODEL_FORBIDDEN` warn in the log is TEST-7's EXPECTED
access-revoke path.

The production code (`resume.rs`, the `tools.rs` completion hook, `mod.rs`) is
substantively UNCHANGED from the FIX_ROUND-1 audited state — the only production
edits this round were adding then REMOVING the temporary DIAG tracing. A final
blind convergence round (FIX_ROUND-3) confirms zero remaining findings.

**New confirmed findings:** 3
