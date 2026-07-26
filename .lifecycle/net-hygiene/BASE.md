# BASE — conflict-surface scoping for `feat/net-hygiene`

Branch base: `origin/feat/agent-core`. Cut at `60b0db310`; **merged onto the new
tip `a72553e6e` mid-lifecycle** (DRIFT-2.10) once the concurrent
`feat/live-ui-audit-fixes` landed there, so the before→after numbers are measured
against the CURRENT baseline and this branch is credited with none of that work.
The merge was clean — no conflict, and no `openapi.json` / `api-client` regen on
this side. Every gate's diff base is `a72553e6e`. Worktree
`/data/pbya/ziee/tmp/net-hygiene-wt`.

## Migrations

**None added.** This branch touches no backend code at all. Migrations on this
branch are per-module (`src-app/server/src/modules/*/migrations/`, date-prefixed
e.g. `202607146005_bio_mcp_grant_permissions.sql`) — no number is claimed, so no
collision is possible.

## OpenAPI regen

**Not implied.** No Rust handler, request/response type, permission, or
`SyncEntity` changes → `openapi.json` / `api-client/types.ts` are untouched in
BOTH `src-app/ui/` and `src-app/desktop/ui/`. (Had a batch endpoint been needed
this would have been a two-workspace `just openapi-regen`; the plan deliberately
solves everything client-side, so it is not.)

## Files this branch touches that concurrent work also touches

Three worktrees are live off the same `60b0db310` tip:

| Worktree / branch | Its surface | Overlap with this branch |
|---|---|---|
| `feat/live-ui-audit-fixes` — **LANDED** at `a72553e6e` | **Owned the two excluded fixes**: `POST /api/projects/by-conversations` (batch) + `src-app/ui/src/core/llmModelCatalog.ts` (a coalescing model catalog) + an OpenAPI regen for both workspaces | **None, and now verified by the merge itself.** This branch edits no `project/` code, no `llm-models` call site, and no generated api-client file; the merge onto their tip was conflict-free. Enforced mechanically by `TEST-9`. |
| `/data/pbya/ziee/tmp/sse-slot-leak-wt` (`feat/sse-slot-leak`) | The SERVER-side `/api/sync/subscribe` 429 (per-user connection-slot reclamation, `server/src/modules/sync/registry.rs`) | **Adjacent, not overlapping.** ITEM-9 changes only the CLIENT reconnect backoff (`sdk/packages/framework/src/sync/SyncClient.ts`). Different file, different tree, and correct regardless of whether the server leak is fixed. |
| `/data/pbya/ziee/tmp/chat-ui-robustness-wt`, `/data/pbya/ziee/tmp/streamdown-wt` | Chat render surfaces | None — no overlap with the transport/loader/sync files here. |

## Shared-infra files edited (elevated blast radius — flagged deliberately)

`sdk/packages/framework/src/{api-client/core.ts, store-kit.ts,
module-system/store.ts, sync/SyncClient.ts}` and
`sdk/packages/notification-ui/src/store/actions/load.ts` are in the **`sdk`
submodule**, shared by `src-app/ui`, `src-app/desktop/ui`, and the second app
(CytoAnalyst). Every change here is additive and opt-out-free-but-inert:

- the coalescer only ever *joins* an already-identical in-flight GET,
- the store-kit change only affects the chunk-load window,
- `registerModule` reuse only affects a store registered twice.

The submodule pointer bump is part of this branch's diff and must land with it.
