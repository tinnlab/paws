# BASE — conflict surface vs current main

Base: `origin/main` @ `705e5015f` (verified with `git rev-parse origin/main` at
worktree creation). Submodules at creation: `sdk` @ `c3ad1bf51`, `agent-kit` @
`4852e465c`, `pgvector` @ `cab9da72c`.

## Migrations

- Highest existing SERVER migration prefix: `202607200400`.
- **This branch adds NO migration.** No collision surface.

## OpenAPI regen

- **Not implied.** The diff touches no Rust handler, no `JsonSchema` type, no
  route. `openapi.json` / `api-client/types.ts` are untouched in both workspaces.

## Files main is actively changing that this branch also touches

The branch's product-tree footprint is deliberately narrow — build/test tooling
only:

| file | collision risk |
|---|---|
| `sdk/packages/gallery/scripts/{runtime-health,gate-ui,gen-testid-registry}.mjs` | **HIGH-attention** — shared SDK tooling every UI branch runs. Landing order matters: sdk commit first, then the ziee pointer bump (the owner sequences this). |
| `sdk/packages/kit/src/testIds.generated.ts` | **KNOWN COLLISION CLASS** — every concurrent branch regenerates this file (memory: `reference_testids_generated_collision`). Resolution rule: on conflict, take main's version and re-run `npm run gen:testid-registry` on top; never hand-merge. |
| `src-app/desktop/ui/scripts/{runtime-health,gate-ui}.mjs` | low — desktop harness copies are rarely edited. |
| `src-app/{ui,desktop/ui}/package.json` | low — additive script entries only. |
| `CLAUDE.md` | low — one section edited (UI Build Gate). |
| `src-app/ui/scripts/runtime-health.mjs` | DELETED — zero invokers; a concurrent edit to it would be edit-vs-delete, resolvable as delete. |

## Non-git prerequisites recreated in this worktree

- `src-app/server/binaries/hub-seed/` copied from the main clone (build panics
  without it; not tracked).
- `node_modules` created as a **hardlink copy** (`cp -al`), NOT a symlink, with
  `node_modules/.vite` removed — a symlinked `node_modules` shares one Vite dep
  cache and one `@ziee/kit` workspace link across worktrees and has produced false
  results (a component test failing 6-of-7 purely from cross-worktree resolution).
  Verified: `readlink -f node_modules/@ziee/kit` →
  `/data/pbya/ziee/wt-harness-fix/sdk/packages/kit`.
- `src-app/server/config/dev.yaml` auto-seeded by `preflight.sh`.

`bash .claude/lifecycle/preflight.sh` → exit 0 ("environment ready").
