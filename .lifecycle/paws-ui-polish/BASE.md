# BASE — conflict surface vs current main

Branch cut from `origin/main` **8b295b268** ("Merge pull request #14 from
tinnlab/feat/paws-feature-surface"), fetched at branch time.

## Migration numbering

Two independent sequences — do not conflate them.

| sequence | highest in tree | this branch |
|---|---|---|
| server (`src-app/server/src/modules/*/migrations/`) | `202607210300` (`file_rag/…_paws_disable_semantic_search.sql`) | ONE new file, prefix **above `202607210300`** |
| desktop (`src-app/desktop/tauri/migrations/`) | `10000000000005` | untouched |

`src-app/server/src/modules/skill/migrations/` currently holds only
`202607140210_skill_schema.sql` and `202607144200_skill_fkeys.sql`, so the new
skill migration is the third file there and sorts last in the server sequence.

Verified no duplicate prefixes exist today:
`find src-app -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort | uniq -d` prints nothing.

⚠ `migration_immutability.rs` treats every **committed** migration as immutable
(byte-compares each against the commit that added it, with a 4-entry
grandfather list that "may only ever SHRINK"). Nothing existing is edited on
this branch; the new file is exempt until it is committed and pushed.

## Files this branch touches that main is also moving

At branch time `origin/main` has no open in-flight work in these paths that I
can see from the merged history — the three most recent merges (#12
realtime-sse, #13 gpu-backend-detect, #14 paws-feature-surface) are all landed.
The overlap to watch at merge time:

- `src-app/ui/src/modules/layouts/app-layout/components/LeftSidebar.tsx` — the
  paws-feature-surface work changed which modules contribute slots; a further
  change there would collide with ITEM-4.
- `src-app/server/resources/builtin-skills/**` and `resources/hub-seed/index.json`
  — the hub/skill surface is shared with the hub-migration workstream (owned
  elsewhere; CLAUDE.md says do not touch the `io.github.phibya` publisher IDs).
  ITEM-9 edits `index.json`, so a concurrent hub-seed bump is the realistic
  collision.
- `src-app/server/src/modules/llm_model/handlers/uploads.rs` and
  `llm_local_runtime/validator.rs` — touched by the default-model-onboarding
  line, which is merged, but is the area most likely to see follow-up work.

## OpenAPI regen implied?

**No.** No handler signature, request/response schema, permission or
`SyncEntity` variant changes are planned. `MERGE_GENERATED` covers
`openapi.json` + `api-client/types.ts` for both workspaces; the merge-gate's
C3 regen-parity check will confirm rather than be taken on trust. If any
implementation step forces a schema change, `just openapi-regen` runs for BOTH
workspaces and the regen is recorded as a drift entry.

## Submodule surface

ITEM-5 may touch `sdk/packages/notification-ui/`. The sdk is a submodule pinned
by `.gitmodules` to the `chat` branch while paws consumes the `paws` line — a
known trap recorded by the realtime-sse work. If ITEM-5's resolution requires an
sdk edit it needs its own sdk branch cut from `origin/paws` plus a
submodule-pointer bump, and that is called out in DECISIONS rather than done
implicitly.
