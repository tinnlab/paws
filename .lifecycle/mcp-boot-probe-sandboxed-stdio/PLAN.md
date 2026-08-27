# PLAN — mcp-boot-probe-sandboxed-stdio

The boot health sweep auto-disabled the owner's `rcpa` system stdio server with

```
last_health_check_reason = "Command 'Rscript' is not allowed on the host.
  Allowed commands: [npx, uvx, python, python3, node]. Enable run-in-sandbox to use any command."
```

while that row already has `run_in_sandbox = true, sandbox_flavor = full`. The message
tells the admin to enable a thing that is already enabled, and the sweep then disabled
their server.

Cut from `origin/main` @ `8b295b268` — the same base as PR #16, deliberately NOT stacked
on it, so the owner can merge the two in either order.

## Design source

No design doc. The contract this violates is written in this repo, in the sibling of the
function that breaks it — `modules/mcp/connection_health.rs:73-85`:

> Skip the auto-disable probe for: disabled servers …, built-in servers …, AND
> `run_in_sandbox` servers. A sandboxed stdio server's connectivity genuinely requires
> the code_sandbox runtime (lazy rootfs fetch/mount + VM/bwrap spawn), which may not be
> ready at create/enable time — probing it here would either route through an un-mounted
> sandbox (false failure → wrong auto-disable …) or, **if we probed the raw command on
> the host, false-fail any guest-only command**.

That paragraph predicts this bug exactly. `enforce_on_create` (`:85`) and
`enforce_on_update` (`:188`) both honour it; `run_startup_health_check` does not.

Also binding: CODING_GUIDELINES §5 (cleanup/ownership — an ownership-bound mutation must
not be a silent side effect) and §6 (never silently swallow; preserve error context).

## Invariants

- **INV-1**: A server whose row says `run_in_sandbox = true` is never probed on the host
  path, and is never told to "enable run-in-sandbox".
- **INV-2**: The boot sweep never mutates `enabled`. It records health; only an explicit
  user action (create / enable) may disable a server.

## Items

- **ITEM-1**: `run_startup_health_check` skips `run_in_sandbox` servers, matching the
  guard its two siblings already apply, and records them as untested-because-sandboxed
  rather than probing.
- **ITEM-2**: The boot sweep stops flipping `enabled = false`. It records
  `unhealthy` + reason so the badge still surfaces the problem, and leaves the admin's row
  alone. `enforce_on_create` / `enforce_on_update` keep their auto-disable, because there
  a human is acting and gets immediate feedback.
- **ITEM-3**: The boot sweep waits for `code_sandbox::init` to reach a verdict before
  probing, instead of racing it. `config::init_status()` is `NotInitialized` until
  `code_sandbox::init()` sets one of its five terminal values on every exit path, so it is
  a sound readiness signal. Bounded wait; a timeout logs and proceeds.
- **ITEM-4**: The host-path rejection names the real cause. When `run_in_sandbox` is set
  but the native path was taken, say the sandbox runtime was unavailable — do not tell the
  admin to enable a flag their row already has.
- **ITEM-5**: Test Connection stops claiming it can validate a sandboxed server. It always
  probes on the host (`build_ephemeral_server` hardcodes `run_in_sandbox: false` and
  `TestMcpConnectionRequest` has no such field), so for a stored sandboxed row it must say
  so rather than emit the same misleading message.

## Files to touch

- `src-app/server/src/modules/mcp/connection_health.rs` — ITEM-1, ITEM-2, ITEM-3.
- `src-app/server/src/modules/mcp/client/stdio.rs` — ITEM-4 (the rejection message).
- `src-app/server/src/modules/mcp/handlers/test_connection.rs` — ITEM-5.
- `src-app/server/tests/mcp/` — new integration coverage.
- `.lifecycle/mcp-boot-probe-sandboxed-stdio/*`.

Explicitly NOT touched: the `sdk/` submodule. `config::init_status` is already re-exported
through `modules/code_sandbox/mod.rs:48-51`, so ITEM-3 needs no submodule change or
gitlink bump.

## Patterns to follow

- The sibling guard at `connection_health.rs:85` — same predicate, same rationale comment.
- `record_health_check_on(&pool, id, status, reason)` for status writes; it already exists
  and is used by both arms of the sweep.
- Skill **B9**: reproduce the reported failure literally first — a `run_in_sandbox` stdio
  row with `command: Rscript` surviving a boot sweep enabled.

## Plan audit (phase 2)

- **ITEM-1** — verdict: PASS — Verified `grep -n run_in_sandbox connection_health.rs`
  returns `:75` (the rationale), `:85` (create guard), `:185`/`:188` (update guard) and
  nothing inside `run_startup_health_check` (`:306`+). The asymmetry is real and the
  rationale for the guard is written at the create site.
- **ITEM-2** — verdict: CONCERN — this is a deliberate behaviour change. The current
  docstring justifies auto-disable as "failures flip to `enabled:false` automatically so
  users don't see broken servers in their tool lists" (`:14-16`). Removing it means a
  genuinely unreachable server stays enabled and its tools fail at call time instead of
  being hidden. I judge that better than silently undoing an admin's configuration on a
  transient boot-time failure — which is exactly what happened here — and the health badge
  still surfaces it. Recorded as DEC-2 with the tradeoff stated.
- **ITEM-3** — verdict: PASS — `config::set_init_status` is called on all five exit paths
  of `code_sandbox::init` (`code_sandbox/mod.rs:157, 183, 195, 213, 318`), including the
  `enabled: false` early return, so `init_status() != NotInitialized` is a sound
  "init has concluded" signal. Confirmed the race is real: `mcp` is module `order: 65`
  (`mcp/mod.rs:45`), `code_sandbox` is `order: 70` (`code_sandbox/mod.rs:90`), and
  `mcp::init` `tokio::spawn`s the sweep fire-and-forget (`mcp/mod.rs:85-88`), so on a
  multi-thread runtime it can run before `init_state`.
- **ITEM-4** — verdict: PASS — the string is `stdio.rs:341` inside `create_command`,
  reachable only from `connect_native`, taken only when `should_sandbox()` is false
  (`stdio.rs:115-119`). `connect_native` has `self.server_config.run_in_sandbox` in scope,
  so it can distinguish the two cases without new plumbing.
- **ITEM-5** — verdict: PASS — verified `TestMcpConnectionRequest` (`mcp/types.rs:148-174`)
  declares no `run_in_sandbox`, and `build_ephemeral_server` hardcodes it false
  (`test_connection.rs:176`). Demonstrated live against a desktop instance: Test Connection
  on `command: Rscript` returns the identical misleading message. Extending the request
  type to honour the flag would change the public API and require an OpenAPI regen for both
  workspaces; making the response honest is the smaller correct fix. Recorded as DEC-4.
