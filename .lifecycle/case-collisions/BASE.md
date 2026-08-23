# BASE.md — case-collisions

Conflict-surface scoping against **current** `origin/main` at branch time.

- **Base commit:** `f07753d27` ("Merge pull request #3 from tinnlab/fix/tauri-beforebuild-cwd") — fetched immediately before `git worktree add -b fix/ui-store-case-collisions … origin/main`.
- **Highest existing SERVER migration prefix:** `202607200600`
  (`find src-app/server -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort -n | tail -1`).
  Desktop sequence max remains in the `1e13` block.
  **This branch adds NO migration**, so there is no migration-number collision surface.
- **OpenAPI regen implied?** **No.** The diff touches no Rust type, no handler, and no
  `*/openapi/openapi.json` or `api-client/types.ts`. `just openapi-regen` is not run
  (and `just` is not installed on this box — recorded in STATUS).
- **Files this branch will touch that main is also changing:** none known. The three
  merged PRs on main (#1 docs/desktop-readme, #2 ci/desktop-devbuild, #3
  fix/tauri-beforebuild-cwd) touch `src-app/desktop/README.md`,
  `.github/workflows/desktop-release.yml` and `src-app/desktop/tauri/tauri.conf.json`.
  This branch touches none of those. Overlap: **zero**.
- **Blast surface of this branch:** `src-app/ui/src/**` (24 store directories moved +
  their import sites), `src-app/ui/scripts/**` (one new guard + its tests),
  `src-app/ui/package.json` + `src-app/desktop/ui/package.json` (guard registration).
  No backend, no desktop `src/`, no generated file.

## Known environment gap (recorded, not worked around)

`.claude/lifecycle/preflight.sh` reports **1 blocking problem** on this box:

```
FAIL build seed missing at src-app/server/binaries/hub-seed/index.json — the build PANICS without it
```

The hub seed is a **Rust build** prerequisite (`build_helper/hub_seed.rs`, fetched from
the `ziee-ai/hub` GitHub release at `cargo build` time). It is absent from the parent
clone too, so it cannot be copied locally. **This branch is frontend-only** — it compiles
nothing Rust and runs no cargo test — so the gap does not block any gate this branch
must pass. It DOES mean the backend-backed Playwright suite
(`playwright.config.ts`, which boots a real server) cannot run here; the e2e proof for
this branch therefore runs against the **backend-free gallery**
(`playwright.visual.config.ts`), which is the correct vehicle for a
module-resolution refactor anyway. Every other preflight check is green
(pgvector submodule, root `node_modules`, per-worktree build-DB isolation, build-DB
cluster reachable, no stale Vite, seeded `config/dev.yaml`).
