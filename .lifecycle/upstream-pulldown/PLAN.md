# PLAN — upstream-pulldown

Cherry-pick the upstream (`ziee-ai/ziee`) commits that fix real defects in code
**paws actually ships and runs**, and nothing else. paws is a deliberately reduced
desktop product on the shared ziee codebase; upstream feature work is out of scope by
construction, because adding it re-expands the surface paws PR #14 reduced.

## Design source

This is a PORT, so the "design" is the originating upstream fix commits and the
defect each one names. Every item below realizes exactly one upstream commit (or one
strict chain of them); no new intent is invented here.

- Realizes upstream `073e0048d` + its RED test `d38b789d5` (MCP response framing).
- Realizes upstream `3a78a0e86` (prefixed tool-call name ownership validation).
- Realizes upstream `009a71f0a` (unreachable-MCP circuit breaker).
- Realizes upstream `2154200f0` → `5e85378d6` → `f8b480e0f` (tool-argument contracts).
- Realizes upstream `ee48f1a77` → `abc8d2429` → `dc834d68a` (agent task-list reconciliation).
- Realizes upstream `beae7c7fb` (llm_repository probe SSRF + per-row health).
- Scope boundary is set by the worker brief
  `/data/khoi/home-workspace/paws-worker-tasks/upstream-sync.md` §"(B) PULL DOWN"
  and by what paws PR #14 (`93ad4a7f0`, `4dcbea150`, `e7d7f35f0`, `43b833641`) hid or
  disabled.

## Invariants

Lifted VERBATIM from the source commits' own statements of what the fix guarantees.

- **INV-1**: a body that parses as JSON is never reconsidered, so no tool content can misroute whatever it contains
- **INV-2**: Trust the prefix only when the per-message tool map confirms that server uniquely advertises the tool; otherwise fall through to the existing bare-name recovery/ambiguity policy (recover the true owner, or refuse rather than misroute)
- **INV-3**: while a server is inside an exponentially-growing cooldown (1s base, doubling, capped at 5min) the breaker returns the cached error immediately without dialing; a successful connect clears it so a recovered server serves on the next call
- **INV-4**: resolve `kind` from either location; refuse a disagreeing pair rather than picking a side; strip the consumed key before persistence
- **INV-5**: one canonical allow-list (code_sandbox::is_known_flavor and friends), applied at both model-facing entry points before any URL is built
- **INV-6**: reconcile_run_terminal(pool, run_id): flip open rows -> 'abandoned' (honest terminal; completed rows preserved)
- **INV-7**: validate the test endpoint before any probe on the unsaved path too (refuse -> unhealthy, no probe, no credential leaves)
- **INV-8**: HF filters the listing by the row's own org (author=&lt;org&gt;) so a nonexistent org yields an empty listing -> unverified (record-only, not auto-disabled), while a real org stays healthy

## Items

- **ITEM-1**: Cherry-pick `d38b789d5` (RED reproduction test) then `073e0048d` — dispatch MCP responses on `Content-Type`, tolerating a mislabelled server only AFTER a strict JSON parse fails; delegate the two hand-rolled SSE extractors to `sse_event_data()`.
- **ITEM-2**: Cherry-pick `3a78a0e86` — validate a `<server_uuid>__<tool>` wire name against the per-message tool map before trusting its prefix.
- **ITEM-3**: Cherry-pick `009a71f0a` — per-server connect-failure circuit breaker in `mcp/client/manager.rs`.
- **ITEM-4**: Cherry-pick `2154200f0` → `5e85378d6` → `f8b480e0f` as a strict chain — enforce the `spawn_background` / `execute_command` argument contracts and the canonical sandbox-flavor allow-list.
- **ITEM-5**: Cherry-pick `ee48f1a77` + `abc8d2429` **squashed into one commit**, then `dc834d68a` — agent task-list terminal reconciliation, incl. migration `202608210100_agent_task_list_reconcile.sql`.
- **ITEM-6**: Cherry-pick `beae7c7fb` — validate `auth_test_api_endpoint` before probing, match the sibling `validate_url`'s `cfg!(debug_assertions)` policy, and grade health against the row's own URL.
- **ITEM-7**: Strip from every pick anything that does not belong on paws main: all `.lifecycle/**` paths, and the stray OpenAPI output under `src-app/server/ui/` that `abc8d2429` committed (upstream itself deleted it in `88081b800`).
- **ITEM-8**: Assert the branch moves **no** submodule gitlink (`sdk`, `agent-kit`, `pgvector`) and adds **no** `GRANDFATHERED` entry to `migration_immutability.rs`.

## Files to touch

Server (all base-identical in paws, so the picks are textual no-conflict except where noted):
- `src-app/server/src/modules/mcp/client/http.rs`, `src-app/server/src/modules/mcp/client/manager.rs`
- `src-app/server/src/modules/mcp/chat_extension/mcp.rs`, `src-app/server/src/modules/mcp/handlers/mod.rs`
- `src-app/server/src/modules/mcp/user_policy/repository.rs`
- `src-app/server/src/common/tool_args.rs` (new)
- `src-app/server/src/modules/background_mcp/tools.rs`
- `src-app/server/src/modules/code_sandbox/{handlers.rs,mod.rs}`
- `src-app/server/src/modules/agent/task_list.rs`, `src-app/server/src/lib.rs`
- `src-app/server/src/modules/agent/migrations/202608210100_agent_task_list_reconcile.sql` (new)
- `src-app/server/src/modules/workflow/{repository.rs,startup_sweep.rs}`
- `src-app/server/src/modules/chat/core/types/streaming.rs`
- `src-app/server/src/modules/llm_repository/{handlers.rs,utils.rs}`
- `src-app/agent-core/src/{tasklist.rs,types.rs}`

Tests:
- `src-app/server/tests/mcp/{mod.rs,response_framing_test.rs}`
- `src-app/server/tests/{background_mcp/*,code_sandbox/*,mcp/run_in_sandbox_test.rs}`
- `src-app/server/tests/agent/task_list_test.rs`
- `src-app/server/tests/llm_repository/{mod.rs,ssrf_probe_test.rs,capability_probe_test.rs,connection_health_test.rs,sync_emit_test.rs,test_connection_user_agent.rs}`
  — `mod.rs` is the ONE expected conflict (paws added `mod default_model_seed_test;`, upstream added `mod ssrf_probe_test;` and rustfmt'd the file). Keep both.

## Patterns to follow

The closest existing module is, in every case, the upstream file being ported — paws
is byte-identical to the merge base in all of them (verified with
`git diff <merge-base> origin/main -- <paths>`). So "match existing patterns" here
means: change nothing about the upstream hunks except dropping out-of-scope paths.
The two files where paws HAS diverged are `server/tests/llm_repository/mod.rs` and
`server/src/lib.rs`; in both, keep paws' hunks and add upstream's alongside.

## Item verdicts (phase 2 — audited against the paws tree)

Below, in the `# PLAN AUDIT` section of this same file (the skill folded the former
separate `PLAN_AUDIT.md` back into PLAN.md).

---

# PLAN AUDIT (phase 2) — audited against the paws tree, before writing code

## Breakage risk

Every touched server file is **byte-identical to the merge base** in paws
(`git diff 7ca09a750 origin/main -- <paths>` empty), so no paws caller has been
rewritten around these functions and no pick can silently revert paws work. The two
exceptions are enumerated in BASE.md and are additive-only.

The one behavioural risk that is NOT a merge risk is ITEM-6: `beae7c7fb` changes the
HuggingFace health probe from a global listing to `?author=<first-path-segment>`, and
paws seeds a mirror row `https://huggingface.co/tinnlab`
(`202607210200_llm_repository_default_model_mirror.sql`). Measured against the live
API this session: `GET https://huggingface.co/api/models?limit=1&author=tinnlab`
returns a non-empty listing (`tinnlab/Qwen3.5-9B-GGUF`), so the row still grades
`healthy`. Even had it not, paws' own `connection_health.rs` states only `unhealthy`
may auto-disable a repository (INV-4 of that feature), so `unverified` is record-only.

ITEM-5 adds `TaskStatus::Abandoned` to `agent-core`. `agent-core`'s `AgentCore` is a
20-field struct literal whose construction sites break on change — but this pick adds
an enum variant, not a field, so no construction site is affected.
`cargo check -p agent-core --tests` is run anyway (the skill's named trap).

## Pattern conformance

The reference module for each item is the upstream file it ports; paws has not
diverged from it. Conformance therefore means "change nothing but the dropped
out-of-scope paths". ITEM-7 is the rule that enforces this.

## Migration collisions

None — see BASE.md. Server max `202607210300`; incoming `202608210100` sorts after it;
`uniq -d` over all prefixes is empty. The immutability hazard is resolved by squashing
`ee48f1a77`+`abc8d2429` rather than by a `GRANDFATHERED` exemption.

## OpenAPI regen

Not implied — no `JsonSchema` type or route signature changes. A non-empty diff in
`src-app/ui/openapi/openapi.json` or either `api-client/types.ts` after the picks would
mean an out-of-scope hunk was dragged in, and is treated as a defect, not as a regen to
run. (Note `abc8d2429` commits a *stray* OpenAPI tree under `src-app/server/ui/` — a
wrong-path artifact upstream itself deleted in `88081b800`. Dropped by ITEM-7.)

## Item verdicts

- **ITEM-1** — verdict: PASS — `mcp/client/http.rs` and `tests/mcp/{mod,response_framing_test}.rs` are base-identical in paws; paws ships and runs the MCP client. Clean pick.
- **ITEM-2** — verdict: PASS — `mcp/chat_extension/mcp.rs` is base-identical. Large (878/409) but no paws divergence. paws hides only the `hub-mcp` marketplace UI, not the MCP client or chat dispatch.
- **ITEM-3** — verdict: PASS — `mcp/client/manager.rs` base-identical; independent of ITEM-2.
- **ITEM-4** — verdict: PASS — touches `background_mcp` and `code_sandbox`, both of which paws ships **enabled** (`desktop/tauri/.../backend/mod.rs:811` forces code_sandbox ON for desktop; `core/config.rs` keeps `bio_mcp`/`background` defaults). Strict chain: `2154200f0` → `5e85378d6` → `f8b480e0f`, same files, each building on the last.
- **ITEM-5** — verdict: CONCERN — the only item with a migration and an `agent-core` change. Concern is procedural, not semantic: `abc8d2429` edits the migration `ee48f1a77` adds, and also commits 58k lines of stray `src-app/server/ui/` output. Resolved by squashing (DEC-3) and by ITEM-7 (DEC-5). Not BLOCKED.
- **ITEM-6** — verdict: CONCERN — one expected trivial conflict in `tests/llm_repository/mod.rs` (keep both `mod` lines), plus the HF-probe behavioural question resolved under *Breakage risk* above. Not BLOCKED.
- **ITEM-7** — verdict: PASS — mechanical; enforced by inspecting `git show --stat` of each pick before committing and by the assertions in ITEM-8.
- **ITEM-8** — verdict: PASS — `git diff origin/main...HEAD -- sdk agent-kit src-app/server/vendor/pgvector` must be empty, and `migration_immutability.rs` must be untouched.
