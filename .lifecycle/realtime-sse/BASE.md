# BASE — conflict-surface scoping

Branch `fix/realtime-sse-delivery`, cut from **`origin/main` = 1e6d93449**
("Merge pull request #10 from tinnlab/feat/default-model-onboarding"). An earlier
draft named `b6cebdb15`; the lead corrected it — that base was 25 commits behind.

## Migration numbers

This branch adds **no migration**. Recorded for the merge-gate's C2 check:

| sequence | highest in use at base |
|---|---|
| server (`src-app/server/src/modules/*/migrations/`) | `202607210200` |
| desktop (`src-app/desktop/tauri/migrations/`) | `10000000000005` |

PR #10 also landed a **migration-immutability guard**
(`server/tests/migration_immutability.rs`) that fails on any edit to an
already-shipped migration. Nothing here edits one.

## OpenAPI regen

**Not implied.** No request/response type, handler signature, permission or
`SyncEntity` variant changes. `KeepAlive` (ITEM-8) is a transport concern with no
schema surface; making `CHAT_STREAM_CONNECTION_HEADER` `pub` (ITEM-2) changes no
type. The merge-gate's C3 regen-parity check is still expected to run and to produce
an empty diff for both `ui/` and `desktop/ui/`.

## Files current main is also changing

Remote branches at base: `origin/main` plus the already-merged
`feat/default-model-onboarding`, `design/paws-feature-surface` and
`chore/strip-lifecycle-artifacts`. **No unmerged branch competes for a file here.**

Two live in-flight peers to watch, neither with a pushed branch at this base:

- **`default-model` (landed as PR #10)** — deliberately REVERTED its fix to
  `src-app/ui/src/modules/llm-provider/stores/llmModelDownload/actions/subscribeToDownloadProgress.ts`
  (commit `cdddbba7b` on its branch) so this branch owns that file. Verified: the
  file at this base is byte-identical to `origin/main`. PR #10 also left a 14-line
  `tracing::error!` in `chat/core/services/streaming.rs` — useful context for this
  investigation, not touched here.
- **`provider-visibility`** — works in the `llm_provider` area. No pushed branch at
  this base, but `src-app/ui/src/modules/llm-provider/**` is a plausible overlap;
  ITEM-7 is confined to ONE action file plus its co-located test, which keeps the
  collision surface to a single file.

## Submodules

- **`sdk`** — the paws line is the **`paws`** branch on `ziee-ai/sdk` (the owner's
  standing policy: branch from `paws`, PR into `paws`; never `chat`/`main`, because
  `chat` belongs to another platform). Base `origin/main` pins `c38e9fcc`, which is
  an ANCESTOR of `origin/paws` (`8693247`, one commit ahead — a testId-registry
  regen). This branch cuts `fix/cors-required-headers` from `origin/paws`, so the
  gitlink moves `c38e9fcc → <my sdk commit>` and carries that one intervening regen
  with it.
  ⚠ **Follow-up for the lead, deliberately NOT done here:** `.gitmodules` still
  declares `branch = chat` for `sdk`, so `git submodule update --remote` would pull
  the wrong line. It is a policy edit that would collide with other in-flight
  workers.
  ⚠ **Follow-up:** unlike a generated-registry bump, `create_cors_layer_with` is a
  REAL shared framework fix, so when the chat fix ports upstream to `ziee-ai/ziee`
  the sdk half needs its **own upstream PR** rather than riding a pointer bump.
- `agent-kit`, `src-app/server/vendor/pgvector` — untouched.
