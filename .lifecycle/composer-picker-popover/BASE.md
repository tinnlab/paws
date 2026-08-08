# BASE.md — conflict surface vs current main

Branch `feat/picker-popover-ux`, cut from `origin/main` @ `35d18519f`
("agent-kit: fix the same ledger race in merge-findings").

## Migrations

**None added.** This is a frontend-only change — no `src-app/server/**` or
`src-app/desktop/tauri/**` file is touched, so neither migration sequence is in play.

- Highest server migration prefix currently in use: `202607200200`
  (`find src-app/server -path '*/migrations/*.sql'` → max prefix).
- Highest desktop migration prefix: `10000000000005` (the deliberate `1e13` block).
- Note there is no `src-app/server/migrations/` directory — migrations are per-module
  under `modules/<module>/migrations/`.

Collision risk: **zero**.

## OpenAPI regen

**Not implied.** No Rust handler, request/response type or `JsonSchema` derive is
touched, so `openapi/openapi.json` and `src/api-client/types.ts` are byte-identical in
both `src-app/ui` and `src-app/desktop/ui`. `just openapi-regen` is not run.

## Files this branch edits that main may also be editing

| file | why it is a conflict surface |
|---|---|
| `src-app/ui/src/modules/assistant/chat-extension/components/AssistantMenuItem.tsx` | rewritten to use the new primitive; any concurrent change to assistant selection lands here |
| `src-app/ui/src/modules/knowledge-base/chat-extension/components/KbMenuItem.tsx` | same |
| `src-app/ui/src/dev/gallery/galleryCoverage.generated.ts` | **generated + shared**: every branch that adds/removes a surface regenerates it. Regenerate ON TOP of current main at merge, never take either side wholesale. |
| `src-app/ui/src/dev/gallery/stateMatrix.generated.ts` | same shared-generated hazard |
| `src-app/ui/src/dev/gallery/coverage.ts`, `stateCoverage.ts` | hand-written manifests; concurrent surface work appends here |

## Submodules

- `sdk` is pinned to branch `chat` @ `70576db7`. This branch **does not modify the sdk
  submodule** — deliberately: `gallery.config.json:testidOut` points the static testid
  registry at `sdk/packages/kit/src/testIds.generated.ts`, so introducing a new static
  `data-testid` literal anywhere in the app would force a cross-repo submodule commit.
  The plan therefore preserves the existing testid literals and selects new surfaces by
  role/label, leaving the submodule pointer untouched.
- `agent-kit` @ `4852e465` — untouched.

## Desktop mirroring

`src-app/desktop/ui/vite.config.ts:37` sets `fallbackSrc: ../../ui/src`, and
`find src-app/desktop/ui -name 'AssistantMenuItem.tsx' -o -name 'KbMenuItem.tsx' -o
-name 'PlusMenuItem.tsx'` returns nothing — the desktop workspace has **no override
copy** of these components and inherits the fix. No mirrored edit is required, and
`OVERRIDE_EXCEPTIONS.md` / `check:override-registry` are unaffected.
