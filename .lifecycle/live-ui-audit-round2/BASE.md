# BASE — conflict surface for live-ui-audit round 2

## Branch base

- Worktree: `/data/pbya/ziee/tmp/liveaudit-wt`, branch `fix/live-ui-audit-defects`
- Base commit: `24ce5dcca` = tip of `origin/feat/agent-core` at cut time
  (`fix(chat/hub/e2e): awaitable repo load, composer text loss, e2e env fallback`)
- All lifecycle gates run with `--base origin/feat/agent-core`.

## Migrations

- Highest existing module migration at cut time:
  `src-app/server/src/modules/agent/migrations/202607191300_agent_delegate_enabled.sql`
  (migrations are per-module dirs merged by `build.rs::compose_merged_migrations`
  into `migrations-merged`, not one flat `migrations/`).
- **This round adds NO migration** — every item is frontend/SDK-frontend only.
  Migration-number collision surface: none.

## OpenAPI regen

- **Not implied.** No server type, handler, or route changes. `openapi.json` and
  `api-client/types.ts` are untouched in both workspaces, so the
  `openapi::emit_ts::tests::types_ts_parity` golden stays green unchanged and no
  `just openapi-regen` is required.

## Files this branch will touch that main may also be touching

| file | who else is active | mitigation |
|---|---|---|
| `src-app/ui/src/modules/chat/core/stores/chat/actions/sendMessage.ts` | round 1's `HUMAN_FEEDBACK` FB-2 explicitly kept round 1 OUT of `modules/chat/**`; no other landed branch touches this action | single small addition at the top of the action closure; no signature change |
| `src-app/ui/src/modules/loader.ts` / `loadContext.ts` | an unlanded `feat/perf-ux-round2` worktree also sits on `24ce5dcca` and its brief (per FB-2) mentions the boot waterfall | this branch's change is additive (a new speculative wave + an options arg); if that branch lands first, re-run the merge-gate and reconcile |
| `src-app/ui/src/modules/summarization/**`, `memory/chat-extension/**`, `background/**` | not touched by any known in-flight branch | — |
| e2e specs under `src-app/ui/tests/e2e/` | two other agents are actively writing specs in `file/`, `14-voice/`, `memory/`, `sync/`, `chat/`, `15-background/`, `14-split-chat/`, `hardware/`, `hub/` | this round adds ONE new file under `tests/e2e/perf/` — a directory none of them touch |

## Submodules

- `agent-kit` and `sdk` are pinned submodules. **NEITHER is edited by this
  round**, so no submodule pointer moves and the branch stays fast-forward
  landable on its own. `agent-kit` is deliberately untouched: INV-1 requires the
  audit script be byte-identical between the BEFORE and AFTER runs.
