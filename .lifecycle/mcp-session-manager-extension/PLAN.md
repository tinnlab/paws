# PLAN — mcp-session-manager-extension

Fix: every MCP runtime REST route returns HTTP 500
`Missing request extension: Arc<McpSessionManager>` on the desktop build, including both
Test Connection routes. Reported by the owner from the UI's Test Connection button.

## Design source

There is no design doc for this area, so the plan is anchored to the **existing written
parity contract in the code**, which is what the defect violates:

- `src-app/desktop/tauri/src/lib.rs:142-147` — the PARITY comment: *"keep this handler
  list in lockstep with the GUI path … if a handler is only registered in the GUI path,
  every test that depends on it silently sees zero side-effects."*
- `src-app/desktop/tauri/src/lib.rs:164-180` and
  `src-app/desktop/tauri/src/modules/backend/server_boot.rs:85-96` — the two near-verbatim
  copies of the *"axum's `.merge()` does NOT propagate parent layers onto merged routes"*
  contract, each enumerating the concrete 405/500 failures that follow from a dropped layer.
- `agent-kit/docs/CODING_GUIDELINES.md` §16 — *"Server-only features disabled on desktop on
  both sides"*: an entrypoint difference must be deliberate and expressed on both sides,
  not an accident of which file got edited.

The defect is the same class those comments describe, one level up: the *server's own*
layer stack differs between `main.rs` and `lib.rs::setup_server`.

## Invariants

- **INV-1**: Every entrypoint that serves the ziee HTTP API installs the MCP session
  manager identically — as a request `Extension` **and** via `manager::set_global` — so an
  MCP route and `global()`-dependent dispatch behave the same on the desktop binary and
  the standalone server binary.

## Items

- **ITEM-1**: Install the MCP session manager (construct + `Extension` layer +
  `manager::set_global` + `spawn_idle_reaper`) in a single shared function used by the
  server assembly, so `lib.rs::setup_server` — and therefore the desktop GUI, desktop
  `--headless`, and `ziee::start_server` — gets what `main.rs` already had.
- **ITEM-2**: Remove `main.rs`'s duplicate construction/injection so exactly one
  installation site exists in the source, without regressing the standalone binary.
- **ITEM-3**: Add desktop-path integration coverage for the MCP REST routes, which today
  have none — every one of the 57 files in `src-app/server/tests/mcp/` spawns the server
  binary, so this entire class of defect is invisible to the suite.

## Files to touch

- `src-app/server/src/lib.rs` — call the shared installer inside `setup_server`.
- `src-app/server/src/main.rs` — delete the duplicated construct/`set_global`/reaper/layer
  block; call the shared installer.
- `src-app/server/src/modules/mcp/client/manager.rs` (or a small sibling module) — home for
  the shared installer function.
- `src-app/desktop/tauri/tests/` — new integration module + registration in
  `integration_tests.rs`.
- `.lifecycle/mcp-session-manager-extension/*` — lifecycle artifacts.

Explicitly NOT touched: `src-app/server/tests/common/harness_inner.rs` (skill B3 — never
edit the shared harness to route around a feature's problem; `TestServer::start_desktop()`
already exists for this).

## Patterns to follow

- The `Extension`-layer idiom already used for the five sibling extensions in both stacks
  (`build_auth_context`, `event_bus`, `jwt_service`, `build_file_context`,
  `ZieeIdentityResolver`) — same placement, same ordering, applied to the composed `app`
  before `cors`.
- `TestServer::start_desktop()` (`harness_inner.rs:521`) for the desktop-path test, the
  same way `remote_access/*` and `host_mount_tests/*` already use it.
- Skill **B9**: the regression test reproduces the reported sequence — the Test Connection
  button, i.e. `POST /api/mcp/system-servers/test-connection` — literally and nothing more.
- Skill **B7**: prove the test RED before the fix; reading the code is not verification.

## Plan audit (phase 2)

Verdicts recorded against the codebase, not against this plan's own prose.

- **ITEM-1** — verdict: PASS — Verified `main.rs` is the sole installer: `main.rs:285`
  constructs, `:291` `set_global`, `:295` `spawn_idle_reaper`, `:413` the `Extension`
  layer. Verified `grep -n "McpSessionManager\|set_global"` over `src-app/server/src/lib.rs`
  and `src-app/server/src/core/` returns zero hits, and `grep -rn` over the whole
  `src-app/desktop/` crate returns zero hits. `setup_server` (lib.rs:493) ends its stack at
  `.layer(cors)` (lib.rs:668) with the five sibling extensions present and this one absent,
  so a single shared installer called from `setup_server` is sufficient and lands in all
  three consumers (`start_server`, `start_server_with_routes` → desktop GUI + `--headless`).
- **ITEM-2** — verdict: CONCERN — `main.rs` does **not** call `setup_server`
  (`grep -n "start_server\|setup_server\|run_server" src-app/server/src/main.rs` matches
  only a comment at :235); it builds and serves its own router at `:351-414` / `:435`. So
  deleting main.rs's block requires main.rs to call the shared installer at the equivalent
  point, not to inherit it. The two stacks also differ deliberately in two ways —
  `apply_rate_limit_layer(app, &config, Some((50,500)))` at main.rs:366 vs `None` at
  lib.rs:623, and main.rs feeds `api_doc` to `control_mcp::catalog::init_from_openapi` at
  `:360` — so full delegation is a larger refactor. Recorded as DEC-2; the shared-installer
  form still yields exactly one installation site, which is the invariant that matters.
- **ITEM-3** — verdict: PASS — Verified the gap is real:
  `grep -rl "TestServer::start_desktop" src-app/server/tests/mcp/` returns nothing, and the
  complete set of API paths any desktop test touches contains exactly one MCP path
  (`/mcp/system-servers`), which `auto_assign_mcp/mod.rs:20-30` deliberately reads via a
  direct sqlx pool rather than HTTP. `TestServer::start_desktop()` exists at
  `harness_inner.rs:521` and is already used by `remote_access/*`, `backend_lifecycle`, and
  `host_mount_tests/*`, so the new module needs no harness change.
