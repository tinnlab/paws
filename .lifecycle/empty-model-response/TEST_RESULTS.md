# TEST_RESULTS — answerless chat turns

Every line below was transcribed from a run I executed and read myself, with the
command's own exit code captured via `PIPESTATUS` (not `tail`'s). Full logs under
`/data/pbya/ziee/tmp/`.

## Acceptance tests (design-invariant proofs)

- **TEST-1**: PASS — `cargo test -p ai-providers --test adapter_response_test`
  → `test openai_reasoning_only_length_truncation_preserves_length_and_emits_no_text ... ok`;
  suite `4 passed; 0 failed`, EXIT=0. Drives the REAL captured Qwen bytes.
- **TEST-2**: PASS — `cargo test --test integration_tests -- chat::empty_completion_cause`
  → `budget_truncated_turn_keeps_length_and_persists_the_cause ... ok`;
  `3 passed; 0 failed`, EXIT=0.
- **TEST-3**: PASS — `node --test src/modules/chat/components/emptyCompletion.test.ts`
  → `TEST-3 [acceptance/INV-1]: truncated vs empty vs aborted are DISTINCT presentations ... ok`
  and `TEST-3 [acceptance/INV-3]: the truncated turn does NOT advise a bare retry ... ok`;
  file total `pass 11, fail 0`, EXIT=0.
- **TEST-4**: see e2e section below.
- **TEST-5**: PASS — in-source `#[cfg(test)]` in `streaming.rs`, run via
  `cargo test --lib -p ziee chat::core` (`59 passed`; the 1 failure in that run is
  the pre-existing `append_content_doc_cites…`, baselined below).

## Regression / correct-behaviour tests

- **TEST-6**: PASS — `TEST-6: cause branching does not disturb the suppression gates ... ok`
  (same node:test run as TEST-3).
- **TEST-7**: PASS — `openai_200_yields_unified_deltas_and_canonical_finish ... ok`
  (negative control: the non-reasoning fixture still yields `stop` + its text).
- **TEST-8**: PASS — `cargo test --test integration_tests -- chat::stub_chat_tier2`
  included in the `13 passed; 0 failed` run, EXIT=0.
- **TEST-9**: PASS — in-source classifier test in `streaming.rs` (same lib run as TEST-5).
- **TEST-10**: PASS — `answered_turn_persists_no_completion_state ... ok`. The
  implementation additionally added a second negative control not in the original
  enumeration — `truncated_turn_that_still_answered_persists_no_completion_state ... ok`
  — which closes the "a turn that truncated but DID answer must not be labelled"
  hole. Both in the `3 passed; 0 failed` run.
- **TEST-11**: see e2e section below.
- **TEST-12**: PASS — `cargo test --lib -p ziee types_ts_parity`
  → `openapi::tests::types_ts_parity ... ok`, `types_ts_parity_desktop ... ok`;
  `2 passed; 0 failed`, EXIT=0.
  **Caught a false green here**: the filter quoted in `justfile:87` and root
  `CLAUDE.md` (`openapi::emit_ts::`) selects **0 of 1519 tests and exits 0**. The
  PASS above is from the corrected filter; see DRIFT-2.1.

## e2e (TEST-4, TEST-11)

Run: `npx playwright test tests/e2e/chat/empty-completion-cause.spec.ts --workers=1`
Log: `/data/pbya/ziee/tmp/lifecycle-logs-empty-e2e.log`

- **TEST-4**: PASS — both specs. `TEST-4: a budget-truncated turn names the budget and does NOT advise a bare retry` and `TEST-4: a genuinely-empty turn keeps the empty-response wording`.
- **TEST-11**: PASS — `TEST-11: the cause survives a full page reload (21.3s)`.

Final run: `3 passed (1.4m)`, **E2E3_EXIT=0** (exit code captured by direct redirect, NOT through a pipe).

**Two earlier runs of these specs failed (3 failed each), for two DIFFERENT reasons — both recorded rather than hidden:**
1. Round 1/2: the kit `Alert` (`sdk/packages/kit/src/kit/alert.tsx`) destructured `...rest` but never spread it, so `data-empty-completion-cause` never reached the DOM. Real defect; fixed in the kit (rest is now spread on the root, with `onClose`/`closeLabel` destructured out so they cannot leak to the DOM).
2. Round 2 ALSO could not have passed for an environment reason of the orchestrator's own making: `node_modules` had been symlinked in from the main clone to skip an install, and the workspace links inside it (`@ziee/kit -> ../../sdk/packages/kit`) therefore resolved to `/data/pbya/ziee/ziee/sdk` — the MAIN repo's kit, which did not contain the fix. Verified with `readlink -f node_modules/@ziee/kit`. Fixed by removing the symlinks and running a real `npm install` in the worktree; `@ziee/kit` now resolves to `<worktree>/sdk/packages/kit` and contains the fix.

The lesson is the same one that produced the `openapi::emit_ts::` false green and the `| tail` exit-code false green on this branch: verify WHAT a run measured, not just that it was green.

## Frontend workspace gate

`npm run check (ui): BASELINE-RED — not caused by this branch, not silenced.`

The chain fails at `check:testid-registry`, which fails **identically on
`origin/main`** (verified by running it there). This branch introduces zero new
test-ids. `check:state-matrix` is likewise stale on main; this branch's
ChatMessage entry was diffed against a regen taken on main and differs **only in
line numbers** (same 8 signals, same `requiredStates`), so it introduces no new
conditional render state. Regenerating either was attempted and reverted:
regenerating `stateMatrix` turns `tsc` from exit 0 into `TS2353` via another
feature's stale `stateCoverage.ts` key, and regenerating `testIds` would pull 32
unrelated ids into the shared `sdk/` submodule.

Individually verified on this branch (each run by me, exit code read):

| check | result |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `npm run lint:colors` | PASS |
| `npm run lint:hooks` | PASS |
| `npx biome lint` (changed files) | PASS, exit 0 |
| `check:design-spec` | PASS |
| `check:gallery-coverage` | PASS |
| `check:overlay-registry` | PASS |

## Pre-existing failures, baselined against origin/main (NOT masked)

- `modules::chat::core::repository::contents::tests::append_content_doc_cites_a_constraint_that_really_exists`
  — branch: `FAILED, 1 failed`, exit 101. **main: `FAILED, 1 failed`, exit 101.**
  Reads `server/migrations`, a directory this repo does not have (migrations are
  per-module). Identical both sides.
- `npm run test:unit` (ui) — branch **49** failing files, main **49**. Identical.
  Pre-existing glob overlap (`node --test`'s `src/**/*.test.ts` also matches the
  vitest-owned `*.store.test.ts`). The file this branch touches passes 11/11 when
  run directly.
