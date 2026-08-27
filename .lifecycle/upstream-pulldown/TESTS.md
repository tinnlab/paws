# TESTS — upstream-pulldown

**Honest deviation, stated up front.** This is a PORT, not new work. A port's proof is
the test that shipped WITH the original fix, re-run in the paws tree: it was written
red-first against the unfixed code upstream, so it is exactly the executable statement
of the invariant, and re-authoring it here would only risk weakening it. Every TEST
below therefore names a real test function that arrives with its pick — none is
newly-written filler, and none is a hollow line added to satisfy the coverage gate.
The `[acceptance]` tests are the subset that would go RED if the invariant they name
were reverted.

The diff is **backend-only** (`src-app/server/**`, `src-app/agent-core/**`), so the
phase-3 frontend rule (a UI diff must enumerate ≥1 `tier: e2e`) does not apply. This
is asserted, not assumed: hygiene rules H1/H2 require the branch to touch no
`src-app/ui/**` or `src-app/desktop/ui/**` path, which the phase-8 gate recomputes
from the real diff.

## ITEM-1 — MCP response framing (INV-1)

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-1] file: `src-app/server/tests/mcp/response_framing_test.rs` — asserts: `plain_json_tool_result_containing_data_colon_parses` — a valid `application/json` tool result whose CONTENT contains the substring `data: ` parses normally instead of entering the SSE branch and dying with "No data found in SSE response". This is the literal defect (`list_citations`, 193,956 bytes, `data: ` at offset 74,437) and goes red if the strict-JSON-first ordering is reverted.
- **TEST-2** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/mcp/response_framing_test.rs` — asserts: `genuine_sse_tool_result_still_parses` — the fix does not break real SSE responses (the regression control).
- **TEST-3** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/mcp/response_framing_test.rs` — asserts: `sse_tool_result_with_no_space_after_data_parses` and `sse_tool_result_split_across_multiple_data_lines_parses` — the two bugs in the hand-rolled extractors that delegating to `sse_event_data()` fixes (a no-space `data:` was dropped; a multi-line payload was truncated to its first fragment).
- **TEST-4** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/mcp/response_framing_test.rs` — asserts: `same_envelope_under_both_content_types_yields_same_result` — framing is decided by Content-Type, so the identical envelope produces the identical result either way.

## ITEM-2 — prefixed tool-name ownership (INV-2)

- **TEST-5** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-2] file: `src-app/server/src/modules/mcp/chat_extension/mcp.rs` — asserts: `resolve_wrong_server_prefix_recovers_true_owner` — a forged `<serverA>__<toolB>` is NOT dispatched to serverA; the true owner is recovered instead. Reverting to "trust the prefix" turns this red, which is what makes it the invariant's proof rather than a restatement of the code.
- **TEST-6** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/modules/mcp/chat_extension/mcp.rs` — asserts: `resolve_ambiguous_tool_with_prefix_refuses` — the fall-through refuses rather than misroutes when ownership is ambiguous.
- **TEST-7** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/modules/mcp/chat_extension/mcp.rs` — asserts: `resolve_builtin_prefix_not_misroutable` — the approval-bypassed built-ins specifically cannot be reached by a forged prefix. This is the security half: misrouting onto a built-in bypassed per-call approval.
- **TEST-8** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/modules/mcp/chat_extension/mcp.rs` — asserts: `resolve_well_formed_uuid_prefix` + `resolve_empty_prefix_recovers_remainder` — the honest cases still resolve (controls).

## ITEM-3 — unreachable-server circuit breaker (INV-3)

- **TEST-9** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-3] file: `src-app/server/src/modules/mcp/client/manager.rs` — asserts: `cooldown_active_suppresses_redial` AND `success_clears_then_attempts` — both halves of the invariant: inside the cooldown the cached error returns without dialing, and a successful connect clears the breaker so a recovered server serves next call. Asserting only the first half would pass with the clear-on-success arm deleted.
- **TEST-10** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/mcp/client/manager.rs` — asserts: `backoff_is_exponential`, `backoff_saturates_at_cap`, `backoff_zero_is_base` — the 1s-base / doubling / 5-min-cap schedule the invariant names.
- **TEST-11** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/mcp/client/manager.rs` — asserts: `no_state_always_attempts` + `window_elapsed_allows_retry` — a healthy server is never suppressed (the control that stops the breaker from being a permanent outage).

## ITEM-4 — tool-argument contracts (INV-4, INV-5)

- **TEST-12** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-4] file: `src-app/server/tests/background_mcp/spawn_contract.rs` — asserts: `nested_kind_sandbox_exec_is_honoured_not_blamed_on_spec_task` — a `kind` nested inside `spec` is resolved rather than dropped-and-defaulted, so the call is not refused with "spec.task must be a non-empty string" naming a field the model deliberately did not send.
- **TEST-13** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-4] file: `src-app/server/tests/background_mcp/spawn_contract.rs` — asserts: `nested_kind_never_silently_runs_the_other_job_kind` — the worse half of the same defect: when the spec also carried `task` the call SUCCEEDED and silently ran a sub-agent instead of the requested command. Pins the "refuse a disagreeing pair rather than picking a side" clause.
- **TEST-14** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-4] file: `src-app/server/tests/background_mcp/spawn_contract.rs` — asserts: `invented_sandbox_flavor_is_refused_before_any_run_row_exists` — an invented flavor is rejected at the background entry point BEFORE any URL is built or run row created (a model invented `zee-workflow` and it reached a live GitHub Releases request).
- **TEST-15** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-4] file: `src-app/server/tests/code_sandbox/tier3_flavor_contract.rs` — asserts: `execute_command_refuses_a_flavor_outside_the_advertised_enum` — the SECOND model-facing entry point. INV-5 says "applied at BOTH"; TEST-14 alone would pass with the chat-side check deleted, so both are required.
- **TEST-16** (tier: integration) [covers: ITEM-4] file: `src-app/server/tests/background_mcp/spawn_contract.rs` — asserts: `unadvertised_spec_key_and_unknown_kind_are_refused_actionably` — `additionalProperties:false` is real, and refusals name the argument with a copyable example.
- **TEST-17** (tier: integration) [covers: ITEM-4] file: `src-app/server/tests/mcp/run_in_sandbox_test.rs` — asserts: the pre-existing sandbox run path still works once the flavor allow-list is interposed (regression control).

## ITEM-5 — agent task-list reconciliation (INV-6)

- **TEST-18** (tier: integration) [acceptance] [invariant: INV-6] [covers: ITEM-5] file: `src-app/server/tests/agent/task_list_test.rs` — asserts: `reconcile_marks_open_rows_abandoned_on_completion` AND `reconcile_leaves_all_completed_run_untouched` — both clauses of the invariant: open rows go `abandoned`, completed rows are preserved. The second is what stops "flip everything terminal" passing as a fix.
- **TEST-19** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/agent/task_list_test.rs` — asserts: `reconcile_marks_open_rows_abandoned_on_failure` + `reconcile_covers_cancel_crash_and_retroactive_paths` — every terminal writer is hooked (runner arm, user cancel, boot sweep), not just the happy completion path.
- **TEST-20** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/agent/task_list_test.rs` — asserts: `sweep_at_boot_reconciles_orphaned_task_rows` — the crash-recovery + retroactive-remediation path, which is what clears the 41/88 already-leaked rows.
- **TEST-21** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/agent/task_list_test.rs` — asserts: `workflow_run_id_fk_populates_and_cascades` — the migration's nullable FK is populated by the existence-guarded subquery and cascades on delete. This is the migration's proof.
- **TEST-22** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/agent/task_list_test.rs` — asserts: `reconcile_run_terminal_primitive_is_run_id_keyed` + `agent_task_list_persists_reads_back_and_isolates_by_run` — reconciliation is scoped to ONE run and cannot bleed across runs.

## ITEM-6 — llm_repository probe SSRF + per-row health (INV-7, INV-8)

- **TEST-23** (tier: integration) [acceptance] [invariant: INV-7] [covers: ITEM-6] file: `src-app/server/tests/llm_repository/ssrf_probe_test.rs` — asserts: `imds_probe_endpoint_is_refused_and_never_receives_the_credential` — an `auth_test_api_endpoint` aimed at `169.254.169.254` is refused and the recording fixture observes **no request at all**, so the row's bearer token never leaves. Asserting only the returned status would pass while the credential still egressed; observing the endpoint is what makes this the invariant's proof.
- **TEST-24** (tier: integration) [acceptance] [invariant: INV-7] [covers: ITEM-6] file: `src-app/server/tests/llm_repository/ssrf_probe_test.rs` — asserts: `saved_row_probe_refuses_a_forbidden_endpoint_without_contacting_it` — the SAVED-row path, not only the unsaved `POST /test` path.
- **TEST-25** (tier: integration) [covers: ITEM-6] file: `src-app/server/tests/llm_repository/ssrf_probe_test.rs` — asserts: `rejected_endpoint_uses_the_modules_existing_failure_shape` (refuse → `unhealthy`, the module's existing shape, not a new error class) + `unsaved_probe_endpoint_is_permission_gated`.
- **TEST-26** (tier: integration) [acceptance] [invariant: INV-8] [covers: ITEM-6] file: `src-app/server/tests/llm_repository/capability_probe_test.rs` — asserts: the HF probe preserves the row's own org as `author=<org>` and an `Unknown` row preserves its path instead of collapsing to the origin — so a nonexistent org yields an empty listing → `unverified` while a real org stays `healthy`.
- **TEST-27** (tier: integration) [covers: ITEM-6] file: `src-app/server/tests/llm_repository/connection_health_test.rs` — asserts: the per-row health grading end-to-end, including that `unverified` is record-only and does not auto-disable.
- **TEST-28** (tier: integration) [covers: ITEM-6] file: `src-app/server/tests/llm_repository/sync_emit_test.rs` — asserts: the existing sync-emit behaviour still holds after the probe rewrite (a regression control that arrives with the pick, in a file this branch modifies). `test_connection_user_agent.rs` is updated by the same pick and passes with it.

## Port hygiene (H1 / H2)

**These are CONTROLS, deliberately NOT enumerated as `TEST-N` of this feature.**
They are pre-existing paws guards and shell assertions that this branch RUNS to show
it broke nothing — it does not author them, and the A11 rule is right to refuse to let
a port claim an earned PASS for someone else's test. Their observed results are
recorded in TEST_RESULTS.md as controls, with the commands, rather than dressed up as
this feature's coverage:

- `src-app/server/tests/migration_immutability.rs` — the pre-existing guard. No
  already-shipped migration was edited and `GRANDFATHERED` did not grow; the squash in
  ITEM-5 exists precisely so it stays green without an exemption. **Not touched by this
  branch, which is the point.**
- `src-app/server/tests/llm_repository/default_model_seed_test.rs` — paws-only, and the
  one place this port could break something upstream could not have noticed: the seeded
  tinnlab mirror row after the probe change.
- The hygiene command itself:
  `git diff origin/main...HEAD --stat -- sdk agent-kit src-app/server/vendor/pgvector src-app/ui src-app/desktop/ui src-app/server/ui`
  must be EMPTY — the mechanical check that no gitlink moved, no stray OpenAPI tree
  landed, and the diff really is backend-only (which is also what makes the phase-3
  frontend e2e rule inapplicable).
