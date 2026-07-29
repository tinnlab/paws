# BASE — conflict surface vs `origin/feat/agent-core`

Branch: `fix/scheduler-settings-layout`, cut from `origin/feat/agent-core` @ `d53db2d11`.

## Migrations

**None.** This branch adds no migration. Server migrations no longer live under
`src-app/server/migrations` on this base — they are per-SDK-crate
(`sdk/crates/ziee-{auth,file,notification,onboarding,seed}/migrations`) plus
`src-app/desktop/tauri/migrations`. Nothing here touches any of them, so a
migration-number collision is impossible.

## OpenAPI regen

**Not implied.** No Rust handler, request/response type, permission, or sync
entity changes. `openapi.json` and `api-client/types.ts` are untouched in both
workspaces, so no `just openapi-regen`.

## Files this branch touches vs what main is moving

| file | risk |
|---|---|
| `src-app/ui/src/modules/scheduler/pages/SchedulerAdminPage.tsx` | LOW — the scheduler module landed with the scheduled-tasks lifecycle and is not under active edit on the base; this file is rewritten wholesale. |
| `src-app/ui/tests/e2e/helpers/layout.ts` | LOW — additive export only (`collectStarvedLabels`); no existing check is modified, so a concurrent new check merges cleanly. |
| `src-app/ui/gallery.config.json` | LOW — one array element appended to `visualSpecs`. |
| `src-app/ui/tests/e2e/visual/form-label-starvation.spec.ts` | NONE — new file. |
| `src-app/ui/tests/e2e/14-scheduler/admin-settings-layout.spec.ts` | NONE — new file. |
| `sdk/packages/config/src/lint/settings-field.mjs` | **SUBMODULE** (`ziee-ai/sdk`) — lands on its own remote before the superproject pointer moves. Additive second rule in an existing file. |
| `agent-kit/skills/live-ui-audit/live-ui-audit.mjs` | **SUBMODULE** (`ziee-ai/agent-kit`) — AND the file is currently DIRTY/uncommitted in the orchestrator's own checkout (2392 lines there vs 1473 on `agent-kit/origin/main`). Real collision risk; see DEC-7. |

## Inherited `.lifecycle` dirs

The base carries 17 sibling `.lifecycle/<feature>/` dirs. They are INHERITED and
must never be deleted:

```
git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle   # must be empty
```
