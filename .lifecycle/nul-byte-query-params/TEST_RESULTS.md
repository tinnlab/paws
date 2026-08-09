# TEST_RESULTS

Backend-only diff (`src-app/ui/**` and `src-app/desktop/ui/**` are untouched
except for the mechanically-generated `openapi.json`), so the frontend gates
(`npm run check`, `gate:ui`, e2e) do not apply — see BASE.md and DEC-11.

Full logs: `/data/pbya/ziee/tmp/lifecycle-logs/nul-int-*.log`.

## Unit tier — `cargo test --lib -p ziee`

```
$ cargo test --lib -p ziee text_guard::
test common::text_guard::tests::guard_raw_returns_valid_input_byte_for_byte_unchanged ... ok
test common::text_guard::tests::json_guard_finds_a_nul_at_any_depth_and_in_keys ... ok
test common::text_guard::tests::non_nul_control_characters_are_still_accepted ... ok
test common::text_guard::tests::normalize_text_filter_reproduces_the_replaced_normalization ... ok
test common::text_guard::tests::nul_in_a_filter_is_a_400_not_a_500 ... ok
test common::text_guard::tests::nul_is_rejected_never_silently_stripped ... ok
test common::text_guard::tests::reject_nul_accepts_legitimate_text_and_rejects_nul ... ok
test common::text_guard::tests::the_rejection_message_format_is_the_single_contract ... ok
test common::text_guard::tests::the_two_entry_points_differ_on_blank_and_that_is_the_point ... ok
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 1524 filtered out
```

Wrapper + touched-module unit tier (53 tests, all green — includes every
PRE-EXISTING test in the five modules whose validators changed, unmodified,
which is the behaviour-preservation control):

```
test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 1478 filtered out
```

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-14**: PASS
- **TEST-15**: PASS
- **TEST-16**: PASS
- **TEST-17**: PASS
- **TEST-18**: PASS
- **TEST-23**: PASS
- **TEST-28**: PASS
- **TEST-29**: PASS
- **TEST-31**: PASS

## Integration tier — the enumerated set

```
$ set -a && source server/tests/.env.test && set +a
$ cargo test --test integration_tests -- --test-threads=6 nul_query_param
test background_mcp::nul_query_param_test::background_runs_status_and_kind_reject_nul ... ok
test background_mcp::nul_query_param_test::empty_filter_values_still_filter_and_do_not_widen ... ok
test chat::nul_query_param_test::conversations_search_rejects_nul_before_like_escaping ... ok
test chat::nul_query_param_test::message_search_q_rejects_nul ... ok
test common::nul_query_param_sweep_test::nul_in_a_request_body_text_field_is_also_a_400 ... ok
test common::nul_query_param_sweep_test::nul_is_rejected_on_every_free_text_sql_bound_param ... ok
test common::nul_query_param_sweep_test::non_nul_control_characters_in_a_guarded_param_are_still_accepted ... ok
test common::nul_query_param_sweep_test::the_unfiltered_endpoints_ignore_the_parameter_rather_than_validate_it ... ok
test common::nul_query_param_sweep_test::whitelisted_and_bool_mapped_params_are_unaffected ... ok
test llm_local_runtime::nul_query_param_test::empty_engine_filter_still_filters_and_does_not_widen ... ok
test llm_local_runtime::nul_query_param_test::runtime_versions_engine_filter_rejects_nul ... ok
test mcp::nul_query_param_test::empty_tool_use_id_still_filters_and_does_not_widen ... ok
test mcp::nul_query_param_test::mcp_servers_search_rejects_nul_and_still_searches ... ok
test mcp::nul_query_param_test::mcp_system_servers_search_rejects_nul_behind_the_admin_gate ... ok
test mcp::nul_query_param_test::mcp_tool_calls_tool_use_id_rejects_nul ... ok
test memory::nul_query_param_test::memories_kind_and_source_filters_reject_nul ... ok
test memory::nul_query_param_test::memories_search_rejects_nul_and_still_searches ... ok
test project::nul_query_param_test::projects_search_rejects_nul_and_still_searches ... ok

test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 2529 filtered out; finished in 9.62s
```

- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS
- **TEST-10**: PASS
- **TEST-11**: PASS
- **TEST-12**: PASS
- **TEST-13**: PASS
- **TEST-19**: PASS
- **TEST-20**: PASS
- **TEST-21**: PASS
- **TEST-22**: PASS
- **TEST-24**: PASS
- **TEST-25**: PASS
- **TEST-26**: PASS
- **TEST-27**: PASS
- **TEST-30**: PASS

## Mutation proof — the regression tests are not tautologies

The round-2 audit found the empty-value tests passed under the bug they exist to
catch. After seeding real rows, the fix was re-broken to prove they now bite:

```
# background_mcp/runs.rs: guard_raw -> normalize_text_filter (the round-1 bug)
$ cargo test --test integration_tests -- --test-threads=1 background_mcp::nul_query_param_test
thread '...::empty_filter_values_still_filter_and_do_not_widen' panicked at
  server/tests/background_mcp/nul_query_param_test.rs:107:9:
assertion `left == right` failed: /background/runs?status=: an empty filter value
binds the empty string and must match NOTHING; returning the unfiltered 2 rows is
the widening bug: {... "total":2 ...}
test result: FAILED. 1 passed; 1 failed
```

Restoring `guard_raw` returns it to green (the 18-test run above).

## Live red → green on a running server (isolated, 127.0.0.1:29617)

PRE-FIX and POST-FIX tables, plus the negative controls and the
byte-identical-body proof for the seven "safe" endpoints, are recorded verbatim
in `REPRO_PRE_FIX.txt`. Summary: **12 parameters across 9 routes went 500 → 400**;
both non-text-bound controls stayed 200; the five body-path members went
500 → 400; `search=a%00b` is 400 (not a 200 matching `ab`); `%0A`/`%09`/`%1B`/
`%7F` stay 200.

## Regression run — the modules whose SOURCE this diff changes

Scoped per [[feedback_test_scope]] to the nine modules with changed handlers,
on a settled box at `--test-threads=4`, env exported with `set -a`:

```
$ cargo test --test integration_tests -- --test-threads=4 \
    project:: memory::crud memory::nul assistant:: knowledge_base:: \
    background_mcp::runs background_mcp::nul mcp::nul mcp::list_pagination \
    mcp::tool_call user_group:: chat::conversations_test \
    chat::conversation_search chat::nul llm_local_runtime::nul

test result: FAILED. 273 passed; 4 failed; 0 ignored; 0 measured; 2270 filtered out; finished in 185.35s

failures:
    assistant::sync_emit_test::template_create_is_delivered_to_the_actor_and_every_other_user
    project::injection_test::per_message_assistant_override_keeps_project_block
    project::injection_test::project_conversation_maintains_history_across_turns
    project::injection_test::project_instructions_persist_across_multiple_turns
```

**All 4 failures verified PRE-EXISTING against `dca29493f`** (a worktree cut at
the branch point, built, same command, same exported env):

```
$ # baseline dca29493f
test project::injection_test::per_message_assistant_override_keeps_project_block ... FAILED
test project::injection_test::project_conversation_maintains_history_across_turns ... FAILED
test project::injection_test::project_instructions_persist_across_multiple_turns ... FAILED
test project::injection_test::assistant_and_project_both_shape_response ... ok
test project::injection_test::project_instructions_appear_in_llm_response ... ok
```

Same three, same assertion (`Turn 1 must contain the project-mandated beacon;
got: "Hello! How can I help you today?"`) — Category A: real-LLM tests whose
assertions depend on a live model, run here against placeholder keys.
`assistant::sync_emit_test` was baselined separately (below). **Zero failures
attributable to this diff.**

### Known-failure classification (A/B/C per CLAUDE.md), verified not inferred

- **`memory::recall_fts_test::test_fts_recall_returns_seeded_memories`** and
  **`assistant::sync_emit_test::template_create_is_delivered_to_the_actor_and_every_other_user`**
  — **PRE-EXISTING**. Not asserted: measured. A worktree was cut at the exact
  branch point (`dca29493f`), built, and run with the identical command and
  identical exported env:

  | | branch | baseline `dca29493f` |
  |---|---|---|
  | `memory::recall_fts_test` + `assistant::sync_emit_test` | `1 passed; 2 failed` | `1 passed; 2 failed` |

  Same two tests, same messages (`FTS recall must surface the lexically-matching
  seeded memory; got: []` / `timed out waiting for sync event
  assistant_template/create`). Category A/C — the FTS arm needs a real embedding
  model; neither test touches any code in this diff (the diff does not touch
  `memory_mcp`, the recall path, or any sync emit site).

- **`mcp::tool_call_history_test::chat_path_tool_call_records_source_chat`** —
  Category A. `ANTHROPIC_API_KEY required (source tests/.env.test): NotPresent`;
  `tests/.env.test` ships placeholder keys (`sk-xxx…`).

- **A first regression run reported 79 failures — that was MY harness error, not
  a result.** `source tests/.env.test` without `set -a` leaves the variables
  shell-local, so no child process saw them and every provider-configuring test
  panicked at `helpers.rs:593` (`No AI provider API keys found`). Proven by
  running one of them in isolation: FAILED without the export, `ok` with it. The
  run was discarded and re-run with `set -a`. Recording it because a 79-failure
  log that is really one missing shell flag is exactly the kind of number that
  gets mis-reported as a regression.

## Gate

```
$ cargo check -p ziee --tests
Finished `dev` profile [unoptimized + debuginfo] target(s)   # 0 errors
```

## OpenAPI regen (ITEM-16)

```
$ CONFIG_FILE=server/config/openapi-gen.yaml cargo run --bin ziee -- --generate-openapi ui/openapi
$ CONFIG_FILE=server/config/openapi-gen.yaml cargo run -p ziee-desktop -- --generate-openapi desktop/ui/openapi
 src-app/desktop/ui/openapi/openapi.json | 27 +++++++++++++++++++++++++++
 src-app/ui/openapi/openapi.json         | 27 +++++++++++++++++++++++++++
```

Both workspaces regenerated; `types.ts` regenerates byte-identically (it is
response-type-keyed and carries no status codes), which the repo's own golden
parity test (`openapi::emit_ts::tests::types_ts_parity`, TEST-31) enforces.
Verified in both specs: `Project.list`, `Conversation.list`, `Memory.list`,
`McpServer.listAccessible`, `McpServerSystem.list`, `McpToolCall.list`,
`Message.searchInConversation` now all list `400`.
