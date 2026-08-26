# DECISIONS — mcp-session-manager-extension

### DEC-1: One shared installer, not a second copy of the layer in `lib.rs`

**Resolution:** Extract construct + `set_global` + `spawn_idle_reaper` + the
`Extension` layer into a single function and call it from both `lib.rs::setup_server` and
`main.rs`. Do not simply paste `main.rs:285-295` + `:413` into `lib.rs`.

**Basis:** `lib.rs::setup_server`'s layer stack is already a copy of `main.rs`'s minus
exactly this one layer — the five sibling extensions (`build_auth_context`, `event_bus`,
`jwt_service`, `build_file_context`, `ZieeIdentityResolver`) appear in both in the same
order. That is how this defect was born: two stacks, one edit. A second pasted copy leaves
ten more layers one edit away from the same failure. The brief asks for one shared point
and the evidence supports it.

### DEC-2: `main.rs` keeps its own router assembly; it is not folded into `setup_server`

**Resolution:** `main.rs` calls the shared installer at the equivalent point in its own
chain rather than delegating wholesale to `setup_server`. Full delegation is out of scope
for this fix.

**Basis:** `main.rs` does not call `setup_server` today
(`grep -n "start_server\|setup_server\|run_server" src-app/server/src/main.rs` matches only
a comment at :235) and the two assemblies differ deliberately in two respects:
`apply_rate_limit_layer(app, &config, Some((50, 500)))` at main.rs:366 versus `None` at
lib.rs:623, and main.rs threads `api_doc` into
`control_mcp::catalog::init_from_openapi(&api_doc)` at :360. Collapsing them would change
rate-limiting behaviour for the standalone deployment and move control-MCP catalog
initialisation — both unrelated to this bug and both regression risk. The invariant that
matters (exactly one installation site for the session manager) is satisfied without it.

### DEC-3: `close_all()` on shutdown is NOT moved to the shared path in this fix

**Resolution:** Leave `main.rs:446`'s `mcp_session_manager.close_all()` where it is. Do not
add an equivalent to `run_server`.

**Basis:** It is a no-op today. `McpSessionManager::close_all` operates on the
`sessions` map, and the pooled constructor `get_or_create` (`manager.rs:69-71`, marked
`#[allow(dead_code)]`) has zero callers workspace-wide — every live call path uses
`get_or_create_with_context`, which the doc comment at `manager.rs:106-112` states "always
creates an EPHEMERAL (non-pooled) session". So the map is never populated and there is
nothing to close. Adding a shutdown hook to `run_server` would mean touching the shared
serve path for zero behavioural gain. Recorded as a follow-up: if pooling is ever rewired,
shutdown teardown must be revisited on both entrypoints.

### DEC-4: `McpChatExtension`'s private session manager is left in place

**Resolution:** Do not change `mcp/chat_extension/mcp.rs:810`
(`let session_manager = Arc::new(McpSessionManager::new(config.clone()))`) to prefer
`manager::global()`. Record it as a known duplication with a follow-up note.

**Basis:** It is currently cosmetic rather than load-bearing, for the same reason as DEC-3:
with the pool unused, N managers behave as one — the manager's only live state is the
`Arc<Config>` it carries, which is the same `Arc` everywhere. Changing it would alter chat
session ownership for a path that works today, in a fix whose purpose is to stop MCP routes
returning 500. It becomes a genuine bug the day pooling is rewired (the scheduler builds a
fresh registry, and therefore a fresh manager, per run at `scheduler/dispatch.rs:392`), so
it is worth recording — but fixing it here would widen scope without evidence of harm.

### DEC-5: The regression test lives in the desktop crate, not `tests/mcp/`

**Resolution:** New module under `src-app/desktop/tauri/tests/`, registered in that crate's
`integration_tests.rs`, using `TestServer::start_desktop()`. `src-app/server/tests/mcp/`
gets only the standalone non-regression test (TEST-4).

**Basis:** The blind spot is binary selection, not the harness. All 57 files in
`src-app/server/tests/mcp/` spawn the `ziee` binary via `TestServer::start()`
(`harness_inner.rs:443-451`), whose router never runs the desktop route-builder closure —
so a desktop-assembly defect is structurally invisible to them no matter what they assert.
The desktop crate's `integration_tests.rs` already `#[path]`-includes the same harness and
already drives `start_desktop()` for `remote_access`/`host_mount`, so the new test needs no
harness change — which also keeps skill B3 (never edit `tests/common/*` to route around a
feature's problem) satisfied.

### DEC-7: `install` does construct + `set_global` + reaper + layer in ONE function, and that is what makes a single acceptance test sufficient

**Resolution:** Keep the four steps in one `install(router, config)` rather than exposing
them separately. Do not add a unit test that calls `install` directly.

**Basis:** `set_global` has no HTTP-observable effect, so the `global()` half of INV-1
cannot be asserted over the wire. Because `install` performs it unconditionally on the
line before the `Extension` layer that TEST-1 *does* observe, an observed extension
implies an installed global — the coupling is structural, not incidental. A direct unit
test was the alternative and costs more than it proves: `Config` has no `Default`, and
while every field except the flattened `ServerConfig` carries `#[serde(default)]`,
building a `ServerConfig` in-process to exercise three lines is not a good trade. The
constraint this creates is recorded in TESTS.md: splitting `install` back into separate
steps invalidates the argument and requires a new test for the `global()` half.

### DEC-8: The rejected built-in probe test is documented in place, not silently deleted

**Resolution:** The removed third desktop test is described in a comment in
`mcp_routes/mod.rs` and in TESTS.md, rather than being dropped without trace.

**Basis:** It passed against the pre-fix binary — it took a "no built-in visible →
return" branch, because built-ins are deliberately excluded from
`list_system_mcp_servers`. That is exactly the always-green shape the phase-8 A4 check
exists to refuse, and it was caught only because the RED run showed 1 passed / 2 failed
when all three should have failed. Recording why it cannot work stops it being re-added
by the next person who notices the built-in path is uncovered.

### DEC-6: Build with plain `cargo build`, never a `tauri` build, and assert binary identity

**Resolution:** Build with `cargo build -p ziee -p ziee-desktop` from `src-app/`, in the
worktree's own `target/`. The test setup does not assume which crate a given path holds.

**Basis:** `tauri.conf.json:4` sets `"mainBinaryName": "ziee"`, which collides with the
server crate's `[[bin]] name = "ziee"` (`src-app/server/Cargo.toml:236-238`). In the
owner's clone this collision is live: `target/debug/ziee` is hardlinked to
`target/debug/deps/ziee_desktop-b5783b8793cb97dc` and `target/debug/ziee-desktop` does not
exist at all. Since `harness_inner.rs:445-446` selects the binary by filename, a tree built
that way makes `start_desktop()` unable to find its binary and makes `TestServer::start()`
spawn the desktop crate. This also means `/proc/<pid>/exe` cannot identify which crate a
running instance is — it is what made the first diagnosis of this bug wrong.
