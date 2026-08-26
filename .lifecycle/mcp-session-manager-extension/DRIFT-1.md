# DRIFT-1 — implement round 1

Plan vs. implementation, checked against the diff after the fix + tests landed.

- **DRIFT-1.1** — verdict: resolved — installer home
  PLAN "Files to touch" named `modules/mcp/client/manager.rs (or a small sibling
  module)`. Implemented in `manager.rs` itself: it already owns the `OnceLock`,
  `set_global`, `global` and `spawn_idle_reaper`, so `install` sits with everything it
  touches and needs no new module. No plan change required.

- **DRIFT-1.2** — verdict: impl-wins — the layer chain had to be split
  PLAN said `main.rs`'s duplicate would be deleted and the shared installer called "at
  the equivalent point". The implementation also had to **break the layer chain** there:
  `main.rs` previously built one long `let app = app.layer(...)…layer(cors);`
  expression, and `install` returns a tuple, so the chain is now
  `…layer(ZieeIdentityResolver)` → `install(...)` → `.layer(cors)`. Same final layer
  ORDER, so no behavioural change; the plan simply did not anticipate the expression
  split. Same split applied in `lib.rs::setup_server`.

- **DRIFT-1.3** — verdict: impl-wins — the planned TEST-3 unit test was dropped
  TESTS.md originally enumerated a unit test asserting `manager::global()` is `Some`
  after `install`, plus a separate TEST-4. The unit test was dropped: `Config` has no
  `Default`, and building a `ServerConfig` in-process to exercise three lines costs more
  than it proves. The `global()` half of INV-1 is instead pinned transitively —
  `install` performs `set_global` unconditionally on the line before the `Extension`
  layer that TEST-1 observes. Recorded as DEC-7; TESTS.md renumbered to TEST-1..3 and
  states the constraint this creates. **Corroborated at runtime**: the GREEN desktop run
  logs `mcp::session reaper: started (tick 60s, max_idle 1800s)`, emitted from
  `spawn_idle_reaper` — so `install` demonstrably executed past `set_global` on the
  desktop path, where that line never appeared before.

- **DRIFT-1.4** — verdict: resolved — a vacuous test was written and removed
  A third desktop test (built-in server probe via `probe_builtin_server`) was removed
  after the RED run reported `1 passed; 2 failed` where all three should have failed.
  Built-ins are excluded from `list_system_mcp_servers`, so its early-return branch
  fired unconditionally and it passed against the un-fixed binary. Removed, with the
  reason recorded in the test file and DEC-8 so it is not re-added. The plan did not
  enumerate it; no plan change needed.

- **DRIFT-1.5** — verdict: resolved — dead-code markers removed
  PLAN did not mention the `#[allow(dead_code)]` markers on `set_global`,
  `spawn_idle_reaper`, `REAPER_TICK` and `REAPER_MAX_IDLE_SECONDS`, each annotated
  *"wired in the bin (main.rs)"*. All are now genuinely reachable from library code, so
  the markers were removed per CODING_GUIDELINES §15. In-scope tidying of the exact
  lines the defect lived in — that annotation was the bug stated in one line — not
  scope creep.

**Unresolved drifts:** 0
