# BASE — conflict surface vs current main

Branch cut from `origin/main` = `e915089ca` ("chore: strip lifecycle artifacts
before merge").

| item | value |
|---|---|
| highest server migration prefix | unchanged — this branch adds no `.sql` |
| desktop migration block | untouched |
| `openapi.json` regen implied | NO — no Rust type/handler/schema touched |
| `sdk` submodule | pinned at `0ba6253855742813bb43e7e0466131496c8ed97a` (branch `chat`), **not modified** by this branch |

## Files this branch touches that main is also moving

- `src-app/ui/tests/e2e/visual/overlays.spec.ts` — last touched well before
  `e915089ca`; the change that BROKE it (`c1a7c82a5`) touched
  `src-app/ui/src/modules/chat/gallery.tsx`, not the spec. Low collision risk.
- `src-app/ui/src/dev/gallery/fixtures/chat-deep.ts` — actively edited by chat/rail
  work. This is the realistic collision point; the edit is confined to the single
  `collapsedToolBoxes` bundle at the end of the file.
- `src-app/ui/src/dev/gallery/coverage.ts` — appended to by most UI features.
  This branch edits two existing `reason` strings and adds no keys, so a textual
  conflict is possible but trivially resolvable.
- `src-app/ui/src/modules/chat/gallery.tsx` — actively edited (the picker cases
  landed there two days before the branch point). This branch edits only the
  `deep-chat-collapsed-tool-boxes` entry's `title`/`note`.

No file in this diff is shared with a backend module, a migration, or a
generated artifact.
