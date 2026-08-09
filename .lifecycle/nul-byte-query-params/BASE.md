# BASE — conflict surface vs current main

Branch cut from `origin/main` @ `dca29493f`.

## Migrations

This branch adds **no migration**. Recorded for collision-checking only:

- server sequence max in use: `202607200400`
- desktop sequence max in use: `10000000000005`

Nothing on this branch writes schema, so a migration-number collision with
concurrent main work is structurally impossible here.

## Files this branch touches that main may also be touching

| file | risk |
|---|---|
| `src-app/server/src/common/mod.rs` | LOW — one added `pub mod text_guard;` line |
| `src-app/server/src/common/text_guard.rs` | NONE — new file |
| `modules/project/handlers.rs` | LOW — two small hunks (`reject_nul` body, `normalize_search` body) |
| `modules/chat/core/handlers/conversations.rs` | LOW — one hunk in `list_conversations` |
| `modules/chat/core/handlers/validation.rs` | LOW — one hunk (`reject_nul_in_content` body) |
| `modules/mcp/handlers/{user,system}.rs` | LOW — one hunk each |
| `modules/memory/handlers.rs` | LOW — one hunk (three normalizations) |
| `modules/user/handlers/groups.rs` | LOW — one hunk (`reject_nul` body) |
| `agent-kit/docs/CODING_GUIDELINES.md` | MEDIUM — `agent-kit` is a SHARED submodule that other projects also edit; see the known fragmentation risk. Documentation-only, append-shaped, no code depends on it. |
| `src-app/server/tests/**` | LOW — new test files + one new shared helper module registration |

## OpenAPI regen implied?

**No.** No `#[derive(JsonSchema)]` type gains, loses or retypes a field; only
handler bodies change. Re-verified at phase 8 by running the regen and
confirming a zero diff in both `src-app/ui/` and `src-app/desktop/ui/`.

## Frontend

**No frontend files are touched.** `src-app/ui/**` and
`src-app/desktop/ui/**` are untouched, so the phase-3/phase-8 frontend gates
(e2e enumeration, `npm run check`, `gate:ui`) do not apply to this diff.
