# BASE.md — conflict-surface scoping (P3)

**Branch base:** `origin/main` @ `25fbcdaa7` ("Merge pull request #8 from tinnlab/design/default-model-onboarding"), fetched 2026-08-23.

## Migration numbers

Migrations are PER-MODULE (`src-app/server/src/modules/<m>/migrations/`), with TWO
independent sequences. Measured on this base:

| sequence | max in use |
|---|---|
| server (`modules/*/migrations/`, `2026…`) | `202607200600` (`llm_repository/…_llm_repository_unverified_status.sql`) |
| desktop (`desktop/tauri/migrations/`, `1e13` block) | `10000000000005` |

Duplicate-prefix check across `src-app` printed **nothing** (no collisions today).

**This branch adds exactly one server migration: `202607210100_llm_repository_default_model_seed.sql`.**
It sorts above the server max and is unrelated to the desktop block. The `…0100` step
leaves room below `202607210200` for a concurrent branch. The merge-gate's C2 re-checks
this against real `main` at merge time.

## Files this branch touches that main may also be changing

| file | risk |
|---|---|
| `src-app/server/src/modules/llm_repository/migrations/` (new file only) | low — additive; the only collision mode is another branch claiming `202607210100`. |
| `src-app/ui/src/modules/onboarding/guides/getting-started/module.tsx` | **medium** — a one-line insert into the `steps` array. Any other branch adding an Onboarding step edits the same array and the same lines. This is the most likely textual conflict on the branch. |
| `src-app/ui/src/modules/onboarding/gallery.tsx` / gallery state-matrix inputs | low-medium — generated/registry surfaces are touched by many branches. |
| `src-app/server/tests/{llm_model,llm_repository}/mod.rs` | low — one `mod` line each. |
| `docs/design/default-model-onboarding.md` | low — this branch is the only consumer of that design today. |

New files (the step component, its store, the descriptor, the two e2e specs, the two
integration test files) cannot conflict.

## Shared surfaces deliberately NOT touched (rule B3)

`src-app/server/tests/common/*`, the gallery cassette, `playwright.*.config`, and the
build-DB helper are shared infrastructure and are **not** edited by this branch. The
anonymous-clone HTTP fixture for the INV-1 test lives inside this feature's own test
module, not in `tests/common/`.

## OpenAPI regen

**Not implied.** The feature drives existing endpoints only — no new route, no changed
request/response type, no new permission, no new `SyncEntity`. `openapi.json` and
`api-client/types.ts` are generated (golden parity test) and are not hand-edited. If
implementation proves a backend type changed, `just openapi-regen` runs and regenerates
BOTH `src-app/ui/` and `src-app/desktop/ui/`, and this section is amended.

## Environment

`preflight.sh` → OK in this worktree (hub-seed staged, pgvector submodule initialized,
root `npm install` hoisted, per-worktree build-DB isolation active, build-DB cluster
reachable on `127.0.0.1:54321`, `config/dev.yaml` auto-seeded with a fresh `jwt.secret`).
