# BASE.md — conflict surface vs the branch base

Base: `origin/feat/agent-core` @ `60b0db310` (NOT `origin/main` — this fix is
scoped to the agent-core line and must fast-forward onto it).

## Migrations

No migration is added. Migration directories on this branch live under the SDK
crates + desktop (`sdk/crates/ziee-{auth,onboarding,seed,notification,file}/migrations`,
`src-app/desktop/tauri/migrations`); none is touched, so a migration-number
collision is structurally impossible for this branch.

## Files this branch touches that the base may also be changing

| file | risk |
|---|---|
| `sdk/crates/ziee-framework/src/sync/{routes,registry}.rs` | LOW — last touched by the `access-token revocation on logout` + `sdk-surfaces` chunks; no in-flight work observed on the sync registry |
| `src-app/server/src/modules/chat/stream/{handler,registry}.rs` | MEDIUM — the chat-stream module is actively evolving on `feat/agent-core` (split-panes raised the per-user cap to 24 in DEC-34). Edits here are additive (a new method + 3 lines in `register`) and do not move existing code |
| `src-app/server/tests/sync/subscribe_test.rs` | LOW — append-only (new `#[tokio::test]` fns) |
| `sdk` submodule pointer | **HIGH-visibility** — the outer-repo diff carries a submodule-pointer bump. The SDK commit must be pushed to `sdk/agent-core-and-perf` before the outer merge, or the pointer dangles |

## OpenAPI regen

**Not implied.** No handler signature, request/response type, permission, or
route changes. `openapi.json` / `api-client/types.ts` are untouched in BOTH
workspaces, so this is not a frontend-touching diff.

## Frontend

Deliberately untouched: `src-app/ui/**` and `src-app/desktop/ui/**` are owned by
other agents right now. Backend + SDK only.
