# BASE — conflict surface vs current main

Base: `origin/main` = `256a23930` ("chore: strip lifecycle artifacts before merge").
Worktree: `/data/pbya/ziee/wt-token-fallback`, branch `fix/github-token-fallback`.

## Migrations

- Highest existing SERVER migration prefix: **`202607200600`**
  (`find src-app/server -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort -n | tail -1`).
- Highest desktop prefix: unchanged (`desktop/tauri/migrations/`, the deliberate 1e13 block).
- **This branch adds NO migration.** No collision surface.

## Files main may also be touching

- `src-app/server/src/modules/llm_local_runtime/**` — a sibling worktree
  (`/data/pbya/ziee/wt-engine-discovery`, branch `feat/engine-version-discovery`)
  is the branch that ORIGINATED this surface; its work is already merged into
  `256a23930` (the degradation vocabulary, the release cache and the e2e spec are
  all present at base). Re-check at merge time that no further discovery work has
  landed on the same three files.
- `src-app/ui/src/modules/llm-local-runtime/**` — same origin, same note.

## OpenAPI regen implied

**YES.** Two `JsonSchema` response types gain a field, so BOTH
`src-app/ui/{openapi/openapi.json,src/api-client/types.ts}` and the
`src-app/desktop/ui/` counterparts must be regenerated and committed
(`just openapi-regen`). The `openapi::emit_ts::tests::types_ts_parity` golden
test is the oracle. This is the most likely positional-diff conflict with main.

## No shared-infrastructure edits

The integration test drives the ALREADY-COMMITTED debug-only
`LLM_RUNTIME_API_MIRROR` seam; `tests/common/*`, `playwright.*.config` and the
gallery cassette are NOT touched (B3).
