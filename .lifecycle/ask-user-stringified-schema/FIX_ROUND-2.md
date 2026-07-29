# FIX_ROUND-2 — blind audit of the two tests written at phase 8 (TEST-24, TEST-38)

## Provenance

Unlike FIX_ROUND-1 (a self-audit, forced by exhausted sub-agent quota — see its
header), this round WAS independent: a fresh agent with no prior context audited
the new files adversarially, having neither written them nor seen the plan. Two
of its findings were things the author could not have seen, because they were
wrong *beliefs* rather than wrong code.

## Scope

The hunks added at phase 8, which FIX_ROUND-1 could not have covered because they
did not exist yet:

- `src-app/server/tests/control_mcp/stringified_args_test.rs` (new)
- `src-app/server/tests/control_mcp/mod.rs` (the `mod` declaration + header)
- the TEST-38 `describe` block in
  `src-app/ui/tests/e2e/chat/ask-user-stringified-schema.spec.ts`

Angles: tests-quality, correctness, patterns-conformance, error-handling,
maintainability (recorded per-hunk in `AUDIT_COVERAGE.tsv`).

## Findings and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | MED | The file NARRATED the pre-fix behaviour as a 422 from the target route and asserted `assert_ne!(status, 422)`. False: `Assistant.create` has an object `request_schema`, so a string body is refused PRE-dispatch; `structuredContent` is absent, so the assertion compared against `Null` and passed in every world. | FIXED — assertion deleted, narrative replaced with the measured behaviour. The measurement is now recorded rather than the assumption. |
| 2 | MED | `undecodable_body_…` could not tell WHICH layer refused: `validate_body`'s widened scalar-reject also emits body/object/`{}`, so the test stayed green against a revert of `decode_invoke_args` alone. | FIXED — asserts the message says the text was `not valid json`, which only `coerce_value`'s from_str-failure arm emits. Verified red on a partial revert. |
| 3 | MED | An `\|\|` branch advertising a tolerance the next five assertions revoked (they can only read the error channel), i.e. unreachable-by-design and misleading. | FIXED — narrowed to the single real shape, with the reason recorded. |
| 4 | MED | Only `body` was covered end-to-end, though the file's own thesis argues `query` is the strongest case (its pre-fix failure was SILENT — a dropped query returned a plausible 200 for the wrong question). | FIXED — added `query` and `path_params` legs, plus the exclusive side of `MAX_STRING_UNWRAPS`. |
| 5 | LOW | `assert!(args["body"].is_string())` on a value constructed two lines above — a comment wearing an assertion's clothes. | FIXED — removed. |
| 6 | LOW | TEST-ID collision: `mod.rs` already carries TEST-22/23/24 markers from the `control-describe-schema` lifecycle. | FIXED — the new file's IDs are namespaced to this feature. |
| 7 | LOW | `mod.rs`'s header enumerates what the tier-2/3 tests cover; the new `mod` line was added without it. | FIXED — submodules documented. |
| 8 | LOW | `assistant_count` duplicates an inline query in `mod.rs`. | ACCEPTED — deduplicating would edit a file this feature otherwise does not touch, for no behavioural gain. |
| 9 | LOW | No integration leg for the exclusive side of the unwrap bound. | FIXED — folded into #4. |
| 10 | MED | The e2e precondition sat inside the test body, i.e. AFTER the test-scoped `testInfra` fixture had already built a Postgres DB, a backend and a Vite server. | FIXED — moved to `beforeAll`, which cannot request a test-scoped fixture and therefore runs first. Verified: fails in 10s. |
| 11 | LOW | Retries applied to the no-LLM precondition, which cannot change between attempts — three full stack boots to reach the same verdict. | FIXED — `retries: TEST_LLM ? 2 : 0`. |
| 12 | MED | The e2e asserted only "at least one field", so a schema mangled down to ONE surviving property passed — the exact regression the leg exists to catch. | FIXED (then re-fixed in round 3 — the first fix was itself defeatable). |
| 13 | LOW | No `try/finally`: on the FAILING path — precisely when a retry is about to start — the decline never ran, leaving a generation task blocked on the form. | FIXED — body wrapped, decline in `finally`. |
| 14 | LOW | `chat/ask-user-real-llm.spec.ts` gates on `ANTHROPIC_API_KEY` directly, so the chat suite now holds two real-model `ask_user` specs with contradictory gating policies. | OUT OF SCOPE — a pre-existing spec this feature does not touch. Reported to the orchestrator; the honest fix is to migrate it onto the shared `TEST_LLM` seam and to extend `control-spec-gating.spec.ts` to cover `chat/` specs that import the seam. Not silently absorbed here. |
| 15 | LOW | `NO_LLM_SKIP` reads as a self-contradiction when used as a hard-failure message. | FIXED — the `expect` message states plainly that this spec fails rather than skips, and points at DEC-21. |
| 16 | LOW | The block referred to "TEST-37 above", but no TEST-37 marker existed in the file. | FIXED — marker added. |
| 17 | LOW | A `chat/` spec importing `setupControlChat` couples it to the control suite's setup semantics. | ACCEPTED — the alternative is duplicating the tool-capable-model setup, which is worse. Noted for a future shared `tests/e2e/common/` extraction. |

**New confirmed findings: 15**
