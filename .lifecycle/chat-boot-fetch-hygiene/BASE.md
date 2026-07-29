# BASE — conflict surface vs the integration line

**Base branch:** `origin/feat/agent-core` @ `9363976a2` (NOT `main` — this work
never merges to main; every gate runs `--base origin/feat/agent-core`).
**Branch:** `fix/chat-boot-fetch-hygiene`.

## Migrations

- Highest existing migration on the base: `migrations-merged/202607191300_agent_delegate_enabled.sql`.
- **This branch adds NO migration.** No collision surface.

## OpenAPI / generated files

- No Rust type, handler, or permission changes ⇒ **no `just openapi-regen` implied**.
- `openapi.json` and `api-client/types.ts` are NOT touched in either workspace.

## Files this branch touches that the integration line may also be touching

| File | Risk |
|---|---|
| `src-app/ui/src/modules/chat/components/ConversationList.tsx` | Chat UI is an actively-worked area on the integration line. The diff here is the deletion of ONE `useEffect` + a comment rewrite — a small, well-localized hunk. A concurrent branch editing the same file will conflict textually only if it touches the same effect block. |
| `src-app/ui/src/modules/chat/pages/ChatHistoryPage.tsx` | Same; the diff is a comment rewrite on the existing mount effect. |
| `src-app/ui/tests/e2e/perf/*.spec.ts` | Two NEW files with feature-specific names (`chats-list-single-fetch.spec.ts`, `boot-tier-permission-gate.spec.ts`). No existing file is edited, so no conflict. |

## Known-modified paths deliberately NOT touched

- `src-app/server/vendor/pgvector` shows as modified in every worktree here
  (pre-existing submodule state) — left alone.
