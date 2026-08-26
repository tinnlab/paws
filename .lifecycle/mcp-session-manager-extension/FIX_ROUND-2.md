# FIX_ROUND-2

Round 2 was run because the phase-7 gate's own T1 estimate refused to call round 1
converged: `n1=9 n2=10 overlap=4 → Chapman N̂=21.0 vs 15 observed ⇒ ~6.0 defect(s)
unfound, ~1.60 promotable — not satisfied (>= 1)`, self-flagged as biased LOW.

Two **different** core-roster angles were sampled — `security` and `tests-quality` —
rather than re-running `correctness` + `design-conformance`. That was the right call:
round 2 found a HIGH the first round missed, and two comments **I had written** that
asserted coverage the code did not provide.

## Fixed

1. **The `set_global` half was pinned by an argument that guards the wrong mutation
   (HIGH).** Round 1 accepted "both happen in one function, so observing the Extension
   implies the global". The dangerous edit is not to that function — it is a future
   `lib.rs` layering `Arc::new(McpSessionManager::new(cfg))` **directly**, bypassing it:
   green route tests, `global()` unset, original defect restored for every workflow /
   agent-host consumer. **TEST-4** now pins it executably via `Arc::ptr_eq` against
   `global()` plus idempotency. My earlier reason for skipping it ("`Config` has no
   `Default`") was simply wrong — `Config` derives `Deserialize` and every non-flattened
   field is `#[serde(default)]`, so a minimal `serde_json` fixture builds one.

2. **My 404 comment claimed the opposite of what the code did (MEDIUM).** I wrote that
   asserting 404 stops a removed route passing. An unmounted route *also* answers 404,
   with an empty body that satisfied every `!body.contains(..)` check too. TESTS.md
   repeated the claim. TEST-2 now runs as a **non-admin** and asserts 403 +
   `USER_NO_ACCESS` — a code only the handler body emits — so a route-miss fails both
   assertions.

3. **The standalone test did not mirror the desktop one, despite its header saying so
   (MEDIUM).** Its status pins were missing, so unmounting a route or stubbing a handler
   left it green. Both assertions copied across; the header is now true.

4. **My tests were over-privileged and tested the bypass (MEDIUM, both angles).** Both
   users held `mcp_servers_admin::create`, and `has_admin_access` treats any
   `mcp_servers_admin::*` as admin — so TEST-2's "user" skipped `can_user_access_server`
   entirely. The ownership branch was untested *by construction*, and the expected status
   was silently coupled to the contents of `MCP_ADMIN_PERMISSIONS`. Split into
   `ADMIN_PERMS` / `READ_PERMS`; TEST-2 is now a genuine non-admin exercising the
   ownership refusal.

5. **`PRE_HANDLER_REJECTIONS` was sold as exhaustive and was not.** Added `USER_NOT_FOUND`
   and `USER_INACTIVE`, which also short-circuit before the Extension extractor.

6. **Silent idempotency.** `tracing::warn!` on the already-installed branch, stating that
   the passed config is ignored — a second boot after a `jwt.secret` rotation would
   otherwise keep minting under the stale secret invisibly (fails closed, but unobservable).

7. **The desktop merge seam is now documented.** `server_boot.rs` re-applies exactly
   `Extension(jwt)` + CORS onto merged desktop routes and drops everything else. A
   desktop route declaring `Extension<Arc<McpSessionManager>>` would 500 with the
   identical rejection. Latent (no desktop route uses it), so documented at the seam
   rather than pre-emptively wired — dead wiring would be its own defect.

## ESCALATED — not fixed here, and deliberately not shipped silently

The `security` angle's structural point is the important output of this round, and it is
not something the fix should quietly carry:

> That 500 was, on desktop, the only thing keeping ~11 handlers and ~6 `global()` paths
> from executing. Turning them on is correct — but it un-gates a surface that was never
> authz-reviewed against the desktop threat model.

I verified the sharpest claim myself rather than repeating it. All three legs hold:

- `build_ephemeral_server` hardcodes `run_in_sandbox: false` (`test_connection.rs:176`).
- `HOST_ALLOWED_COMMANDS` gates the **command** only; `args` are copied verbatim
  (`stdio.rs:27`, `:365-371`).
- `mcp_servers::create` is granted to the **default `Users` system group**
  (`202607146065_mcp_grant_permissions.sql:6-8`).

⇒ `POST /mcp/servers/test-connection` with `{"transport_type":"stdio","command":"python3",
"args":["-c","…"]}` runs an unsandboxed host process, available to any registered account.
This is **pre-existing and already live on the standalone `ziee` binary**; this change
makes it reachable in the **desktop** process, which `remote_access`/ngrok can publish to
the internet.

Companion findings, same character (pre-existing, newly reachable on desktop): the
http-transport reachability oracle for loopback/RFC1918; stored decrypted header/env
secret exfiltration via `{is_secret:true, value:null}` plus an attacker-controlled `url`
(no url-match guard, unlike `resolve_oauth`); `get_or_create_with_context` calling
`get_any_server` without ownership scoping; and no `env_clear()` / `PR_SET_PDEATHSIG` on
spawned stdio children.

None are introduced by this change and none are mine to decide. They are recorded as
`open` in the ledger, called out in the PR body, and marked `ESCALATED` in the status file
so the owner chooses between shipping the un-gating as-is, gating it, or hardening first.

## Termination

Terminating on the **Converged** exit, this time with the profile actually decaying:

- Round 2 sampled two angles disjoint from round 1 and returned 9 findings, of which 7
  were promoted and fixed and 2 escalated. All 7 fixes are in code, not prose.
- The two escalations are **pre-existing defects outside this diff**, not unfound defects
  in it — they do not indicate further unexplored surface in the change itself.
- Both round-2 angles independently reported the diff's own mechanics clean: `set_global`
  has a single caller with correct race handling, no cross-user token minting exists, no
  new secret reach via the Extension, no resource-lifecycle regression from the diff, and
  layer ordering/CORS unchanged.
- Rounds 1 and 2 between them covered all four core-roster angles. A third round would
  have to re-run an angle already spent on a ~130-line diff.

**New confirmed findings:** 0
