# BASE — conflict surface vs the integration line

**Base ref:** `origin/feat/agent-core` @ `9363976a2` (NOT `main` — this branch
never merges to main; main is only pulled into the integration line). Every gate
invocation passes `--base origin/feat/agent-core`.

## Migrations

This branch adds **no migration**. Recorded for completeness: the only migrations
directory in the tree at this base is `src-app/desktop/tauri/migrations`, whose
highest number is `10000000000005_create_host_mounts.sql`
(`ls src-app/desktop/tauri/migrations | tail -1`). The server crate carries no
`migrations/` directory at this base. Migration-number collision risk: **none**.

## OpenAPI / generated files

No Rust handler, request/response type, permission, or `SyncEntity` changes ⇒
**no `just openapi-regen` implied**, and neither `openapi.json` nor
`api-client/types.ts` is touched in either workspace. The backend is not
modified at all; `SendMessageRequest` (`src-app/server/src/modules/chat/core/
extension/request.rs`) is only READ, to confirm which fields the wire contract
requires (`content: String`, `model_id: Uuid`, `branch_id: Uuid`).

## Files this branch touches that the integration line is also moving

Checked with `git log --oneline -20 origin/feat/agent-core -- <path>`:

- `src-app/ui/src/modules/chat/core/extensions/registry.tsx` — actively evolving
  on the integration line (chat-extension work). **Highest collision risk.** The
  edit is deliberately confined to the body of ONE method
  (`composeRequestFields`, ~25 lines) plus one import, to keep a textual merge
  trivial.
- `src-app/ui/src/modules/chat/core/stores/chat/actions/sendMessage.ts` and
  `sendMessage.store.test.ts` — recently changed (in-flight latch / failure-state
  extraction). Edits are two localized insertions (a try/catch around the
  compose call; a guard immediately before the POST) plus appended tests.
- `sdk/packages/framework/src/lazy-dispatch.ts`, `store-kit.ts` — the SDK
  submodule is pinned at `sdk/agent-core-and-perf` @ `c6f5d8c`. `lazy-dispatch.ts`
  is small and rarely touched; `store-kit.ts`'s edit is a single call site.
- `src-app/ui/src/main.tsx`, `src-app/desktop/ui/src/main.tsx` — one import + one
  call each; both are stable files.

## Cross-workspace parity (R2-3)

`src-app/desktop/ui` resolves `@/*` through `localOverridePlugin`, falling back to
`src-app/ui/src`. It carries **no** override of `modules/chat/**`, so the chat
registry + sendMessage changes reach desktop automatically. The ONLY desktop file
needing a hand edit is its own `main.tsx` entry (ITEM-8). Verified with
`ls src-app/desktop/ui/src/modules` — no `chat/core` subtree.
