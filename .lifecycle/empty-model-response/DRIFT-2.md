# DRIFT-2 — implementation vs plan (round 2, authored live)

- **DRIFT-2.1** — verdict: impl-wins — TESTS.md located TEST-12 (the OpenAPI golden test) at `src-app/server/src/openapi/emit_ts.rs`. The generator itself now lives in the SDK (`ziee_framework::openapi::emit_ts`); the golden tests are `openapi::tests::types_ts_parity` and `types_ts_parity_desktop` in `src-app/server/src/openapi/mod.rs`. TESTS.md amended to the real path. **This mattered**: the first parity run used the filter quoted in the repo's own `justfile`/`CLAUDE.md` (`openapi::emit_ts::`), which selected **0 of 1519 tests and exited 0** — a vacuous pass. Re-run with `types_ts_parity`: 2 passed, 0 failed. Recorded separately as an unrelated repo defect (below).

- **DRIFT-2.2** — verdict: impl-wins — TESTS.md/DEC-10 planned to drive the e2e/integration `length` turn through `stub_chat.rs`'s `budget_once` arm. That arm is **unreachable from a main chat turn**: it sits inside `if is_title_request { … }` (`stub_chat.rs:311+`), so it only ever answers the title extension's own call, never the assistant message the test re-reads. `oai_capture_stub.rs` hardcodes `stop`/`tool_calls`. Rather than bend a shared harness (rule B3), both the new integration test and the new e2e spec spawn their own minimal OpenAI-compatible SSE stub, mirroring `ai-providers/tests/adapter_response_test.rs`. Nothing under `tests/common/` was modified. DEC-10 superseded.

- **DRIFT-2.3** — verdict: none — ITEM-5 was planned as a clamp applied to the thinking budget. The implementation makes `completion_budget` a **required parameter** of `thinking_config_for` rather than a separate post-hoc clamp, so a future caller cannot construct a thinking config that bypasses INV-4. This is stricter than the plan asked for and upholds the same invariant; recorded for visibility, not as a divergence to reconcile.

## Not drift — pre-existing conditions, verified against main

These were classified by RUNNING the same command on both trees, not assumed:

- **`npm run test:unit` (ui)**: 49 failing files on `fix/empty-model-response` and **49 on `origin/main`** — identical. Cause is a pre-existing glob overlap (the `node --test` pattern `src/**/*.test.ts` also matches the vitest-owned `*.store.test.ts` files). The branch adds zero new failures; the new assertions in `emptyCompletion.test.ts` pass 11/11 when that file is run directly.
- **`modules::chat::core::repository::contents::tests::append_content_doc_cites_a_constraint_that_really_exists`**: reads `concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")` = `src-app/server/migrations`, a directory that **does not exist in this repo** (migrations are per-module under `modules/*/migrations/`, per CLAUDE.md). Baselined by running the same test on `origin/main`: **`test result: FAILED. 0 passed; 1 failed` / exit 101** — identical to the branch. Pre-existing, not caused by this change, and NOT masked here.

- **`npm run check` (ui) is RED ON MAIN**, at two generated-artifact gates, both verified by running the same command on `origin/main`:
  - `check:testid-registry` — `testIds.generated.ts` is stale on main (exit 1). Regenerating adds **32 ids belonging to other features** (`cite-*`, `llm-provider-proxy-*`, `mcp-runtime-*`); this branch introduces **zero** new test-ids, so regenerating would only absorb unrelated drift into a shared submodule (`sdk/`). Deliberately NOT regenerated. This gate runs BEFORE `check:state-matrix` in the chain, so it is what fails `npm run check` on both trees.
  - `check:state-matrix` — also stale on main (exit 1). This branch's ChatMessage entry was diffed against a regen taken on main: **the 8 signals and the `requiredStates` set are identical; only line numbers shift.** So this change introduces no new conditional render state. Regenerating was ATTEMPTED and then REVERTED because it makes the branch strictly worse: the regenerated matrix drops a stale `modules/onboarding/OnboardingRedirect:delayed` key that `stateCoverage.ts` still references, turning `tsc` from exit 0 to `TS2353` (and it would additionally pull in 6 unmapped surfaces from citations / llm-local-runtime / mcp / workflow). With the revert, `tsc --noEmit` is **exit 0** on this branch.

  Net: this branch leaves `npm run check` exactly as red as its base, at gates it did not cause, and does not silence them.

## Unrelated repo defect surfaced by this work (NOT fixed here)

`justfile:87`'s `openapi-check` recipe runs `cargo test --lib openapi::emit_ts::`, which selects **zero tests** and exits 0 — so `just check`'s OpenAPI gate is a silent no-op and would pass against a stale `types.ts`. The root `CLAUDE.md` "Quick Reference" quotes the same dead path. Correct filter: `cargo test --lib -p ziee types_ts_parity`. Out of scope for this branch (it is not part of any ITEM and fixing a shared gate belongs in its own reviewed commit); surfaced to the owner in the final report.

**Unresolved drifts:** 0
