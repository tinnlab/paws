# BASE — conflict-surface scoping

- **Base branch:** `origin/feat/agent-core` @ `ec00a14de` (worktree
  `/data/pbya/ziee/tmp/bg-push-resume-wt`, branch `feat/bg-push-resume`).
  This base HAS the `background_mcp` module + agent-core, per the brief.
- **Highest existing migration:** `202607191300_agent_delegate_enabled.sql`
  (migrations are per-module, date-prefixed, under `src/modules/*/migrations/`).
  **This feature adds NO migration** (the only tunable is a fixed const — DEC-5),
  so there is no migration-number collision surface.
- **Files this branch will edit that current base is also touching:** none
  expected. The edits are localized to `modules/background_mcp/` (tools.rs, mod.rs,
  a new resume.rs) plus the module's own `tests/background_mcp/`. `agent-core` is
  the base itself, so the agent-core files (`chat/core/services/streaming.rs`,
  `chat/stream/registry.rs`, `scheduler/*`) are READ-ONLY references here — not
  edited.
- **OpenAPI regen implied?** NO. No handler signature or `#[derive(JsonSchema)]`
  type changes; no new REST route. `tool_list()` is a runtime JSON value (MCP
  tool descriptors), not an OpenAPI schema — editing descriptions does not change
  `openapi.json`. So neither `ui/` nor `desktop/ui/` regen is needed, and the
  diff is not UI work.
- **Merge-gate note:** because no migration and no regen, the merge-gate's C2
  (migration collision) and C3 (regen parity) surfaces are empty; C1 (clean
  build) + P2 (completeness) are the load-bearing checks.
