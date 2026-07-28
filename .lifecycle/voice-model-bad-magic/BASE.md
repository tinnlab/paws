# BASE — conflict surface vs current base (`origin/feat/agent-core`)

Branch: `fix/voice-model-bad-magic`, cut from `origin/feat/agent-core` at
`d53db2d11`.

## Migrations

Migrations are **per-module** on this base (`src-app/server/src/modules/*/migrations/`),
not a single global directory. The voice module's tail:

```
src-app/server/src/modules/voice/migrations/
  202607144210_voice_fkeys.sql
  202607145065_voice_seed.sql
  202607146085_voice_grant_permissions.sql
```

**This branch adds no migration.** The fix is a validation constant, error
messages, and presentation — no schema, no seed, no permission change. Migration
collision risk: **none**.

## OpenAPI regen

Not expected. The changed values are error *strings* carried in existing payload
fields (`SSEModelDownloadFailedData.error`, the `AppError` body), not schema
shapes. No new `#[derive(JsonSchema)]` type, no new field, no new route.

If the implementation nonetheless alters a schemars-derived shape, `just
openapi-regen` must run for **both** binaries (server `ui/` + desktop `ui/`) and
`openapi::emit_ts::tests::types_ts_parity` must be green. Tracked as a verdict in
PLAN_AUDIT `## OpenAPI regen`.

## Files this branch touches that the base may also be changing

| File | Note |
|---|---|
| `src-app/server/src/modules/voice/model.rs` | Voice module is not under active edit on the base; last touched by the merged `voice-model-mgmt` work. Low collision risk. |
| `src-app/server/src/modules/voice/model_handlers.rs` | Same. |
| `src-app/server/tests/voice/model_management_test.rs` | Test-only. |
| `src-app/server/tests/voice/mod.rs` | **Shared voice test harness** — the staged-model helper is used by other voice suites (`lifecycle_test`, `streaming_real_test`). Changing the fixture bytes here affects those suites, so the change must keep the staged file *valid*, and those suites must be re-run at Phase 8. This is the one genuine cross-suite surface. |
| `src-app/ui/src/modules/voice/components/AvailableModelsCard.tsx` | UI-only, voice settings. |
| `src-app/ui/src/modules/voice/gallery.tsx` | Gallery manifest — feeds `check:gallery-coverage` / `check:state-matrix`; a new state cell is additive. |
| `src-app/ui/tests/e2e/14-voice/voice-model-mgmt.spec.ts` | Test-only. |

## Sibling `.lifecycle` dirs on the base — INHERITED, never delete

The base carries 17 sibling `.lifecycle/` dirs (`agent-orchestration`,
`background-in-conversation`, `chat-ui-robustness`, `control-describe-schema`,
`control-mcp-e2e-coverage`, `e2e-render-serving`, `frontend-perf`,
`hook-lint-guardrails`, `live-ui-audit-fixes`, `live-ui-audit-round2`,
`net-hygiene`, `perf-ux-round2`, `smart-module-loading`, `sse-slot-leak`,
`streamdown-html-renderer`, `workflow-kind-agent`, `worktree-isolation`).

Guard before every commit:

```
git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle   # must be empty
```

## Live-instance interaction

The owner's live instance (`:1530` UI, `:29600` backend, app-data at
`/data/pbya/ziee/tmp/live-rig-wt/ziee-data/dev/app-data`, DB `ziee_live_view` on
`127.0.0.1:54396`) was **read only** during analysis. Nothing was killed, edited,
or deleted. Per E1/E2 in BUG_ANALYSIS there is no detritus to clean: the
`voice-models/` directory is empty and `voice_models` has zero rows.
