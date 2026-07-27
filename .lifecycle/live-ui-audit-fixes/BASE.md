# BASE — conflict surface

Branch: `feat/live-ui-audit-fixes`, cut from `origin/feat/agent-core` @ `60b0db310`
(NOT `origin/main` — the audit target and the requested integration target are
`feat/agent-core`). Merge target for FF: `feat/agent-core`.

## Migrations

- Migrations are now **per-module** (`src-app/server/src/modules/*/migrations/`)
  with timestamp-prefixed names (`202607190900_scheduler_goal_seeking.sql` is the
  latest in `migrations-merged/`).
- **This feature adds NO migration.** The new endpoint is a pure read over the
  existing `project_conversations` join table; no schema, no permission grant
  (it reuses `projects::read`, already granted by the projects migration).
  → zero migration-number collision surface.

## OpenAPI regen implied

**YES** — ITEM-1 adds a route + two new schemas
(`ProjectsByConversationsRequest`, `ProjectsByConversationsResponse`,
`ConversationProjectLink`). `just openapi-regen` must run for BOTH
`src-app/ui/` and `src-app/desktop/ui/` (ITEM-2). The generated
`openapi.json` + `api-client/types.ts` in both workspaces are therefore expected
diff surface; they are mechanically generated and excluded from the audit
coverage law.

## Files main/feat-agent-core is also touching

- `src-app/ui/src/modules/projects/chat-extension/extension.tsx` — actively
  evolving (split-view/pane work landed here recently). Our change is confined to
  the private `loadProjectForConversation` helper + its two module-local maps; no
  exported surface changes, so a textual conflict is likely trivial.
- `src-app/ui/src/modules/settings-general/components/ThemeSettings.tsx` — quiet.
- The migrated store-action files (`*/actions/*.ts`) are products of the
  store-kit sweep; each edit is a few lines inside one action.
- `src-app/server/src/modules/project/**` — quiet on the base branch.

## Ports / environment used for verification (not committed config)

- Verification server: this worktree's own `ziee` on `127.0.0.1:29285`, embedded
  PG on `54398` (`config/dev.yaml` is gitignored per-machine).
- Static UI served by `/data/pbya/ziee/tmp/luif/serve.mjs`.
