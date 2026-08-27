# TEST_RESULTS — upstream-pulldown

The single full run of the enumerated set. Phase-7 rounds ran scoped subsets and
their results stand.

## Commands, with their OWN exit codes

Exit codes captured with `; echo "EXIT=$?"` after a plain redirect — **never through
a pipe**, so no `tail`/`grep` status is being reported in place of the command's.

```
cd src-app && cargo check --workspace --all-targets            EXIT=0
cargo test --lib -p ziee -- llm_repository:: background_mcp::  EXIT=0   71 passed, 0 failed
cd src-app/server && cargo test --test integration_tests -- --test-threads=6 \
    mcp:: background_mcp:: agent:: llm_repository:: code_sandbox::
                                                               EXIT=101 743 passed, 109 failed
```

The integration run is RED, and the 109 are classified below rather than waved at.

## Per-TEST verdicts

- **TEST-1**: PASS — `mcp::response_framing_test::plain_json_tool_result_containing_data_colon_parses`
- **TEST-2**: PASS — `…::genuine_sse_tool_result_still_parses`
- **TEST-3**: PASS — `…::sse_tool_result_with_no_space_after_data_parses` + `…::sse_tool_result_split_across_multiple_data_lines_parses`
- **TEST-4**: PASS — `…::same_envelope_under_both_content_types_yields_same_result`
- **TEST-5**: PASS — `mcp::chat_extension::mcp` unit `resolve_wrong_server_prefix_recovers_true_owner` (in `cargo check --all-targets` + the lib suite)
- **TEST-6**: PASS — `resolve_ambiguous_tool_with_prefix_refuses`
- **TEST-7**: PASS — `resolve_builtin_prefix_not_misroutable`
- **TEST-8**: PASS — `resolve_well_formed_uuid_prefix` + `resolve_empty_prefix_recovers_remainder`
- **TEST-9**: PASS — `mcp::client::manager` unit `cooldown_active_suppresses_redial` + `success_clears_then_attempts`
- **TEST-10**: PASS — `backoff_is_exponential`, `backoff_saturates_at_cap`, `backoff_zero_is_base`
- **TEST-11**: PASS — `no_state_always_attempts` + `window_elapsed_allows_retry`
- **TEST-12**: PASS — `background_mcp::spawn_contract::nested_kind_sandbox_exec_is_honoured_not_blamed_on_spec_task`
- **TEST-13**: PASS — `…::nested_kind_never_silently_runs_the_other_job_kind`
- **TEST-14**: PASS — `…::invented_sandbox_flavor_is_refused_before_any_run_row_exists`
- **TEST-15**: PASS — `code_sandbox::tier3_flavor_contract::execute_command_refuses_a_flavor_outside_the_advertised_enum`
- **TEST-16**: PASS — `…::unadvertised_spec_key_and_unknown_kind_are_refused_actionably`
- **TEST-17**: PASS — `mcp::run_in_sandbox_test` (tier-3 arm; the rootfs-needing arms are Category A below)
- **TEST-18**: PASS — `agent::task_list_test::reconcile_marks_open_rows_abandoned_on_completion` + `…::reconcile_leaves_all_completed_run_untouched`
- **TEST-19**: PASS — `…::reconcile_marks_open_rows_abandoned_on_failure` + `…::reconcile_covers_cancel_crash_and_retroactive_paths`
- **TEST-20**: PASS — `…::sweep_at_boot_reconciles_orphaned_task_rows`
- **TEST-21**: PASS — `…::workflow_run_id_fk_populates_and_cascades` (the migration's proof)
- **TEST-22**: PASS — `…::reconcile_run_terminal_primitive_is_run_id_keyed` + `…::agent_task_list_persists_reads_back_and_isolates_by_run`
- **TEST-23**: PASS — `llm_repository::ssrf_probe_test::imds_probe_endpoint_is_refused_and_never_receives_the_credential`
- **TEST-24**: PASS — `…::saved_row_probe_refuses_a_forbidden_endpoint_without_contacting_it`
- **TEST-25**: PASS — `…::rejected_endpoint_uses_the_modules_existing_failure_shape` + `…::unsaved_probe_endpoint_is_permission_gated`
- **TEST-26**: PASS — `llm_repository::utils::tests::capability_url_targets_the_kinds_listing_surface` (repaired in FIX_ROUND-1; was RED on upstream main)
- **TEST-27**: PASS — `llm_repository::connection_health_test`, **except** the one live-HF case classified A-3 below
- **TEST-28**: PASS — `llm_repository::sync_emit_test` (+ `test_connection_user_agent`, updated by the same pick)

## Controls — run, passing, and deliberately NOT claimed as this feature's tests

A11 refuses to let a branch record an earned PASS for a test it did not author, and it
is right to. These three are pre-existing paws guards and a shell assertion; this
branch RUNS them to show it broke nothing. Results, with the commands:

- `migration_immutability` — **PASS.** No already-shipped migration was edited and the
  `GRANDFATHERED` list did not grow. This branch does not touch that file, which is the
  point: the ITEM-5 squash exists so the guard stays green without an exemption.
- `llm_repository::default_model_seed_test` — **PASS.** The paws-only test, and the one
  place this port could have broken something upstream could not have noticed: the
  seeded tinnlab mirror row still behaves as paws expects after the probe rewrite.
- Hygiene command — **output EMPTY**, as required:
  `git diff origin/main...HEAD --stat -- sdk agent-kit src-app/server/vendor/pgvector src-app/ui src-app/desktop/ui src-app/server/ui`
  So: no submodule gitlink moved, no stray OpenAPI tree landed, and the diff is
  backend-only — which is also what makes the phase-3 frontend e2e rule inapplicable.

`npm run check` is **not applicable**: the diff touches no frontend workspace, which
TEST-31 asserts mechanically rather than by assertion. That is also why no `tier: e2e`
test is enumerated.

## The 109 failures — every one classified, with its signature

Per CLAUDE.md's rule: classify before claiming a regression, and never soft-skip an
A/B failure without naming the category AND its error signature.

| n | signature (verbatim) | category |
|---|---|---|
| 61 | `No AI provider API keys found. Please set at least one in tests/.env.test` | **A** — `src-app/server/tests/.env.test` is absent on this box (established at plan time). Every `mcp::mcp_approval_workflow_test`, `mcp_sampling_test`, `mcp_extension_test`, `mcp_streaming_workflow_test`, `mcp_loop_settings_test`, `mcp_elicitation_test` failure is this. |
| 15 | `spawn squashfuse (apt install squashfuse fuse3): Os { code: 2, kind: NotFound }` | **A** — squashfuse is not installed here; CLAUDE.md lists it as a required runtime dep for the sandbox tiers. |
| ~28 | `rootfs download failed: sha256 mismatch …`, `rename downloaded asset into cache: NotFound`, `rootfs lacks python3`, `called Option::unwrap() on a None value` (all in `code_sandbox::tier4_*/tier6_*/tier8_*`, `background_mcp::sandbox`, `workflow_mcp::*`) | **A** — no rootfs is staged: the server logs `rootfs version pinned at v0.0.5-alpha; downloaded flavors = []`. |
| 1 | `ANTHROPIC_API_KEY required (source tests/.env.test): NotPresent` — `mcp::tool_call_history_test::chat_path_tool_call_records_source_chat` | **A** — same missing `.env.test`. |
| 1 | `HUGGINGFACE_API_KEY not set. Please source tests/.env.test` — `llm_repository::connection_health_test::create_enabled_huggingface_repo_probes_live_and_persists_healthy` | **A** — same. Note this test is one `beae7c7fb` itself corrects; the correction is present, it simply cannot run without the key. |
| 1 | `mcp::stdio_transport_test::test_stdio_disconnect_server` — needs the `npx everything-server` stdio child | **A** — external package fetch; CLAUDE.md names the stdio-MCP `npx`/`bun` install storm as a known environmental cost. |
| 1 | `mcp::runtime::test_call_fetch_tool` — `assertion left == right failed: Should not be an error` | **A (inferred, flagged as inferred)** — a live outbound fetch tool. Not per-test verified; stated as inferred rather than asserted. |
| 1 | `mcp::conformance_errors_test::error_http_500_surfaces_as_error_not_panic` — `expected error to reference HTTP 500 / server error; got: MCP server 'mock-mcp' returned an invalid or unsuccessful response.` | **PRE-EXISTING UPSTREAM RED — verified, not assumed.** See below. |

### The one that needed a control run

`error_http_500_surfaces_as_error_not_panic` lives in `tests/mcp/conformance_errors_test.rs`
and exercises `mcp/client/http.rs`, which `073e0048d` — one of these picks — rewrote. That
made it a candidate regression, so I did not classify it from its signature. Two facts settle
it:

1. The test file is **byte-identical** between the repos
   (`git diff upstream/main origin/main -- <that file>` is empty), and exists upstream.
2. I ran it in the **upstream-port worktree** — `ziee-ai/ziee` `main` plus the push-up
   branch, which touches `mcp/client/http.rs` not at all — and it **FAILS there too**,
   alongside 15 sibling `conformance_errors_test` cases that all PASS.

So upstream ships it red and the pull-down inherited it faithfully; the pick did not cause
it. Diagnosis for the upstream report: HTTP 500 falls into `classify_upstream_status`'s `_`
catch-all → `UpstreamFailure::Protocol`, whose `message()` is deliberately status-free
("static template + the server's own display name only"). The test's contract — the error
must reference the status — cannot be met without a new `UpstreamFailure` variant. That is
surgery on shared error classification, out of scope for a port, so it is **reported, not
fixed** (a third red test on upstream main, after the two ITEM-11 fixed).

## What this run does and does not establish

It establishes that every behaviour these nine picks add is exercised and green, that the
migration applies and its FK cascades, and that nothing in paws' own `llm_repository`
default-model work regressed. It does **not** establish anything about the sandbox
execution path or any real-LLM chat path on this box — those need squashfuse + a staged
rootfs + API keys, none of which are present, and all of their failures are in files these
picks do not touch.
