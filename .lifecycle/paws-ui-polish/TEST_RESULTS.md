# TEST_RESULTS — paws-ui-polish

Every failure is classified A/B/C per CLAUDE.md's known environment floor **with
its error signature quoted** before being called environmental. Nothing is marked
green by soft-skip.

## Workspace gates

- **npm run check (ui): PASS** — exit 0
- **npm run check (desktop/ui): PASS** — exit 0 (114/114 node tests)
- **gate:ui (ui): PASS** — `205/205` surfaces runtime-clean; validity line
  `592/592 cells · origin alive (67 checks) · transport artifacts 0 (0% of
  findings)`; `tsc` PASS, `lint` PASS, `runtime-health` PASS. An absolute clean
  run, so no baseline comparison is needed — branch cannot be worse than base at
  zero gating findings.
- `cargo check -p ziee --tests`: clean, no new warnings.

> **Reading `npm run check` output needs care.** It runs
> `gate-ui.config.e2e.mjs` and `gate-ui.stale.e2e.mjs`, which deliberately drive
> the REAL gate through failure scenarios. Their fixture output contains
> `❌ GATE FAILED — tsc, runtime-health, visual` lines that are the assertion
> SUCCEEDING, not the workspace failing. The workspace verdict is the exit code.

## Per-test results

| test | tier | result | how run |
|---|---|---|---|
| **TEST-1**: PASS | e2e | download-popover geometry at 320/390/1440px | `npx playwright test tests/e2e/llm/download-popover-responsive.spec.ts --workers=1` |
| **TEST-2**: PASS | unit | bounds on the PANEL, no inline size on a content child | `npx vitest run src/modules/llm-provider` |
| **TEST-3**: PASS | unit | CSS truncation, full name preserved, percent not displaced | `npx vitest run src/modules/llm-provider` |
| **TEST-4**: PASS | e2e | gallery renders the Downloads popover OPEN and populated | `npx playwright test tests/e2e/visual/gallery-download-popover.spec.ts --config=playwright.visual.config.ts --workers=1` |
| **TEST-5**: PASS | e2e | bell + download share one horizontal band; degrades to one child | `npx playwright test tests/e2e/llm/sidebar-icon-row.spec.ts --workers=1` |
| **TEST-6b**: PASS | unit | desktop module graph keeps both widgets, drops `user-profile` | `npx vitest run src/modules` |
| **TEST-7**: PASS | unit | `sidebarBottom` row survives an empty `sidebarTools` slot | `npx vitest run src/modules/layouts` |
| **TEST-8**: PASS | integration | the UPGRADE case — seeded lingering rows cannot reach the model after the migration | `cargo test --test integration_tests skill::` |
| **TEST-9**: PASS | integration | surviving built-in set asserted by NAME, not by count | `cargo test --test integration_tests skill::builtin` |
| **TEST-10**: PASS | integration | extracted skill CONTENT routes nobody to a hidden surface (all 13 features) | `cargo test --test integration_tests skill::` |
| **TEST-11**: PASS | integration | hub seed has no `effective-prompting` (0 skills, 29 items, `hub_version` 2.1.0); index still self-consistent | `cargo test --test integration_tests hub::catalog_v1` → 15 passed |
| **TEST-12**: PASS | unit | the resolve is pure; no deliberate refusal was weakened | `cargo test --lib -p ziee llm_local_runtime::proxy_handlers` |
| **TEST-13**: PASS | integration | upload-commit path enqueues Tier-2 exactly once | `cargo test --test integration_tests llm_model::sync_emit` |
| **TEST-14**: PASS | e2e | **the consumer-observed promise** — model appears and answers, no reload | `npx playwright test tests/e2e/llm/downloaded-model-chat-no-reload.spec.ts --workers=1` |
| **TEST-15**: PASS | integration | validator's terminal transition publishes BOTH sync entities | `cargo test --test integration_tests llm_model::sync_emit` |
| **TEST-16**: PASS | unit | forced refresh during a load; burst coalescing; joiner isolation (a–f) | `npx vitest run src/modules/llm-provider` |
| **TEST-17**: PASS | unit | `endpoint_resolve_tests` — INV-5's resolve contract | `cargo test --lib -p ziee llm_local_runtime::proxy_handlers` |

**The withdrawn desktop geometry spec** (the slot formerly numbered 6) has no
result line because it is no longer enumerated as a test in TESTS.md — it does
not exist. The desktop e2e harness fails to connect for a PRE-EXISTING reason (an
untouched sibling spec fails identically), so on the owner's decision the spec was
DELETED rather than left skipped or ignored. What is therefore uncovered — the
rendered pixel arrangement of the one-row layout under the desktop module set
specifically — is stated in TESTS.md and in the PR body. TEST-5 covers the row's
geometry in a real browser and TEST-6b covers the desktop module graph.

Frontend unit sweep: `npx vitest run src/modules/llm-provider src/modules/layouts`
→ **6 files, 35 tests, all pass.**
Skill suite: `cargo test --test integration_tests skill:: -- --test-threads=4`
→ **58 passed, 0 failed.**

### TEST-17's scope changed, and the change is recorded not glossed

TESTS.md planned TEST-17 as an integration test in a
`llm_local_runtime/validation_race_test.rs` asserting a `running` row with a
dropped bearer. That file does **not** exist, deliberately: neither predicted
state turned out to be the defect, and neither is reachable from an integration
test anyway (`INSTANCE_API_KEYS` is a process-global inside the SERVER process,
which the harness spawns as a subprocess). TEST-17 now lives as
`endpoint_resolve_tests` in `proxy_handlers.rs`, and the real INV-5 coverage moved
to the four gates below. Recorded in `DRIFT-1.md` and `FIX_ROUND-2..4.md`.

## Item 5 — the four deterministic gates

`cargo test --test integration_tests llm_local_runtime::start_races -- --test-threads=1`
→ **4 passed, 0 failed** (57s).

Each was run against **its own fix reverted** and observed to FAIL, reproducing
the pre-fix signature:

| gate | RED signature with its fix reverted |
|---|---|
| `g2a_cancelled_waiter_does_not_break_the_start` | `Model instance already running already exists` — the live-reproduction string, verbatim |
| `g2b_engine_killed_out_of_band_recovers_without_waiting_out_the_timeout` | `engine for this model is marked failed (flap protection)` |
| `g2c_dead_engine_fails_fast_not_at_the_deadline` | **120.2s** against a 120s timeout, vs the test's 30s bound |
| `g2d_wedged_engine_is_reclaimed_not_waited_on_forever` | model still reports `running` |

Three earlier versions of these gates passed WITH their defect present and were
rewritten rather than kept — reasons in `FIX_ROUND-2..4.md` and in the test file.
Two coverage gaps are stated rather than engineered around (the duplicate
`enqueue`, and the validation hand-off); see the honest-gap block at the foot of
`start_races_test.rs`.

## Broader backend suite

`cargo test --test integration_tests -- --test-threads=4 llm_local_runtime:: llm_model::`
→ **186 passed, 21 failed.** All 21 are **Category A**, verified from signatures:

| n | signature | why it cannot pass here |
|---|---|---|
| 19 | `HUGGINGFACE_API_KEY not set … : NotPresent` | `tests/.env.test` contains **no `HUGGINGFACE_API_KEY` line at all** — checked, not inferred |
| 2 | `not set. Source tests/.env.test … the GitHub auto-detect tests require it` | needs a real `GITHUB_TOKEN`; the committed one is a placeholder (CLAUDE.md) |

Zero failures are attributable to the diff. Two further known-A failures appear
when `llm_local_runtime::` is run alone: `model_files_real_test::…` (same missing
HF key) and `gold_smoke::real_release_download_and_infer` (env-gated on a real
`llama-server` + GGUF).

One **Category B** observation, named rather than silently re-run:
`lifecycle_test::provider_instances_lists_running` failed once under
`--test-threads=4` and passed in isolation and on the next full run — parallel
contention on a shared box, not a regression.

`settings_test::{get_returns_defaults, partial_patch_preserves_other_fields}`
were **updated, not excused**: they hard-coded the retired 30s default and now
assert 180 with a comment naming migration `202607220200` and the measurement
behind it.

## Live end-to-end — corroboration, not a gate

Recorded with timestamps in `INFRA_INTEGRATION.md`: a real 296 MB repository
download on a fresh first-boot instance (which reported `row=180 /
coldefault=180`, the SHIPPED default, before any manual edit), with the chat sent
while `validation_status` still read `processing`. The answer streamed back with
no reload. One of four runs is reported as **invalid** — my repro reused the git
cache and produced a 134-byte LFS pointer instead of a GGUF — rather than elided.
