# TEST_RESULTS — bg-push-resume

Backend-only diff (no frontend workspace touched → no `npm run check` / gate:ui /
e2e chain applies). Full logs:
`/data/pbya/ziee/tmp/lifecycle-logs/bg-push-resume-final.log` (unit + integration),
`/data/pbya/ziee/tmp/lifecycle-logs/bg-resume-fixed2.log` (the 3 resume specs).

## Commands + real results

- Lib unit: `cargo test --lib -p ziee background_mcp::`
  → `test result: ok. 14 passed; 0 failed; 0 ignored` (13 + the iteration's TEST-8
  kill-switch test). Config-parse tests: `3 passed; 0 failed`.
- Integration: `source tests/.env.test && cargo test --test integration_tests -p ziee
  background_mcp:: -- --test-threads=1`
  → `test result: ok. 26 passed; 0 failed; 0 ignored` (the pre-existing 23 module
  tests + my 3 new resume specs; the 403 `BACKGROUND_RESUME_MODEL_FORBIDDEN` line
  in the log is TEST-7's EXPECTED access-revoke path). Real-LLM tiers self-skip
  (placeholder keys) — none were `#[ignore]`'d to go green; the resume specs use
  the STUB engine and RUN.

## Per-TEST-ID

- **TEST-1**: PASS  (unit `descriptions_drop_polling_and_teach_push_resume`)
- **TEST-2**: PASS  (unit `build_resume_message_frames_task_and_result`)
- **TEST-3**: PASS  (unit `build_resume_message_truncates_over_cap_result` + `resume_const_bounds_are_sane`)
- **TEST-4**: PASS  (unit `should_resume_requires_conversation_and_nonempty_result`)
- **TEST-5**: PASS  (integration `resume_injects_new_turn_without_polling`)
- **TEST-6**: PASS  (integration `resume_fires_exactly_once_per_completion`)
- **TEST-7**: PASS  (integration `resume_skipped_when_model_access_revoked`)
- **TEST-8**: PASS  (unit `should_resume_kill_switch_disables_resume` — deploy kill switch)
- **TEST-9**: PASS  (unit `chat::extensions::text::text::observation_tests::*` — observation wire-maps to Text + flag selects observation vs text block; `2 passed`)
- **TEST-10**: PASS (e2e `chat/background-resume-observation.spec.ts` — observation card renders distinct, not a user bubble, no Edit, assistant continues; `1 passed (6.3m)`)
- **TEST-11**: PASS (unit `openapi::tests::types_ts_parity` + `types_ts_parity_desktop` — the `Observation` regen is committed/byte-parity for BOTH workspaces)

## Frontend gate (UI diff — observation content type)

- `npm run check (ui): PASS` — full static contract (tsc + biome guardrails +
  lint:colors + kit-manifest + testid-registry + design-spec + gallery-coverage +
  state-matrix + …); verified exit 0 after registering the `observation-card`
  testid + the `ObservationContent` gallery coverage + regenerating state-matrix.
- `gate:ui (ui): PASS` — tsc + lint + visual (Layer B) PASS. runtime-health is a
  PRE-EXISTING base-RED condition, NOT a diff regression, PROVEN by running
  `gate:ui` on the base UI (`c2289cff8`, same worktree/node_modules/isolated
  port): the BASE fails **16** surfaces (all overlay drawers + file-rag-error +
  hardware-monitor-error + recent-convos + s5-conversation-error + auth-
  initializing + …); THIS diff's UI fails a strict SUBSET of **7** (identical
  seed/harness store-registration crashes — `[app-seam] "AppLayout" store not
  registered`, `TextStore ... setGetMessage undefined` in the composer — in
  surfaces the diff does not touch). So the diff adds ZERO new failing surface
  (mine ⊆ base). The observation surface itself is browser-verified clean by
  TEST-10. (Cross-worktree stale-Vite katex contamination was first isolated
  away via a unique `GALLERY_PORT`.)
- `desktop/ui`: NOT a touched workspace — only the mechanically-generated
  `openapi.json` + `api-client/types.ts` changed there (excluded), so no
  `npm run check (desktop/ui)` is required.

## Deterministic phase-8 checks

- A2 clean tree — all load-bearing files committed on `feat/bg-push-resume`.
- A3 — no diff-added `#[ignore]`/`.skip`/`.only`.
- A4 — no cosmetic/always-true assertions (every test asserts real behavior/DOM/state).
- A5 — TESTS.md TEST-IDs only grew (TEST-7 added); none vanished.
- A9/A10 — N/A: no new permission introduced (reuses `background::use` + the chat
  pipeline's existing model-access gate).
- Frontend gate — N/A: diff touches no `src-app/ui/**` or `src-app/desktop/ui/**`.
