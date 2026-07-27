# BASE — conflict surface vs current base

Base branch: `origin/feat/agent-core` @ `11cda3d5d` (this feature branches off it,
not `main`, per the owner's instruction). All lifecycle gates run with
`--base origin/feat/agent-core`.

## Migrations

Highest existing migration on the base (module-local `migrations/` dirs, sorted):
`202607191300_agent_delegate_enabled.sql`.

**This feature adds NO migration** — no new table, no new permission grant. Zero
migration-number collision surface.

## Files this branch touches that the base is also moving

| file | base activity | collision risk |
|---|---|---|
| `src-app/server/src/modules/control_mcp/handlers.rs` | stable since the control_mcp/SDK split (chunk C1 moved catalog/policy/tools out to `sdk/crates/ziee-control-mcp`; `handlers.rs` stayed app-side) | low — the edit is confined to `list_capabilities`'s filter/sort |
| `src-app/server/src/modules/chat/extensions/title/title.rs` | actively evolved on `feat/agent-core` (the `after_llm_skipped` + `should_generate_title` rework) | medium — the edit is confined to the constants + `generate_title_with_ai`, not the gating logic that branch reworked |
| `src-app/server/tests/chat/helpers.rs` | shared real-LLM seam | low — additive function only, no existing helper changed |
| `src-app/ui/tests/e2e/control/**` | added with control_mcp; untouched since | low |

## SDK submodule

The catalog/policy/tools live in the `sdk/` submodule
(`sdk/crates/ziee-control-mcp`). **This feature deliberately does NOT touch the
submodule**: the search filter it fixes is app-side in
`control_mcp/handlers.rs`, so the branch stays a single-repo, fast-forward-able
diff with no submodule pointer bump.

## OpenAPI regen

**Not implied.** No handler signature, request/response type, permission, or
`SyncEntity` changes — `list_capabilities` is an MCP JSON-RPC tool, not a REST
route, and its response shape (`operations`/`returned`/`total`/`truncated`) is
unchanged. No `just openapi-regen`, no `api-client/types.ts` delta in either
workspace.
