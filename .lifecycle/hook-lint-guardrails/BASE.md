# BASE — conflict surface vs current base

Branch: `feat/hook-lint-guardrails`, cut from `origin/feat/agent-core` @ `60b0db310`
(the integration branch this work merges back into — NOT `main`).

## Migrations

**None touched, no collision surface.** This branch adds no migration. On this
branch the app's migrations live in the SDK crates (`sdk/crates/ziee-*/migrations`)
plus `src-app/desktop/tauri/migrations`; `src-app/server/migrations` no longer
exists. Highest desktop migration on the base:

```
$ ls src-app/desktop/tauri/migrations | tail -1
```
(unchanged by this branch)

## OpenAPI regen

**Not implied.** No Rust handler/type changes; `openapi.json` and
`api-client/types.ts` are untouched in both workspaces.

## Files this branch touches that the base is also moving

| file | risk |
|---|---|
| `src-app/ui/package.json` / `src-app/desktop/ui/package.json` | LOW — one added `lint:hooks` script + one token appended to the `check` chain. Textual conflict only if another branch edits the same chain line; resolution is trivially additive. |
| `src-app/ui/scripts/detector-acceptance.mjs` | LOW — two rows appended to the `MISSES` table. |
| `src-app/ui/docs/DEFECT_TAXONOMY.md` | LOW — a new `## O.` section appended after `## N.`. |
| 5 component files (ProjectFilesManagePanel, OpenInNewWindowAction, McpServerDetailsDrawer, LlmModelsSection, desktop ConversationMountsControl) | LOW — each is a 2–6-line hoist local to one function; no signature/props/render-output change. `OpenInNewWindowAction.tsx` is the most actively-edited of the five (split-chat work). |
| `src-app/ui/scripts/lint-hooks.mjs`, `lint-hooks.test.mjs`, two `__detector_fixtures__` files | NONE — new files. |

## Submodules

`sdk` and `agent-kit` pointers are **not** moved by this branch (deliberate —
DEC-2 keeps the lint ziee-local precisely so no unpushed submodule commit is
required). `src-app/server/binaries/hub-seed/` was copied in locally for the
preflight gate and is gitignored — it is not part of the diff.
