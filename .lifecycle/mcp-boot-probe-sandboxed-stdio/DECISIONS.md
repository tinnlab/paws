# DECISIONS — mcp-boot-probe-sandboxed-stdio

### DEC-1: Separate branch and PR, cut from the same base as #16, not stacked on it

**Resolution:** Branch `fix/mcp-boot-probe-sandboxed-stdio` off `origin/main` @ `8b295b268`
— the base PR #16 uses. The dependency is noted in the PR body, not encoded in git.

**Basis:** #16 is finished, twice-audited and gate-green awaiting the owner's merge;
folding a second defect in would reopen it and restart that audit. Stacking would make
this PR unmergeable until #16 lands and would take away the owner's freedom to order them.
There IS a real dependency — diagnosing the boot race by re-probing needs Test Connection,
which is the route #16 repairs — but it is a *diagnosis* dependency, not a code one:
nothing in this branch's diff requires #16's changes to compile or pass.

### DEC-2: The boot sweep records health but no longer mutates `enabled`

**Resolution:** Delete the auto-disable from `run_startup_health_check` only. Keep it in
`enforce_on_create` and `enforce_on_update`.

**Basis:** This is a deliberate behaviour change and it costs something. The existing
docstring justifies auto-disable as "failures flip to `enabled: false` automatically so
users don't see broken servers in their tool lists" — after this change, a genuinely
unreachable server stays enabled and its tools fail at call time instead of being hidden.

I judge that the better failure. The boot sweep runs with no human present, against
whatever transient state the machine is in, and its mutation silently undoes an admin's
configuration — which is exactly what happened to the `rcpa` row, for a reason that was
not even the server's fault. The health badge and `last_health_check_reason` still surface
the problem, so the information is not lost; only the destructive side effect is. The
create/enable paths keep auto-disable because there a human just acted and sees the result
immediately, which is the case the original rationale actually fits.

The line this draws: **a background sweep may record, only a user action may disable.**

### DEC-3: Wait on `init_status()` rather than reordering the modules

**Resolution:** The sweep waits (bounded) for `code_sandbox::config::init_status()` to
leave `NotInitialized`, instead of moving `mcp` after `code_sandbox` in module order or
hoisting the sweep out of `init` into the two boot call sites.

**Basis:** Module `order` is a shared, cross-cutting resource — renumbering `mcp` from 65
to above 70 would silently reorder it against every other module's init and route
registration, for one dependency. Hoisting the sweep into `main.rs` + `lib.rs::setup_server`
would create the second call site whose drift is the exact defect PR #16 exists to fix.
Waiting on the dependency's own published status keeps the coupling local and explicit,
and `set_init_status` is called on all five exit paths of `code_sandbox::init`
(`code_sandbox/mod.rs:157, 183, 195, 213, 318`) — including the `enabled: false` early
return — so the signal is sound for both enabled and disabled deployments. The wait is
bounded and logs on timeout rather than hanging boot.

### DEC-4: Test Connection is made HONEST about sandboxed servers, not made able to test them

**Resolution:** For a stored server whose row has `run_in_sandbox: true`, Test Connection
reports that it cannot validate a sandboxed server. It is not extended to actually probe
through the sandbox.

**Basis:** `TestMcpConnectionRequest` (`mcp/types.rs:148-174`) has no `run_in_sandbox`
field and `build_ephemeral_server` hardcodes it `false` (`test_connection.rs:176`), so the
route always probes on the host — verified live: Test Connection on `command: Rscript`
returns the identical misleading message the boot sweep produced. Making it genuinely
sandbox-capable means adding a public request field, regenerating OpenAPI + `types.ts` for
BOTH workspaces, and routing an ephemeral server through rootfs fetch/mount — a much larger
change with its own review. Recorded as a follow-up. Removing the false claim is the part
that matters now: after ITEM-1 the admin no longer *needs* Test Connection to keep a
sandboxed row enabled, because the sweep stops disabling it.

### DEC-5: `run_in_sandbox` rows are recorded as skipped, not left with a stale badge

**Resolution:** When the sweep skips a sandboxed row it records a health status saying so,
rather than leaving whatever the previous run wrote.

**Basis:** The owner's immediate complaint after re-enabling the row was that "its health
badge is stale, not retested". Silently skipping would preserve exactly that. Writing an
explicit skipped/untested status makes the UI state match reality — the server was not
probed, and cannot be from this path.

### DEC-6: "could not test" is recorded as `untested`, not `unhealthy`

**Resolution:** Both Test Connection routes map their outcome through
`health_record_for(&response, not_testable)`. A sandboxed row — which the route cannot
probe at all — records `untested` + the explanatory reason. `success` alone no longer
decides the persisted status.

**Basis:** Found in the DRIFT-1 pass, in DEC-4's own implementation. The helper answers
`success: false` because no handshake happened, and the record block keyed off exactly
that field, so the persisted verdict became `unhealthy` — a red badge carrying a message
whose own text reads "This is a limit of the test, NOT a problem with the server", and the
immediate re-creation of the red badge ITEM-1 exists to clear. Absence of evidence is not
evidence of failure. `untested` is the vocabulary the card already falls back to
(`McpServerCard.tsx:217`) and the one ITEM-1's skip writes, so both no-verdict paths now
agree. Proven RED before fixing.

### DEC-7: the frontend carries the skip reason; the generic advice stays as the fallback

**Resolution:** `McpServerCard`'s `untested` badge and `McpServerDrawer`'s health tooltip
prefer `last_health_check_reason` when present and fall back to the existing generic text
when absent. Two files in `src-app/ui/`, no type or API change.

**Basis:** Writing an explanation the UI throws away is not an explanation. Worse, the
hardcoded fallback tells the admin to "Click Test Connection or toggle Enabled to run a
probe" — and for a sandboxed row Test Connection cannot validate it (DEC-4) and toggling
Enabled hits `enforce_on_update`'s identical skip. Both remedies are no-ops, which is this
branch's own defect (an admin directed at a useless action) relocated into the frontend.
The alternative — leave the UI alone and treat it as a follow-up — ships a state whose
only visible artifact actively misdirects, so it was rejected. Scope is contained: the
`untested` branch is the single such render site in the tree (`McpServerCard.tsx` is not
mirrored in `desktop/ui`), and the change is additive with the prior text preserved.
