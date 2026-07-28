# BASE — conflict surface vs the branch base

Base ref for this branch and for every lifecycle gate: **`origin/feat/agent-core`**
(NOT `origin/main` — this work never merges to main; the default base would
misattribute the whole agent-core diff to this branch).

Branch: `fix/ask-user-stringified-schema`, cut from `origin/feat/agent-core`
at `d53db2d11`.

Every gate invocation therefore carries `--base origin/feat/agent-core`:

```
node .claude/lifecycle/lifecycle-check.mjs --phase N \
  --repo /data/pbya/ziee/tmp/ask-user-schema-wt \
  --dir .lifecycle/ask-user-stringified-schema \
  --base origin/feat/agent-core
```

## Inherited lifecycle dirs — never delete one

The base carries 17 sibling `.lifecycle/` dirs (`agent-orchestration`,
`background-in-conversation`, `chat-ui-robustness`, `control-describe-schema`,
`control-mcp-e2e-coverage`, `e2e-render-serving`, `frontend-perf`,
`hook-lint-guardrails`, `live-ui-audit-fixes`, `live-ui-audit-round2`,
`net-hygiene`, `perf-ux-round2`, `smart-module-loading`, `sse-slot-leak`,
`streamdown-html-renderer`, `workflow-kind-agent`, `worktree-isolation`). They are
INHERITED, not ours. Before every commit:

```
git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle   # must be empty
```

## Migrations

Migrations in this repo are **per-module**
(`src-app/server/src/modules/*/migrations/`), not one flat dir. Highest existing
by filename across `src-app`: `202607191300_agent_delegate_enabled.sql`.

**This branch adds NO migration** — it introduces no table, no column and no
permission. There is no number to collide and no new permission, so the A9/A10
authz gates do not apply.

## Known BASELINE breakage (pre-existing; NOT caused by this branch)

`cargo check --workspace --tests` on the untouched base fails to compile ONE
test target:

```
error[E0063]: missing fields `isolate_children` and `schedule` in initializer of `AgentCore`
   --> agent-core/tests/real_llm_loop.rs:143:16
   --> agent-core/tests/real_llm_loop.rs:221:16
error: could not compile `agent-core` (test "real_llm_loop") due to 2 previous errors
```

Reproduced on a pristine worktree at `d53db2d11` BEFORE any edit of ours (log:
`/tmp/claude-1000/.../tasks/b1qea64fk.output`). `src-app/agent-core` is not a
file this branch touches. Backend verification on this branch is therefore
scoped to `-p ziee` (`cargo check -p ziee --tests`), which compiles clean on the
same base. Recorded here so a reader does not mistake it for a regression; it is
NOT fixed here (out of scope, and fixing another team's in-flight crate from a
bugfix branch is exactly the shared-infrastructure edit rule B3 forbids).

## Files this branch touches that the base is also moving

- `src-app/server/src/modules/mcp/chat_extension/helpers.rs` — the `ask_user`
  inline-elicitation path landed on `feat/agent-core` recently and the base is
  still moving this file (tool-loop + agent work). Active area; re-merge
  `origin/feat/agent-core` before hand-off.
- `src-app/server/src/modules/control_mcp/handlers.rs` — the control feature and
  the sibling `control-describe-schema` fix round both land here. HIGH collision
  probability. Our edit is confined to `invoke_capability`'s argument-decoding
  preamble + a new `#[cfg(test)]` block appended to the existing tests module.
- `src-app/server/src/modules/mcp/elicitation/models.rs` — small, stable; touched
  only to add a diagnostic for a non-object ingress schema.
- `src-app/server/src/utils/mod.rs` — one added `pub mod` line. Trivially
  conflict-prone, trivially resolved.
- `src-app/ui/src/modules/chat/**` (elicitation renderer) — the base's
  `chat-ui-robustness` round moves chat UI files. Check before hand-off.
- `src-app/server/tests/mcp/mod.rs` / `src-app/server/tests/control_mcp/mod.rs` —
  appended to (new test module declarations); the base also appends here.
- NEW files (no textual conflict possible): `src-app/server/src/utils/json_arg.rs`,
  the new integration test file(s), the new e2e spec.

## OpenAPI regen

**Not implied.** This branch changes no `#[derive(JsonSchema)]` type, adds no REST
handler and changes no handler signature. `ask_user` and `invoke_capability` are
JSON-RPC surfaces served from untyped `axum::response::Response`, so their payload
shapes are not in `openapi.json`. `requested_schema` is already
`serde_json::Value` in `ElicitationStartedNotification` /
`SSEChatStreamMcpElicitationRequiredData` and its Rust type does not change — only
the VALUE that flows through it. No `just openapi-regen`, and the
`types_ts_parity` golden test is unaffected.

If that assessment turns out wrong at implementation time, the drift log records
it and the regen runs for BOTH binaries (server `ui/` + desktop `desktop/ui/`).

## Cross-repo note

`sdk/` is a git submodule. This branch does **not** modify it; the submodule
pointer is left exactly as the base has it.
