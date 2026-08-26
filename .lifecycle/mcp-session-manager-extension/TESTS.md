# TESTS — mcp-session-manager-extension

TEST-1/2/3 were proven RED against the pre-fix binaries before the fix was restored
(skill B7 — reading the code is not verification). TEST-1 is the literal reported
sequence (skill B9): the UI's Test Connection button.

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-3] file: `src-app/desktop/tauri/tests/mcp_routes/mod.rs` — asserts: on a `TestServer::start_desktop()` instance (the `ziee-desktop --headless` binary, i.e. the `lib.rs::setup_server` assembly), `POST /api/mcp/system-servers/test-connection` returns 200 with a `TestMcpConnectionResponse` body and no missing-extension rejection. Proven RED pre-fix with exactly the reported error.
- **TEST-2** (tier: integration) [covers: ITEM-3] file: `src-app/desktop/tauri/tests/mcp_routes/mod.rs` — asserts: on the same desktop instance, `GET /api/mcp/servers/{id}/tools` as a NON-admin reaches the handler and is refused there with 403 `USER_NO_ACCESS`. Covers the `runtime.rs` family, and deliberately exercises the ownership branch rather than the `has_admin_access` bypass. Proven RED pre-fix.
- **TEST-3** (tier: integration) [covers: ITEM-2] file: `src-app/server/tests/mcp/session_manager_extension_test.rs` — asserts: the same two routes with the same assertions on a `TestServer::start()` instance (the standalone `ziee` binary), so removing `main.rs`'s duplicate block cannot regress the binary that already worked.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1] file: `src-app/server/src/modules/mcp/client/manager.rs` — asserts: `build_session_manager` publishes the process-wide handle (`Arc::ptr_eq` against `global()`) and is idempotent (a second call returns the same instance). Pins the `set_global` half of INV-1, and the idempotency branch, neither of which is observable over HTTP.

## Why both halves of INV-1 are now pinned executably

INV-1 names two mechanisms — the request `Extension` and `manager::set_global`. Only the
first is observable over HTTP.

The first draft of this file argued the second was covered *transitively*, because both
happen inside one function. The round-2 `tests-quality` audit showed that argument
protects against the wrong mutation: the dangerous edit is not someone changing
`build_session_manager`, it is a future `lib.rs` layering
`Arc::new(McpSessionManager::new(cfg))` **directly**, bypassing it. That satisfies every
route test while leaving `global()` unset — the original defect from the other side,
re-breaking workflow `kind: tool` / `kind: agent` steps and the agent-core chat host.

TEST-4 closes that executably, and asserting **pointer identity** rather than `is_some`
is what makes the mutation visible: whatever is layered as the `Extension` must BE the
instance every `global()` reader sees.

The earlier objection — "`Config` has no `Default`" — turned out not to be an obstacle:
`Config` derives `Deserialize` and every field outside the flattened `ServerConfig` is
`#[serde(default)]`, so a minimal `serde_json` fixture builds one, mirroring the style
`core::app_builder`'s own tests already use.

## Coverage: 2 of 11 handlers, deliberately

Eleven handlers take `Extension<Arc<McpSessionManager>>` (8 in `runtime.rs`, 2 in
`test_connection.rs`, 1 in `tool_approvals.rs`). The tests exercise two per binary. The
remainder add no information: the extension is a single top-level `.layer()` on the whole
`app`, with nothing merged after it in either assembly — if it resolves for one route it
resolves for all. Eleven server boots would buy nothing.

**Known limit:** on the tested `test_connection` path the manager is *extracted but never
dereferenced* (`request.id` is `None`, so `probe_builtin_server` is not reached). These
tests prove the extension is PRESENT, not that the manager is USABLE.

## Follow-ups, named rather than dropped

1. **A built-in-server probe test** would prove usability, since `probe_builtin_server`
   dereferences the manager. A first attempt was removed for being vacuous (below); the
   working recipe is to discover a built-in by reading `mcp_servers` directly via
   `server.database_url` with `fetch_one().expect(..)`, so an unseeded DB fails loudly
   instead of skipping.
2. **No test drives a `global()`-only consumer on the desktop assembly.** TEST-4 pins the
   handle's publication; a workflow `kind: tool` step test on `start_desktop()` would pin
   the consumers end-to-end.

## Rejected: a built-in-server probe test (first attempt)

Written, run, and **removed**: built-ins are excluded from `list_system_mcp_servers`, so
its "no built-in visible → return" branch fired unconditionally and it passed against the
*un-fixed* binary. Caught only because the RED run reported `1 passed; 2 failed` where all
three should have failed. Called out in the test file so it is not re-added naively. A
test that cannot fail is worse than none.
