# BASE — conflict surface vs current main

Branch cut from `origin/main` @ `35d18519f`.

## Migrations

- Highest existing **server** migration prefix: `202607200300`
  (`find src-app/server -path '*/migrations/*.sql' | cut -d_ -f1 | sort -n | tail -1`).
- This branch adds exactly one: `202607200400_message_completion_state.sql`
  under `src-app/server/src/modules/chat/migrations/`.
- Duplicate-prefix scan across `src-app` returns empty at cut time.
- Desktop sequence (`1e13` block, max `10000000000005`) untouched.
- **Collision risk**: any concurrently-merging branch that also claims
  `202607200400`. Re-checked by `merge-gate.mjs` C2 against real main at merge.

## Files also live on main

- `src-app/server/src/modules/chat/core/services/streaming.rs` — a large, actively
  edited file. This branch touches three narrow regions (the finish-reason
  override ~:764, `thinking_config_for` ~:1171, the persist path in
  `DeltaAccumulator::finalize` ~:1426). Textual conflict is plausible; semantic
  conflict is unlikely.
- `src-app/ui/src/modules/chat/components/ChatMessage.tsx` and
  `emptyCompletion.ts` — smaller surface, lower churn.

## OpenAPI regen implied

**Yes.** ITEM-3 adds a field to the message read model, so both
`src-app/ui/` and `src-app/desktop/ui/` `openapi.json` + `api-client/types.ts`
are regenerated. These are mechanically generated and are a known positional-diff
source; verify the content delta with `comm` on sorted files if the diff looks
large. `merge-gate.mjs` C3 checks regen parity for both workspaces.

## Other

- `docs/design/empty-completion-diagnosis.md` is new — no conflict surface.
- Test fixture bytes added under `src-app/server/ai-providers/tests/` — new file,
  no conflict surface.
