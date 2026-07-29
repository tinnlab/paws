# mobile-approval-clipped — BASE (conflict surface)

Branch base: `origin/feat/agent-core` @ `9363976a2`. **This branch never merges to
`main`** — `feat/agent-core` is the integration line; `main` is only pulled in.
Every lifecycle gate on this branch is run with `--base origin/feat/agent-core`.

## Migrations

On this integration line the migrations have moved out of `src-app/server/` into
the per-crate SDK directories. Highest existing migration in each, on the base:

```
$ for d in $(find . -maxdepth 5 -type d -name migrations -not -path '*/node_modules/*'); do echo "$d -> $(ls $d | tail -1)"; done
./sdk/crates/ziee-notification/migrations -> 202607140190_notification_schema.sql
./sdk/crates/ziee-seed/migrations         -> 202607150000_seed_ledger.sql
./sdk/crates/ziee-onboarding/migrations   -> 202607140195_onboarding_schema.sql
./sdk/crates/ziee-auth/migrations         -> 202607144600_auth_add_users_token_version.sql
./sdk/crates/ziee-file/migrations         -> 202607140125_file_schema.sql
./src-app/desktop/tauri/migrations        -> 10000000000005_create_host_mounts.sql
```

This branch adds **no migration** — it is frontend-only. No collision surface.

## OpenAPI regen

Not implied. The diff touches no Rust type, handler, or route, so neither
`src-app/ui/src/api-client/types.ts` nor `openapi.json` changes in either
workspace.

## Files this branch touches that the integration line is also moving

- `sdk/packages/kit/src/kit/card.tsx` + `sdk/packages/kit/src/index.ts` — shared
  SDK. The change is **purely additive** (a new export; no existing export's
  behavior or classes change), so a concurrent branch editing `Card` conflicts
  textually at worst, never semantically.
- `sdk/packages/kit/src/KIT_MANIFEST.md` — GENERATED (`npm run gen:kit-manifest`).
  Regenerate on top of whatever lands rather than merging it by hand.
- `src-app/ui/src/modules/mcp/chat-extension/components/{ToolCallPendingApprovalContent,ElicitationFormContent,AskUserWizardContent}.tsx`
  — the approval family; small, localized footer edits.
- `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — appended to,
  not rewritten.

`sdk/packages/kit/src/testIds.generated.ts` is deliberately NOT touched: the new
primitive adds no `data-testid`, so no regen and none of the known cross-branch
collisions on that file.

## Pre-existing worktree noise

`src-app/server/vendor/pgvector` reports modified in every worktree — pre-existing,
left alone.
