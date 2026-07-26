# chat-ui-robustness — BASE (conflict-surface scoping)

## Branch base

- Branch: `feat/chat-ui-robustness`
- Cut from: `origin/feat/agent-core` @ `60b0db310`
  ("lifecycle(streamdown-html-renderer): blind audit + fix-round + gated test
  results"). NOT from `origin/main` — the four defects and the mermaid/html
  re-verification are all against the agent-core chat surface, and the
  streamdown-renderer fix (`3f6319d9a`) that ITEM-8 re-verifies exists only on
  that branch.
- The live audit's base, `fp-ac-merge` @ `51164e4cd`, is **NOT an ancestor** of
  `60b0db310` (verified: `git merge-base --is-ancestor 51164e4cd 60b0db310` →
  false). Every finding must therefore be re-checked against THIS tree before it
  is treated as live — which is exactly what ITEM-8 does.

## Migrations

- Highest existing migration: **n/a for this branch** — there is no
  `src-app/server/migrations` directory on `feat/agent-core`; migrations were
  moved into the SDK crates (each crate owns its own). This change adds **ZERO**
  migrations (frontend-only), so there is no migration-number collision surface.

## OpenAPI regen

- **Not implied.** No Rust handler, request/response type, permission or
  `SyncEntity` is touched. `openapi.json` and `api-client/types.ts` are untouched
  in both workspaces, so `just openapi-regen` is not part of this change and the
  C3 regen-parity gate has nothing to reconcile.

## Files current main / sibling branches are also touching

Concurrent agents on this same audit are explicitly partitioned away from this
branch's file set:

| Area | Owner | This branch |
|---|---|---|
| app shell / layout containers, responsive `overflow-x` / `clipped-control` | another agent | NOT touched |
| network-fetch + store files for `conversations` \| `llm-models` | another agent | NOT touched |
| backend (`src-app/server/**`, SDK crates) | another agent | NOT touched |
| chat module frontend + MCP approval components | **this branch** | owned |

Residual collision risk inside the owned set:

- `src-app/ui/src/modules/chat/components/MessageList.tsx` (ITEM-4) is a
  high-traffic file on `feat/agent-core`. The edit is a 3-attribute addition to
  one JSX node — small, and textually distant from the virtualization logic that
  usually churns. Re-check at merge time.
- `src-app/ui/src/modules/chat/core/stores/chat/actions/sendMessage.ts` (ITEM-1,
  ITEM-3) is the file the agent-core cutover most recently reworked. The edits
  are a scope change (move the `try` up) plus one early-return; a concurrent edit
  in the same action would conflict textually. Re-check at merge time.
- `src-app/desktop/ui/src/**` mirrors — the desktop workspace carries
  HAND-WRITTEN copies of some chat files (R2-3). Each changed `src/` file is
  checked for a desktop counterpart at implement time; a counterpart that exists
  gets the identical logic change (never a silent divergence).

## Build/environment notes

- `preflight.sh --repo /data/pbya/ziee/tmp/chat-ui-robustness-wt` → **OK** after
  `git submodule update --init agent-kit sdk src-app/server/vendor/pgvector`,
  copying `src-app/server/binaries/hub-seed` from the primary clone, and
  `npm install` at the repo root.
- The e2e harness needs a prebuilt `src-app/target/debug/ziee`
  (`tests/fixtures/harness-process.ts::serverBinaryPath`) — built in this
  worktree, not shared.
