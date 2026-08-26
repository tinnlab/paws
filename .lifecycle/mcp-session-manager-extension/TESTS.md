# TESTS — mcp-session-manager-extension

Every test below was proven RED against the pre-fix binaries before the fix was
restored (skill B7 — reading the code is not verification). TEST-1 is the literal
reported sequence (skill B9): the UI's Test Connection button.

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-3] file: `src-app/desktop/tauri/tests/mcp_routes/mod.rs` — asserts: on a `TestServer::start_desktop()` instance (the `ziee-desktop --headless` binary, i.e. the `lib.rs::setup_server` assembly), `POST /api/mcp/system-servers/test-connection` with a valid admin bearer token returns neither HTTP 500 nor a `Missing request extension` body. Proven RED pre-fix with exactly the reported rejection.
- **TEST-2** (tier: integration) [covers: ITEM-3] file: `src-app/desktop/tauri/tests/mcp_routes/mod.rs` — asserts: on the same desktop instance, `GET /api/mcp/servers/{id}/tools` returns neither 500 nor the missing-extension body, proving the fix covers the whole `runtime.rs` handler family and not only the one route the bug was reported on. Proven RED pre-fix.
- **TEST-3** (tier: integration) [covers: ITEM-2] file: `src-app/server/tests/mcp/session_manager_extension_test.rs` — asserts: on a `TestServer::start()` instance (the standalone `ziee` binary), both routes above still return neither 500 nor the missing-extension body after `main.rs`'s duplicate construction/injection block was deleted in favour of the shared `manager::install`. The non-regression half of the contract: the binary that already worked must keep working.

## Why one acceptance test pins BOTH halves of INV-1

INV-1 names two mechanisms — the request `Extension` and `manager::set_global`. Only
the first is observable over HTTP; `global()` has no route that reveals it.

They are nonetheless pinned by TEST-1, because `manager::install` performs both in one
function and TEST-1 passing proves that function ran on the desktop path:

```rust
let manager = Arc::new(McpSessionManager::new(config));
set_global(manager.clone());          // <- the global half
let _ = manager.spawn_idle_reaper();
let router = router.layer(axum::Extension(manager.clone()));   // <- what TEST-1 observes
```

`set_global` is unconditional and executes before the layer TEST-1 detects, so an
observed Extension implies an installed global. That coupling is the *reason* the fix
is one function rather than two calls — see DEC-7.

**If anyone splits `install` back into separate steps, this argument dies** and the
`global()` half needs its own test. A unit test calling `install` directly was
considered and rejected: `Config` has no `Default` and every field but the flattened
`ServerConfig` is `#[serde(default)]`, so constructing one in-process costs more than
it proves. DEC-7 records that.

## Rejected: a built-in-server probe test

A third desktop test exercising `probe_builtin_server` (which takes the manager by
reference rather than from the extensions) was written, run, and **removed**: built-ins
are excluded from `list_system_mcp_servers`, so its "no built-in visible → return"
branch fired unconditionally and it passed against the *un-fixed* binary. It is called
out in the test file so it is not re-added. A test that cannot fail is worse than none.
