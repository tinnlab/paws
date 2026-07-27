# TEST_RESULTS — control-mcp-e2e-coverage

All runs below are REAL runs in this worktree, against the configured test LLM
(`provider=OpenAI model=qwen3.6-35b-a3b base_url=http://localhost:4000/v1`).
Nothing here is a self-skip counted as a pass; the two real-LLM Rust tests print
the resolved LLM so the log proves they executed.

Full logs: `/data/pbya/ziee/tmp/lifecycle-logs/`.

## Backend

```
cargo test --lib -p ziee -- control_mcp:: title::
  → test result: ok. 43 passed; 0 failed; 0 ignored

source tests/.env.test
cargo test --test integration_tests -- --test-threads=4 control_mcp:: chat::title
  → test result: ok. 34 passed; 0 failed; 0 ignored      (final-int.log)
```

## Frontend / e2e

```
cd src-app/ui && npm run check                → PASS  (exit 0)
cd src-app/ui && npm run lint:hooks           → OK, 0 violations across 2473 files
cd src-app/desktop/ui && npm run check        → PASS  (exit 0)

ZIEE_E2E_LOCK_DIR=/data/pbya/ziee/tmp/control-e2e-locks \
ZIEE_E2E_BASE_VITE_PORT=55000 ZIEE_E2E_BASE_BACKEND_PORT=56000 \
ZIEE_E2E_BASE_PG_PORT=62000 \
npx playwright test tests/e2e/control/ --workers=1
  → 12 passed, 0 failed, 1 flaky (7.0m)                  (control-e2e-full2.log)
```

The 12 include the 2 pre-existing `control-admin-toggle` specs. The one "flaky"
is `denying the control write leaves nothing created — Project.create`: the local
35B model did not reach the mutating invoke on the first attempt, and the spec's
existing `retries: 2` (the established convention for every real-LLM spec in this
repo) passed it on retry #1. Reported as flaky, not silently as a clean pass.

`npm run check (ui): PASS`
`npm run check (desktop/ui): PASS`
`gate:ui (ui): N/A — the diff touches no `src-app/ui/src/**` file` (see below)

**Why no `gate:ui` run:** the frontend half of this diff is entirely
`src-app/ui/tests/e2e/control/**` (Playwright specs + a spec helper). No page,
component, store, route, style token or gallery state is added or changed, so
there is no surface for the gallery runtime-health / visual-regression pass to
cover. `npm run check` (which includes `check:state-matrix`,
`check:gallery-coverage`, `check:overlay-registry` and the design-spec/kit
gates) passes unchanged in both workspaces, confirming no conditional render
state was introduced.

## Per-TEST results

- **TEST-1**: PASS — `control_mcp::handlers::tests::create_project_query_matches_and_ranks_project_create_first`. Encodes the bug: asserts the SHIPPED whole-phrase matcher scores 0 on the fixture, then asserts the new matcher ranks `Project.create` first for `"create project"`.
- **TEST-2**: PASS — `control_mcp::handlers::tests::all_terms_must_match_possibly_via_different_fields`.
- **TEST-3**: PASS — `control_mcp::handlers::tests::single_term_parity_case_insensitivity_and_empty_query` (+ `id_segments_splits_on_punctuation_and_camel_case`).
- **TEST-4**: PASS — `control_mcp::multi_word_query_finds_and_ranks_the_named_operation`, over the REAL ~370-op catalog through the real JSON-RPC surface.
- **TEST-5**: PASS — `title::tests::title_request_is_reasoning_safe`.
- **TEST-6**: PASS — `title::tests::retry_only_on_budget_exhaustion_with_no_text` (+ `empty_title_error_names_the_budget_in_force`).
- **TEST-7**: PASS — `chat::title_test::title_request_carries_the_reasoning_safe_token_budget` (updated) and `chat::title_test::an_empty_generation_leaves_the_title_unset_not_the_raw_message` (unchanged, still exactly ONE title call — proving the retry does not fire on `finish_reason: "stop"`).
- **TEST-8**: PASS — `chat::title_test::a_budget_exhausted_title_attempt_is_retried_at_a_larger_budget`.
- **TEST-9**: PASS — `chat::title_real_llm_test::a_real_model_first_exchange_produces_a_title`; log line: `generated title: "New Project Creation Request"`.
- **TEST-10**: PASS — `chat::helpers::configured_test_llm_tests::*` (5 tests: OpenAI-without-Anthropic, Anthropic seam, global fallback, bare SaaS key, nothing-configured).
- **TEST-11**: PASS — `control_mcp::real_llm_test::{real_llm_discovers_capabilities, real_llm_write_requires_approval}`; both printed `driving the configured test LLM: provider=OpenAI model=qwen3.6-35b-a3b base_url=http://localhost:4000/v1`. On the base branch these SKIPPED (no `ANTHROPIC_API_KEY`).
- **TEST-12**: PASS — `control-spec-gating.spec.ts` (3 tests): no vendor key in any gate, no direct `process.env` in a gate, every gated control spec routes through `configuredTestLlm()`.
- **TEST-13**: PASS — `control-tool-in-chat.spec.ts` "a plain-language request is DISCOVERED, forced through approval, and really creates the project".
- **TEST-14**: PASS — the approval-forced leg of TEST-13 plus both table rows (`Assistant.create`, a second `Project.create` phrasing) and the settings row.
- **TEST-15**: PASS — approve → entity exists via REST: `Project.create` (`GET /api/projects`), `Assistant.create` (`GET /api/assistants`), `MemorySettings.update` (`GET /api/memory/settings` → `retrieval_enabled` flipped).
- **TEST-16**: PASS — "denying the control write leaves nothing created" for `Project.create` (retry #1) and `Assistant.create`.
- **TEST-17**: PASS — `control-negative-perm.spec.ts`, both halves: NOT OFFERED (`User.delete` absent for the restricted user, present for the admin positive control, `describe_capability` refused) and DENIED (offered-but-unpermitted `Project.create`, approved, still zero projects).
- **TEST-18**: PASS — the "chat reflects it" leg of TEST-13 (`invoke_capability` recorded on the conversation's tool-call history after approval).

## Regression proofs (the tests FAIL on the pre-fix code)

Both were executed, not asserted. The file under test was temporarily replaced
with its `origin/feat/agent-core` version, the test re-run, then restored.

| test | pre-fix result | failure message |
|---|---|---|
| TEST-4 (search) | **FAILED** | `'create project' must match at least one operation (got 0)` |
| TEST-9 (title) | **FAILED** | `generated title is empty: the model exhausted the 512-token budget (finish_reason=length) without emitting answer text` → `the conversation is UNTITLED after a real first exchange through OpenAI / qwen3.6-35b-a3b` |

Logs: `search-PREFIX.log`, `title-real-llm-PREFIX.log`.
