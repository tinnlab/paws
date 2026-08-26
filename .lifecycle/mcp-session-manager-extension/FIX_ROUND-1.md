# FIX_ROUND-1

Round-1 blind audit ran two angles — `correctness` and `design-conformance` (the
required one) — each a fresh subagent given only `git diff origin/main...HEAD` and none
of the author's reasoning. 15 ledger rows: 13 real findings, 2 explicit no-defect
verdicts (layer ordering, borrow/scope).

Ten were promoted to WORK and fixed. Four were corroborated by BOTH angles; the rest
were single-angle but **oracle-confirmed** — each verified directly against the code or
against an actual test run before acting, not accepted on the auditor's say-so.

## Fixed

1. **Wrong layer (design, oracle-confirmed).** `install` took and returned an
   `axum::Router` from inside an MCP *client-transport* module — the only function under
   `src-app/server/src/modules/` doing so, verified by grep. Split into
   `manager::build_session_manager(config) -> Arc<..>` (no axum dependency) and
   `core::app_builder::install_mcp_session_manager(router, config)`, which now sits
   beside `apply_rate_limit_layer` and `create_cors_layer` — the repo's existing
   precedent for exactly this shape. Restores the sibling pattern used by
   `build_auth_context` / `build_file_context` / `ZieeIdentityResolver`: the module
   yields a value, the assembly layer does the layering.

2. **A new always-on timer on desktop, for zero behaviour (both angles).** Moving
   `spawn_idle_reaper` into the shared installer added a 60s-tick task to the Tauri
   process. Both auditors independently established the pool it scans can never be
   populated — `get_or_create`, its only inserter, has zero callers workspace-wide.
   Reaper start removed from the shared path and left in `main.rs` exactly as before, so
   the embedded path gains nothing. Its `#[allow(dead_code)]` markers restored (it is
   bin-only again) and a note added explaining why it is not wired on the embedded path.

3. **Silent non-idempotence (both angles).** A second `install` would have constructed a
   rival manager, had its `OnceLock::set` dropped, and layered the *new* one while
   `global()` returned the *first* — the exact divergence this change exists to prevent,
   with no diagnostic. `build_session_manager` now returns the already-installed manager
   on a second call, and returns `global()` rather than its local `Arc`, so the Extension
   and `global()` are the same instance **by construction**, even under a race.

4. **Test vacuity — the highest-value finding (correctness, oracle-confirmed).** axum runs
   extractors left-to-right and every handler declares `auth: RequirePermissions<..>`
   before `Extension(session_manager)`, so a 401/403 short-circuits *before* the
   extension lookup and satisfied the old "not 500" assertion. Any permission rename or
   harness change would have turned all four tests permanently green with the
   ship-blocker restored. Guard added — matched on the extractor's error **codes**
   (`MISSING_TOKEN` / `INVALID_TOKEN` / `INSUFFICIENT_PERMISSIONS`) rather than on status,
   because the handlers themselves return 403 `USER_NO_ACCESS` from their own body, which
   IS a valid proof and must not be rejected.

5. **Loose status assertions.** "Not 500" is satisfied by a 404/405 from a router that no
   longer mounts the route. Exact statuses now asserted — 200 for test-connection, 404
   for the unknown-id tools call — both **confirmed by an actual run**, not assumed.

6. **Phantom payload fields.** Tests sent `name`/`display_name`, which
   `TestMcpConnectionRequest` does not declare and serde silently drops. Reduced to the
   declared fields.

7-10. **Doc-truth fixes.** The "ONE installation site" claim now names the chat-extension's
   second construction and the condition under which it becomes harmful; the false
   "boot keeps it for `close_all()`" claim is gone and the `lib.rs` call site explains why
   the handle is dropped there; `spawn_idle_reaper`'s "called once from `main.rs`" is true
   again; `client/mod.rs`'s re-export comment names the new consumer.

## Not actioned, and why

- **No `mcp` deploy kill-switch** (§16). Pre-existing for the `main.rs` path, and moot
  after fix 2: `install_mcp_session_manager` now has no background side effect at all.
- **No executable test for the `global()` half.** Fix 3 upgraded the argument from
  line-ordering to a by-construction identity, but it is still structural, not executable.
  A workflow `kind: tool` step test on `start_desktop()` would close it; judged
  disproportionate for this fix and recorded as a follow-up in TESTS.md rather than
  silently dropped.
- **`set_global` now runs ~120 lines later in `main.rs`.** Traced: every `global()` reader
  is request- or dispatch-driven, and the only boot-spawned task in the widened window
  (`workflow::startup_sweep::sweep_at_boot`) fails stale runs without dispatching. Module
  init already ran before both the old and new positions.

## Termination

Tier reported **HEAVY** (the new `mcp_routes` test directory counts as a new module), so
the LIGHT one-round exit does not apply. Terminating on the **Converged** exit:

- Round 1 produced 13 findings across two angles; all 10 promoted ones are fixed and the
  3 deferred ones are recorded with reasons.
- Both angles returned an explicit *no defect* on the two highest-risk correctness
  categories (layer ordering, borrow/move), i.e. the round included real negative
  results rather than only hits.
- The two angles overlapped on 4 findings — a corroboration rate that indicates the
  surface is small and was covered twice, not that it is deep.
- The diff is ~120 lines of non-test code across four files with no new
  permission, migration, schema or public API. The profile decayed: nothing found in
  round 1 pointed at an unexplored region.

**Superseded — a round 2 WAS run.** The above argued for terminating here. The gate's own
T1 estimate disagreed: `n1=9 n2=10 overlap=4 → Chapman N̂=21.0 vs 15 observed ⇒ ~6.0
defect(s) unfound, ~1.60 promotable — not satisfied (>= 1)`, and it flags itself as biased
LOW because two prompts to one model are not independent samples. Asserting convergence
over the tool's own estimate would have been exactly the "make the evidence fit" move this
process exists to prevent. Round 2 sampled two DIFFERENT core-roster angles (`security`,
`tests-quality`) rather than re-running the same two. See FIX_ROUND-2.md.

**New confirmed findings:** 0
