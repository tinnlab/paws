# BASE — conflict-surface scoping (e2e-speedup)

Branch base: `origin/feat/agent-core` (tip `ec00a14de`). Diff base for the gate is
`origin/feat/agent-core` (passed via `--base`), NOT `origin/main` — this feature
targets the agent-core line per the brief.

## Migrations
- Highest existing migration prefix on base: `202607191300` (module-owned dirs
  under `src-app/server/src/modules/*/migrations/` + `sdk/crates/*/migrations/`).
- **This feature adds ZERO migrations.** No collision possible.

## Files this branch touches vs. main activity
- `sdk/crates/ziee-build-support/src/migrations.rs` — build helper in the `sdk`
  submodule. Superproject only records a submodule-pointer bump. Low collision
  risk (isolated build helper); if `sdk` moves under us, re-pin at merge time.
- `src-app/ui/tests/fixtures/test-context.ts`, `src-app/ui/tests/global-setup.ts`
  — e2e harness only. These are actively-maintained shared test infra; the changes
  are additive/behavior-preserving for isolation (per-test unique DB + port
  release retained), so a textual merge conflict is the only risk, not a semantic
  one.

## OpenAPI regen
- NOT implied. No handler/type/schema change. `openapi.json` / `api-client/types.ts`
  are untouched.

## Submodule workflow
- ITEM-1 is committed INSIDE the `sdk` submodule first, then the superproject
  commit records the new submodule SHA. The `sdk` submodule on this base is pinned
  to `8f376ce7` (branch `agent-core-and-perf` per the base commit message).
