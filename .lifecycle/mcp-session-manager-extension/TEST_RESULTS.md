# TEST_RESULTS — mcp-session-manager-extension

Binaries built with plain `cargo build -p ziee -p ziee-desktop` from `src-app/`, in the
worktree's own `target/` — never a `tauri` build, which renames the desktop artifact onto
the server binary's path (DEC-6).

- **TEST-1**: PASS — `cargo test -p ziee-desktop --test integration_tests -- --test-threads=1 mcp_routes::`
- **TEST-2**: PASS — same run: `test result: ok. 2 passed; 0 failed`
- **TEST-3**: PASS — `cargo test -p ziee --test integration_tests -- --test-threads=1 mcp::session_manager_extension_test` → `test result: ok. 2 passed; 0 failed`
- **TEST-4**: PASS — `cargo test -p ziee --lib -- mcp::client::manager::tests` → `test result: ok. 1 passed; 0 failed`

## RED proof (skill B7)

Before the fix was restored, with ONLY the three source files stashed and the tests left
in place, against the pre-fix binaries:

```
test result: FAILED. 1 passed; 2 failed
GET /mcp/servers/{id}/tools   status=500
  body=Missing request extension: Extension of type
       `alloc::sync::Arc<ziee::modules::mcp::client::manager::McpSessionManager>`
POST /mcp/system-servers/test-connection  status=500  (same body)
```

That run also earned its keep by exposing a bad test of my own: it reported
`1 passed; 2 failed` where all three should have failed. The third test took a
"no built-in visible → return" branch unconditionally and could never fail. Removed —
see TESTS.md.

The assertions were later made strictly stronger (exact statuses, handler-only error
codes, pre-handler rejection guard), so they remain RED against the pre-fix binary: its
response is a 500 whose body is the missing-extension rejection, which fails the
`MISSING_EXTENSION` assertion directly.

## Regression scope

| run | result |
|---|---|
| `cargo test -p ziee --lib -- openapi::emit_ts:: mcp::` | 372 passed, 0 failed — includes the byte-for-byte `types.ts` parity guard |
| affected MCP subsets, serialized (`mcp::runtime`, `http_transport_test`, `list_tools_for_builder_test`, `test_connection_test`, `builtin_test_connection_test`, `session_manager_extension_test`, `stdio_transport_test`) | 59 passed, 1 failed |

The single failure is `mcp::runtime::test_call_fetch_tool`, and it is **pre-existing, not
introduced here** — proven by checking out `origin/main`'s `src-app/server/src`, rebuilding
and re-running it, where it fails identically.

## Failures classified, not waved at

A full `mcp::` sweep at `--test-threads=6` reported `538 passed; 70 failed`. Classified by
**error signature**, per CLAUDE.md:

- **61 of 70**: `No AI provider API keys found. Please set at least one in tests/.env.test`.
  That file is gitignored and **does not exist anywhere on this box** (checked both this
  worktree and the main clone), so these real-LLM tests are unrunnable here regardless of
  any diff. Category A. My harness error for not sourcing it, not a regression.
- **2**: `bwrap` / sandbox — no rootfs staged in this worktree
  (`.ziee-cache/sandbox-rootfs` holds only an `e2e` dir). Category A.
- **1**: `mcp::conformance_errors_test::error_http_500_surfaces_as_error_not_panic` —
  deterministic, and pre-existing: it drives `HttpMcpClient` against a mock with no router
  involved, and `git diff origin/main...HEAD` over `client/errors.rs`, `client/http.rs`
  and that test file is **empty**. A real defect (the error message carries no status
  code) but someone else's; flagged, not fixed.
- **1**: `mcp::stdio_transport_test::test_stdio_call_echo_tool` — failed at
  `--test-threads=4` with `{"error":"Server is disabled"}` (its create-time health probe
  timed out spawning `npx` under load) and passes at `--test-threads=1`. Load-induced
  flakiness, the "npx/bun install storm" CLAUDE.md documents. Verified it also passes on
  the `origin/main` baseline.
- remainder: `timeout` / `ANTHROPIC` — same real-LLM class.

## Gate

`just` is not installed on this box, so `just check` was run by component. The two that
bear on a Rust-backend change are green:

- `openapi-check` → `cargo test --lib openapi::emit_ts::` — PASS (in the 372 above). No
  handler signature or type changed, so no OpenAPI regen was required for either workspace.
- `check-deadcode-blankets.sh` — exits silently non-zero **in the untouched main clone
  too**, because `ugrep` stands in for GNU grep here and its `grep -rl '#!\[allow(dead_code)\]'`
  matches nothing, tripping `set -e`. Environmental, reproduced on a pristine tree,
  not caused by this change.

`check-mcp-approval`'s integration half (`mcp_approval_loop_`) is in the 61 API-key-blocked
set above.

## Not verified

- No macOS or Windows build (out of scope per the brief).
- The `global()`-only consumers (agent-host resolver, workflow `agent_dispatch`,
  `agent_tool_call`) are pinned at the publication point by TEST-4 but are not driven
  end-to-end on the desktop assembly. Named as a follow-up in TESTS.md.
- The two ESCALATED security findings are recorded, not tested and not fixed.
