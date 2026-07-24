# TESTS — bg-push-resume

Bipartite coverage: every ITEM ↔ ≥1 TEST. Backend-only diff (no frontend path
touched), so no `tier: e2e` is required by the gate; the integration tier proves
the real end-to-end resume path against a TestServer with a stub model.

## Tests

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/background_mcp/tools.rs` — asserts: the `collect_result` description NO LONGER contains "poll" / "until it is complete", and the `spawn_background` description tells the model to END its turn and that it is re-engaged automatically on completion (regression guard against the polling language creeping back).
- **TEST-2** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/background_mcp/resume.rs` — asserts: `build_resume_message(task, final_text, run_id)` frames a `[Background task complete]` message that CONTAINS the task, the `run_id`, an untrusted-content guard, and the full `final_text` when short.
- **TEST-3** (tier: unit) [covers: ITEM-3, ITEM-5] file: `src-app/server/src/modules/background_mcp/resume.rs` — asserts: `build_resume_message` truncates an over-cap `final_text` to `RESUME_RESULT_MAX_CHARS` and appends a `collect_result` pointer carrying the real `run_id` (so the injected turn never blows context); and the const bounds (`RESUME_MAX_IDLE_WAIT` > `RESUME_POLL_INTERVAL`, both > 0) are sane.
- **TEST-4** (tier: unit) [covers: ITEM-4] file: `src-app/server/src/modules/background_mcp/resume.rs` — asserts: the resume-gate predicate `should_resume(conversation_id, final_text)` returns false when `conversation_id` is `None` OR `final_text` is empty/whitespace, and true only when a conversation id is present AND `final_text` is non-empty (the structural subagent-only + guarded gate).
- **TEST-5** (tier: integration) [covers: ITEM-2, ITEM-3, ITEM-4] file: `src-app/server/tests/background_mcp/resume.rs` — asserts: spawning a `subagent` background run FROM a stub-model conversation drives to completion and AUTOMATICALLY injects a NEW turn into that conversation (a `[Background task complete]` user message + a fresh assistant reply carrying the stub answer) WITHOUT the test ever calling `check_status`/`collect_result` — proving push-to-resume. Reads the branch messages via the REST `GET /conversations/{id}/messages` (owner-scoped) and asserts the new user+assistant pair appeared and the injected user content carries the sub-agent's `final_text`.
- **TEST-7** (tier: integration) [covers: ITEM-3, ITEM-4] file: `src-app/server/tests/background_mcp/resume.rs` — asserts: if the user LOSES access to the run's model between spawn and completion (deterministically: a delayed stub keeps the sub-agent turn in flight while the test deletes the provider→group access row), the resume's fire-time access re-check (mirroring the scheduler) SKIPS the resume — NO `[Background task complete]` turn is injected — while the run still reaches terminal. Covers the security defense-in-depth branch added in the fix round.
- **TEST-6** (tier: integration) [covers: ITEM-4] file: `src-app/server/tests/background_mcp/resume.rs` — asserts: a single sub-agent completion resumes the conversation EXACTLY ONCE (no runaway / double-fire) — after the resumed turn settles and an extra grace wait, the conversation contains exactly ONE `[Background task complete]` user message. This proves the completion fires the resume once (DEC-4 runaway-safety) and is rootfs-free. The subagent-ONLY separation (a `sandbox_exec` completion never resumes) is STRUCTURAL — the hook lives only in `execute_subagent_run`, never `execute_sandbox_run` — and is additionally guarded by TEST-4's `should_resume` gate.

## ITEM ↔ TEST coverage matrix

- ITEM-1 → TEST-1
- ITEM-2 → TEST-5
- ITEM-3 → TEST-2, TEST-3, TEST-5, TEST-7
- ITEM-4 → TEST-4, TEST-5, TEST-6, TEST-7

Accepted-low (defensive log-and-skip branches not separately tested): the
`config-not-initialized`, `model-not-found`, `no-active-branch`, and
`stayed-busy-past-idle-bound` early-returns in `resume_conversation_with_result`
are best-effort defensive paths (they log + skip; the result always remains in the
run row + inbox). The two SUBSTANTIVE branches — the happy resume (TEST-5/6) and
the security access-revoke skip (TEST-7) — are covered; the remaining defensive
returns are low-value to force-trigger and mirror the codebase's log-and-continue
convention.
- ITEM-5 → TEST-3

No ITEM is unmapped. No new permission is introduced (reuses `background::use`),
so no `[negative-perm]` restricted-user e2e is required (A10 N/A). No frontend
path is touched, so no `tier: e2e` is required (phase-3 UI gate N/A).
