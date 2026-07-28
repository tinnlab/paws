# BASE — conflict surface vs the integration line

Base for this branch is **`origin/feat/agent-core`** (tip `9363976a2`), NOT
`origin/main` — this is a campaign branch on the agent-core integration line and
it never merges to main. Every gate is run with
`--base origin/feat/agent-core`.

## Migrations

- The workflow module's migrations live at
  `src-app/server/src/modules/workflow/migrations/`; the highest is
  `202607191200_background_run_notes.sql`.
- **This branch adds NO migration.** The fix is pure logic (a shared
  prompt-source rule) plus a kit CSS-class change plus tests. No collision
  surface.

## OpenAPI

- No handler signature, request/response type, permission or `SyncEntity` is
  added or changed, so **no `openapi.json` / `api-client/types.ts` regen is
  implied** in either workspace.

## Files this branch touches that the integration line is also moving

- `src-app/server/src/modules/workflow/{validate,dispatch}.rs` — the
  `workflow-builder-ux` work that produced these residuals is already MERGED into
  `feat/agent-core` (`9363976a2` contains it), so there is no concurrent editor
  of the prompt XOR logic on this line.
- `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts` — same: authored on
  the already-merged `workflow-builder-ux` branch. Only its
  `MAX_TOLERATED_OVERFLOW_PX` constant and the comment above it change.
- `sdk/packages/kit/src/shadcn/input-group.tsx` — **submodule** `sdk`, branch
  `sdk/agent-core-and-perf` (tip `c6f5d8c`). Other campaign branches also carry
  sdk commits; this change is 2 lines inside one `cva` variant block, so a
  textual conflict is unlikely, and the parent's gitlink is published by the
  ORCHESTRATOR (this branch does not push either repo).
- `src-app/ui/tests/e2e/visual/` — a NEW spec file, so no conflict.

## Generated registries

`tests/e2e/visual/*.spec.ts` files are not scraped into the shared testId
registry (only `data-testid` string literals in `src/**` are), and this branch
adds no `data-testid`. `check:testid-registry` / `check:gallery-coverage` /
`check:state-matrix` therefore have no new input — verified at phase 8 by
`npm run check`.
