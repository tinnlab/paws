# BASE.md — conflict surface for paws-feature-surface

Base: `origin/main` @ `b6cebdb15` (re-fetched at worktree creation; the remote
tip was confirmed identical, so the branch is not cut from a stale base).

## Migration numbering

Two independent sequences — server (`2026…`) and desktop (a deliberate `1e13`
block). A new SERVER migration must exceed the SERVER max, not the global max.

| sequence | max | measured by |
|---|---|---|
| server, `origin/main` | `202607200600` | `git ls-tree -r --name-only origin/main \| grep server.*migrations` |
| server, incl. in-flight PR #10 | **`202607210100`** | `202607210100_llm_repository_default_model_seed.sql` on `origin/feat/default-model-onboarding` |
| desktop (`1e13` block) | `10000000000005` | must stay below |

**This branch's migration takes `202607210200`.**

`CLAUDE.md` documents the server max as `202607200200`. **That figure is stale**
— main is six migrations past it. It was the number my first plan draft carried,
and it would have collided. Measure, do not cite the doc.

No duplicate prefixes exist across either sequence today (`uniq -d` → empty).

## Concurrent branch: `feat/default-model-onboarding` (PR #10, open, not merged)

It is green and awaiting the human's merge, and it is invisible to any check that
only looks at `main`. Overlap with this branch:

- **Migration**: adds `202607210100` (accounted for above).
- **Files**: touches `onboarding` and both UI workspaces. This branch touches
  neither `onboarding` nor the llm-repository/model surfaces, so no file-level
  collision is expected — but both branches edit UI generated registries, so
  whichever merges second may need a regen.
- **Submodule**: it repins `sdk` from `chat` → `paws` in `.gitmodules`. Main is
  still on `chat`, and this worktree is therefore on `chat` @ `584756d3`. **This
  branch does not repin** — a second repin would conflict. See the testid-registry
  risk under ITEM-11 in PLAN.md for the one path that could force an sdk commit.

## OpenAPI regen

**Not implied.** This branch changes no request/response type, no handler
signature and no schema. The four config-default flips and the migration are
invisible to the spec. If a regen ever becomes necessary, `just` is NOT installed
on this box — the two literal commands are in `justfile:550-554`.

## Other shared surfaces this branch touches

- `src-app/ui/src/modules/loader.ts` / `loader.desktop.ts` — the module loader
  seam, shared by BOTH UI workspaces (desktop resolves `loader.desktop.ts` out of
  the web tree). A mistake here is a boot failure, not a feature bug.
- `src-app/ui/src/modules/chat/extensions/index.ts` and
  `projects/extensions/index.ts` — two auto-discovery globs consumed by every
  module that bridges into chat or projects.
- `src-app/server/src/core/config.rs` — the deploy config struct shared by the
  server and desktop binaries.
