# voice-composer-insert — BASE (conflict surface vs current main)

Branch cut from `origin/main` @ `35d18519f` ("agent-kit: fix the same ledger race
in merge-findings").

## Migration numbers

This branch adds **no** migration. Recorded for the merge-gate's C2 check:

| sequence | current max on main |
|---|---|
| server (`src-app/server/src/modules/*/migrations/`) | `202607200200` |
| desktop (`src-app/desktop/tauri/migrations/`) | `10000000000005` |

No collision is possible — the diff contains zero `.sql` files.

## OpenAPI regen

**Not implied.** No Rust type / handler / response shape changes, so
`openapi.json` and `api-client/types.ts` are unchanged in BOTH `src-app/ui/` and
`src-app/desktop/ui/`. C3 (regen parity) is trivially satisfied.

## Files this branch touches that main is also likely to touch

| file | contention risk | note |
|---|---|---|
| `chat/extensions/voice/**` | LOW | the voice extension is a leaf; the `voice-model-mgmt` work landed and is settled |
| `chat/extensions/text/textStore/**` | LOW | small, stable folder; the change is purely ADDITIVE (three new action files + three state fields) |
| `chat/extensions/text/components/TextInput.tsx` | MEDIUM | actively-edited composer file (drafts, edit-prefill, Enter-guard all landed here recently). The change here is confined to the existing mount-registration effect + the JSX ref — no logic in the draft/Enter paths is altered |
| `src/dev/gallery/{STATE_MATRIX.md,stateMatrix.generated.ts}` | HIGH (mechanical) | GENERATED and touched by nearly every concurrent UI branch. Expect a merge conflict here; resolution is always "regenerate on top of merged main" (`npm run gen:state-matrix`), never a hand-merge |
| `sdk/packages/gallery/.../testIds.generated.*` | HIGH (mechanical) | same class — regenerate on top after merging, per the known-collision note in project memory |
| `tests/e2e/14-voice/*.spec.ts` | LOW | owned by this feature area |

## Desktop mirror

`src-app/desktop/ui/` carries NO override for any file in this diff (verified:
`find src-app/desktop/ui/src -path '*extensions/voice*' -o -path
'*extensions/text*'` is empty). It resolves both modules from `../../ui/src` via
its vite alias and tsconfig paths, so the change propagates automatically and is
typechecked by the desktop workspace's own `tsc`. R2-3 has no hand-written
counterpart to diff.
