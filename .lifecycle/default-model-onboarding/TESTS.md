# TESTS — default-model-onboarding

Every ITEM is covered by ≥1 TEST; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (D2), not merely what the code happens to do.

**Proportionality note (binding).** The brief records a prior worker on this repo who wrote
a 2,243-line test apparatus around a 136-line fix, with 71 of 80 confirmed audit findings
landing on its own guard. The only new scaffolding enumerated here is ONE loopback git
fixture (needed because INV-1's proof REQUIRES a server that rejects credentials) reused by
both the Rust and Playwright legs' setup. Everything else asserts through the existing
harnesses. If an audit round's findings concentrate on this test code rather than the
feature, the response is to simplify it, not harden it (GUARD-SUB).

## Backend

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-1] file: `src-app/server/tests/llm_repository/default_model_seed_test.rs` — asserts: after a real server boot, the default-model repository row exists at its deterministic UUID with `built_in = true`, `enabled = true`, `auth_type = 'none'` and an `auth_config` carrying no credential — i.e. a FRESH install has it with no admin action. Fails if the row were seeded disabled, non-built-in, or credentialed.
- **TEST-2** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/llm_repository/default_model_seed_test.rs` — asserts: the migration is additive — the pre-existing `Hugging Face Hub` (`api_key`) and `GitHub` (`bearer_token`) rows are unchanged, all three coexist under `UNIQUE (name)` + `UNIQUE (url)`, and re-running the seed produces no duplicate.
- **TEST-3** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/utils/git/service.rs` — asserts: `GitService::build_repository_url` composes the org-scoped base `https://huggingface.co/unsloth` with `repository_path` `Qwen3.5-9B-GGUF` into `https://huggingface.co/unsloth/Qwen3.5-9B-GGUF` (no `.git` suffix on the huggingface branch, trailing-slash tolerant). This is the executable proof of DEC-1 — the reason the org-scoped URL is a correct answer to `UNIQUE (url)` and not a workaround that breaks cloning.
- **TEST-5** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2] file: `src-app/server/tests/llm_model/default_model_download_test.rs` — asserts: with a repository row at `auth_type = 'none'` pointed at a loopback git-over-HTTP fixture that **responds 401 to ANY request carrying an `Authorization` header**, `POST /api/llm-models/download` runs to completion and creates the model. The fixture also records every received request; the test asserts ZERO carried an auth header. **This test goes RED if a credential were required or sent at any point** — it cannot pass tautologically.
- **TEST-6** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-9] file: `src-app/server/tests/llm_model/default_model_download_test.rs` — asserts: cancelling an in-flight download leaves the `DownloadInstance` terminal-`cancelled`, creates **no** `llm_models` row for the descriptor name, and leaves no committed model directory — so nothing half-installed exists for the app to load. A second install attempt afterwards still succeeds (the cancel left no blocking residue).

## Frontend — unit (vitest)

- **TEST-7** (tier: unit) [covers: ITEM-2, ITEM-14] file: `src-app/ui/src/modules/onboarding/guides/getting-started/defaultModel.test.ts` — asserts: the descriptor is internally coherent (`main_filename` ends `.gguf`, `file_format === 'gguf'`, `engine_type === 'llamacpp'`) AND agrees three ways with the other artifacts that state the same facts — its repository UUID + URL match the seed migration `.sql`, and its repo/file/quant match the `## The model` table in `docs/design/default-model-onboarding.md`. Catches the doc or the migration drifting away from the shipped constant.
- **TEST-8** (tier: unit) [covers: ITEM-5, ITEM-9] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/viewState.test.ts` — asserts: the step's view state is DERIVED from the live download/provider stores, producing `offer` / `downloading` / `failed` / `cancelled` / `already-installed` for the corresponding live inputs, and that an in-flight download for the descriptor's `repository_path` yields `downloading` on a FRESH mount (the re-entry case) with no latched local state.
- **TEST-9** (tier: unit) [covers: ITEM-7] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/selectRuntime.test.ts` — asserts: runtime selection picks the newest non-prerelease `InstallableVersion` that has a host-matching variant, prefers `recommended_backend`, ignores versions whose `variants` contain no `matches_host`, and returns "unavailable" (→ the offline state) for an empty engines list — never treating an unreachable upstream's 200-with-empty-list as "no versions exist" (`runtime_version/handlers.rs:676-728`).
- **TEST-10** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/ensureLocalProvider.test.ts` — asserts: a DISABLED built-in local provider is enabled before the download starts; an already-enabled one is left untouched (no redundant write); and the action re-reads the provider list rather than trusting `updateLlmProvider`'s return, which is `null` when a concurrent update is in flight (`updateLlmProvider.ts:12-13`).
- **TEST-11** (tier: unit) [covers: ITEM-10] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/memoryAdvisory.test.ts` — asserts: the hardware advisory is shown below the working-set threshold, is NOT shown when the host memory figure is unavailable, and in no case changes the install button's enabled state or the step's readiness (INV-3).

## Frontend — e2e (Playwright, `--workers=1`)

- **TEST-12** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-3, ITEM-4, ITEM-6, ITEM-7] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: an admin walking Onboarding reaches the new step directly after "AI Providers", clicks Install, sees the runtime leg then the model leg complete, and — **without leaving Onboarding and without visiting any settings page** — finishes the wizard and finds the installed model selected as the default in a new chat's model picker. External boundaries only are stood in for (a loopback git fixture for the weights, the existing engine release mirror); every UI step, endpoint and store is real.
- **TEST-13** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-8] file: `src-app/ui/tests/e2e/onboarding/default-model-skip.spec.ts` — asserts: the same admin reaches the step, installs NOTHING, presses Next, and completes Onboarding into a working app — and that no download was started and no model exists afterwards. Fails if the step ever gated Next.
- **TEST-14** (tier: e2e) [covers: ITEM-4, ITEM-8] file: `src-app/ui/tests/e2e/onboarding/default-model-skip.spec.ts` — asserts: with the fixture forced to fail, Install surfaces the failure REASON plus a Retry affordance, and Next **still** advances the wizard (the INV-3 failure path, distinct from the never-tried path in TEST-13).
- **TEST-15** (tier: e2e) [acceptance] [invariant: INV-6] [covers: ITEM-9] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: with a download in flight, navigating AWAY from Onboarding to a settings page keeps the transfer running and its progress VISIBLE on the pre-existing download surface; returning to the step re-attaches to the same in-flight download (still progressing, not restarted, not cancelled). Fails if unmount cancelled the transfer or the step latched its own copy of the state.
- **TEST-16** (tier: e2e) [negative-perm] [positive-control] [covers: ITEM-4, ITEM-13] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: a user LACKING the model-create permission **still LOADS the Onboarding wizard and can reach and leave the step** (positive control — proving the page rendered), and on that step sees only the informational fallback: no Install button, no Cancel, no Retry. Without the positive control "absent" would be indistinguishable from "never rendered".
- **TEST-19** (tier: e2e) [covers: ITEM-13] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: at a 390px viewport the step produces no horizontal page overflow and its primary controls remain reachable and named; complements the axe/contrast pass that `gate:ui` runs over the same surface.

## Gates (enumerated because phase 8 requires them recorded)

- **TEST-17** (tier: unit) [covers: ITEM-11] file: `src-app/ui/src/dev/gallery/stateCoverage.ts` — asserts: `npm run check:state-matrix` passes — the regenerated `stateMatrix.generated.ts` is committed and every NEW required-state key the step introduces is mapped in `stateCoverage.ts`, following the sibling `MemorySetupStep:*` "via surface — rendered within its page" precedent rather than a bespoke gallery entry. An unmapped state fails `npm run check`.
- **TEST-18** (tier: unit) [covers: ITEM-12] file: `src-app/desktop/ui/package.json` — asserts: `npm run check` passes in the desktop workspace and `just desktop-drift-check` reports no override that drops logic from the changed web surfaces (rule R2-3). Recorded as `npm run check (desktop/ui): PASS` in TEST_RESULTS.md.

## Coverage map (bipartite completeness)

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2, TEST-3, TEST-5 |
| ITEM-2 | TEST-5, TEST-7 |
| ITEM-3 | TEST-12 |
| ITEM-4 | TEST-12, TEST-14, TEST-16, TEST-19 |
| ITEM-5 | TEST-8 |
| ITEM-6 | TEST-10, TEST-12 |
| ITEM-7 | TEST-9, TEST-12 |
| ITEM-8 | TEST-13, TEST-14 |
| ITEM-9 | TEST-6, TEST-8, TEST-15 |
| ITEM-10 | TEST-11 |
| ITEM-11 | TEST-17 |
| ITEM-12 | TEST-18 |
| ITEM-13 | TEST-16, TEST-19 |
| ITEM-14 | TEST-7 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-5 |
| INV-2 | TEST-12 |
| INV-3 | TEST-13 |
| INV-4 | TEST-6 |
| INV-5 | TEST-1 |
| INV-6 | TEST-15 |

No ITEM is `[DESCOPED]`.
