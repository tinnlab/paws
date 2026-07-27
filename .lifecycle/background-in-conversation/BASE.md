# BASE — conflict surface vs. current base

Branch `feat/background-in-conversation` is cut from `origin/feat/agent-core`
@ `f78a23a22` (fetched 2026-07-26). The eventual merge target is
`origin/feat/agent-core`, not `main`; all lifecycle gates are therefore run with
`--base origin/feat/agent-core`.

## Migrations

This feature adds **no migration**. Migrations on this base are per-module,
timestamp-named (`src-app/server/src/modules/*/migrations/*.sql` +
`sdk/crates/*/migrations/*.sql`), merged into `migrations-merged` at build time —
there is no single numbered `server/migrations/` directory any more. Highest
existing timestamp: `202607191300_agent_delegate_enabled.sql`. The permission this
feature relies on (`background::use`) already exists and is already granted to the
Users group by `202607191000_background_grant_permissions.sql`. **No collision
surface.**

## Files this branch touches that the base is actively changing

| File | Base activity | Risk |
|---|---|---|
| `src-app/server/src/modules/workflow/repository.rs` | active (background-run backbone) | LOW — the edit is one function's signature + two WHERE clauses; the only caller is `background_mcp/runs.rs` |
| `src-app/server/src/modules/background_mcp/runs.rs` | active | LOW — additive query field |
| `src-app/ui/src/modules/chat/gallery.tsx` | active (chat-ui-robustness work is on this base) | MEDIUM — appending two `deepStates` entries; append at the end of the array to minimise hunk overlap |
| `src-app/ui/src/modules/notification/module.tsx` | quiet | LOW |
| `src-app/ui/src/modules/background/**` | quiet since the agent-orchestration merge | LOW |
| `sdk/packages/kit/src/testIds.generated.ts` | **submodule**, actively regenerated on `sdk/agent-core-and-perf` | MEDIUM — a regen commit + pointer bump; the two most recent sdk commits are exactly this kind, so rebase conflicts are resolved by re-running `npm run gen:testid-registry` |

## OpenAPI regen implied

**Yes.** `ListBackgroundRunsQuery` gains `conversation_id`, so both
`src-app/ui/openapi/openapi.json` + `src-app/ui/src/api-client/types.ts` and
`src-app/desktop/ui/openapi/openapi.json` + `src-app/desktop/ui/src/api-client/types.ts`
must be regenerated (`just openapi-regen` runs both binaries). The
`openapi::emit_ts::tests::types_ts_parity` golden test enforces that the committed
`types.ts` matches the committed `openapi.json`.

## Submodule surface

`sdk` is a git submodule pinned to branch `sdk/agent-core-and-perf`. ITEM-14
produces a commit inside it plus a pointer bump in the superproject. Nothing is
pushed by this lifecycle; the sdk commit is left local for the owner to land
alongside the superproject branch.
