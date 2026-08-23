# TESTS — default-model-onboarding

Every ITEM is covered by ≥1 TEST; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (D2), not merely what the code happens to do.

**Tier placement is deliberate — see DEC-13 and DEC-14.** The install legs are proven at the
INTEGRATION tier (where the existing `MockReleaseServer` makes the runtime leg and the
download lifecycle cheap and deterministic), the step's hard-to-reach visual states at the
COMPONENT tier (`*.test.tsx`, vitest + jsdom — the same harness
`llm-local-runtime/components/AvailableVersionsCard.test.tsx` uses), and the browser tier
proves what only a browser can: that the step really is inside the wizard, that skipping
completes Onboarding, that a restricted user sees no controls, and that 390px is clean.
An e2e that drove the real 5.68 GB install would need either a live Hugging Face fetch
(forbidden by the design's test strategy) or an edit to the shared `tests/fixtures/test-context.ts`
server spawn (forbidden by rule B3).

**Proportionality note (binding).** The brief records a prior worker who wrote a 2,243-line
test apparatus around a 136-line fix, with 71 of 80 confirmed findings landing on its own
guard. **No new test scaffolding ships here at all.** A loopback git-over-HTTP fixture was
written for INV-1 and then DELETED once it proved unreachable (the clone path refuses
loopback by design, DRIFT-2.1); the invariant is asserted at the credential decision point
instead, which needs no fixture. Everything else asserts through harnesses that already
exist. If an audit round's findings concentrate on this test code rather than the feature,
the response is to simplify it, not harden it (GUARD-SUB).

## Backend

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-1] file: `src-app/server/tests/llm_repository/default_model_seed_test.rs` — asserts: after a real server boot on a fresh database, the default-model repository row exists at its deterministic UUID with `built_in = true`, `enabled = true`, `auth_type = 'none'` and an `auth_config` carrying no credential — a FRESH install has it with no admin action. Fails if the row were seeded disabled, non-built-in, or credentialed.
- **TEST-2** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/llm_repository/default_model_seed_test.rs` — asserts: the migration is purely additive — the pre-existing `Hugging Face Hub` (`api_key`) and `GitHub` (`bearer_token`) rows are byte-for-byte unchanged, all three rows coexist under `UNIQUE (name)` + `UNIQUE (url)`, and exactly one row carries the new URL.
- **TEST-3** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/utils/git/service.rs` — asserts: `GitService::build_repository_url` composes the org-scoped base `https://huggingface.co/unsloth` with `repository_path` `Qwen3.5-9B-GGUF` into `https://huggingface.co/unsloth/Qwen3.5-9B-GGUF` (huggingface branch → no `.git` suffix; trailing slash tolerated). The executable proof of DEC-1 — that the org-scoped URL answers `UNIQUE (url)` without breaking cloning.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-15] file: `src-app/server/src/modules/llm_repository/models.rs` — asserts: `LlmRepository::git_credential` — the single point at which a clone's credential is decided — yields `(None, None)` for an anonymous repository over **every** input, including the dangerous one: a row whose `auth_config` still carries an api_key, token, username and password. An unknown auth_type fails closed the same way. A companion test asserts the credentialed arms still return their secret, so the invariant cannot be satisfied by a function that always returns nothing. **Verified RED**: mutating the anonymous arm to leak `api_key` turns this test red (recorded in TEST_RESULTS).
  *Re-tiered at phase 6 (DRIFT-2.1).* The originally-planned loopback-fixture version is unreachable: `GitService::clone_repository` validates against `PUBLIC_HTTP_OR_HTTPS` **unconditionally** — deliberately, as the defense-in-depth check closing a Critical SSRF finding — so no local fixture can be cloned from, and the design forbids reaching for real Hugging Face. Weakening that check to make a test pass was rejected. Asserting at the decision point is also strictly stronger than watching a clone: it covers every input rather than the paths one clone happened to take.
- **TEST-5** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-9] file: `src-app/server/tests/llm_model/default_model_download_test.rs` — asserts: a download driven to a real FAILURE through the real endpoints creates **no** `llm_models` row for the descriptor's stable name, stamps no `model_id` on the instance, and records a reason; and a subsequent attempt is not blocked by residue (`llm_models` has `UNIQUE (provider_id, name)`, so a half-created row would surface as a conflict). Nothing half-installed survives for the app to load.
- **TEST-6** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-6, ITEM-7] file: `src-app/server/tests/llm_model/default_model_install_test.rs` — asserts: after running the sequence the step drives — enable the disabled built-in `local` provider, register a llamacpp runtime from the existing `MockReleaseServer` and mark it system default, land the model under that provider — the end state is **servable**: an `enabled` model under an `enabled` local provider, naming the engine that was installed, with that engine as the llamacpp system default (the value `BinaryManager::select_runtime_version` falls through to, and which a fresh install has none of). Both pre-conditions are asserted FIRST so the test cannot go vacuous. The weights transfer itself is not driven here for the reason under TEST-4; its own correctness is TEST-4/TEST-5/TEST-7.
- **TEST-7** (tier: integration) [acceptance] [invariant: INV-6] [covers: ITEM-9] file: `src-app/server/tests/llm_model/default_model_download_test.rs` — asserts: a download started and then ABANDONED by its client (the HTTP response consumed, the progress stream dropped) keeps running server-side to completion, and is still reported by `GET /api/llm-models/downloads` afterwards — so navigating away neither cancels the transfer nor loses it, and a client returning later can see it. Fails if the transfer were bound to a client connection.

## Frontend — unit

- **TEST-8** (tier: unit) [covers: ITEM-2, ITEM-14] file: `src-app/ui/src/modules/onboarding/guides/getting-started/defaultModel.test.ts` — asserts: the descriptor is internally coherent (`main_filename` ends `.gguf`, `file_format === 'gguf'`, `engine_type === 'llamacpp'`) AND agrees three ways with the other artifacts stating the same facts — its repository UUID + base URL match the seed migration `.sql`, and its repo / file / quant match the `## The model` table in `docs/design/default-model-onboarding.md`. Catches the design doc or the migration drifting away from the shipped constant.
- **TEST-9** (tier: unit) [covers: ITEM-5, ITEM-9] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/viewState.test.ts` — asserts: the step's view state is DERIVED from live store inputs — `offer` / `installing-runtime` / `downloading` / `failed` / `cancelled` / `already-installed` for the corresponding inputs — and that an in-flight download for the descriptor's `repository_path` yields `downloading` on a FRESH derivation with no prior local state (the re-entry case behind INV-6's client half).
- **TEST-10** (tier: unit) [covers: ITEM-7] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/selectRuntime.test.ts` — asserts: runtime selection picks the newest non-prerelease `InstallableVersion` having a host-matching variant, prefers `recommended_backend`, ignores versions whose variants contain no `matches_host`, and returns "unavailable" (→ the offline state) for an empty engines list — never reading an unreachable upstream's 200-with-empty-list as "no versions exist" (DEC-8, `runtime_version/handlers.rs:676-728`).
- **TEST-11** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/ensureLocalProvider.store.test.ts` — asserts: a DISABLED built-in local provider is enabled before the download starts; an already-enabled one is left untouched (no redundant write); and the action re-reads the provider list rather than trusting `updateLlmProvider`'s return value, which is `null` when a concurrent update is in flight (`updateLlmProvider.ts:12-13`).
- **TEST-12** (tier: unit) [covers: ITEM-10] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/memoryAdvisory.test.ts` — asserts: the hardware advisory is produced below the working-set threshold, is absent when the host memory figure is unavailable, and never changes install availability or step readiness (INV-3).
- **TEST-13** (tier: unit) [covers: ITEM-4, ITEM-8] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/DefaultModelStep.test.tsx` — asserts: MOUNTED in the `failed` state the step renders the failure REASON and a Retry control, and the action it registered with `registerBeforeNext` still RESOLVES (Next advances after a failure — INV-3's failure path). A mounted assertion, not a source scan.
- **TEST-14** (tier: unit) [covers: ITEM-4, ITEM-9] file: `src-app/ui/src/modules/onboarding/guides/getting-started/components/DefaultModelStep.test.tsx` — asserts: MOUNTED in `downloading` the step renders live percent plus a Cancel control; in `already-installed` it renders no install control; in the unpermitted case it renders the informational fallback and no install / cancel / retry control (DEC-12). Unmounting the component issues NO cancel call (INV-6, DEC-9).

## Frontend — e2e (Playwright, `--workers=1`)

- **TEST-15** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-3, ITEM-4] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: an admin walking Onboarding reaches the new step immediately after "AI Providers" **without leaving the wizard and without visiting any settings route**, and the step presents the default model by name, file and size with an install control ready. This is INV-2's location half (its "working model" half is TEST-6); the spec fails if the step were placed elsewhere, gated behind a settings page, or unreachable.
- **TEST-16** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-8] file: `src-app/ui/tests/e2e/onboarding/default-model-skip.spec.ts` — asserts: the same admin reaches the step, installs NOTHING, presses Next, and completes Onboarding into a working app — and that no download was started and no model exists afterwards. Fails if the step ever gated Next.
- **TEST-17** (tier: e2e) [negative-perm] [positive-control] [covers: ITEM-4, ITEM-13] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: a user LACKING the model-create permission **still LOADS the Onboarding wizard and can reach the step and advance past it** (positive control — proving the page really rendered), and on that step sees only the informational fallback: no Install, no Cancel, no Retry. Without the positive control, "absent" would be indistinguishable from "never rendered".
- **TEST-22** (tier: e2e) [negative-perm] [positive-control] [covers: ITEM-4, ITEM-13] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: a user holding EVERY permission the flow needs EXCEPT `llm_providers::assign_groups` — including `llm_models::create`, the one the control was originally gated on — **still LOADS the step and can advance past it** (positive control), and is offered no Install control. Added in fix round 1: the plain no-permissions case cannot tell "gated on the whole flow" from "gated on any one thing", and under the original single-permission gate this user would have been shown an enabled button that 403s partway through, after the provider had already been changed.
- **TEST-18** (tier: e2e) [covers: ITEM-13] file: `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` — asserts: at a 390px viewport the step produces no horizontal page overflow and its primary controls stay visible and accessibly named — complementing the axe / AA-contrast pass `gate:ui` runs over the same surface.

## Gates (enumerated because phase 8 records them)

- **TEST-19** (tier: unit) [covers: ITEM-11] file: `src-app/ui/src/dev/gallery/stateCoverage.ts` — asserts: `npm run check:state-matrix` passes — the regenerated `stateMatrix.generated.ts` is committed and every NEW required-state key the step introduces is mapped in `stateCoverage.ts`, following the sibling `MemorySetupStep:*` "via surface — rendered within its page" precedent (DEC-10). An unmapped state fails `npm run check`.
- **TEST-20** (tier: unit) [covers: ITEM-12] file: `src-app/desktop/ui/package.json` — asserts: `npm run check` passes in the desktop workspace and the desktop drift check reports no override that drops logic from the changed web surfaces (rule R2-3). Recorded as `npm run check (desktop/ui): PASS`.

## Coverage map (bipartite completeness)

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2, TEST-3 |
| ITEM-2 | TEST-8 |
| ITEM-3 | TEST-15 |
| ITEM-4 | TEST-13, TEST-14, TEST-15, TEST-17, TEST-18, TEST-22 |
| ITEM-5 | TEST-9 |
| ITEM-6 | TEST-6, TEST-11 |
| ITEM-7 | TEST-6, TEST-10 |
| ITEM-8 | TEST-13, TEST-16 |
| ITEM-9 | TEST-5, TEST-7, TEST-9, TEST-14 |
| ITEM-10 | TEST-12 |
| ITEM-11 | TEST-19 |
| ITEM-12 | TEST-20 |
| ITEM-13 | TEST-17, TEST-18, TEST-22 |
| ITEM-14 | TEST-8 |
| ITEM-15 | TEST-4 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-4 |
| INV-2 | TEST-6 (working model) + TEST-15 (inside Onboarding) |
| INV-3 | TEST-16 |
| INV-4 | TEST-5 |
| INV-5 | TEST-1 |
| INV-6 | TEST-7 |

No ITEM is `[DESCOPED]`.

---

## Added during the phase-6/7 fix rounds

These were not in the phase-3 enumeration; each was written to close a confirmed
audit finding, and is listed here so phase 8 records every ID it runs.

- **TEST-21** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-1] file: `src-app/server/tests/llm_repository/default_model_seed_test.rs` — asserts: the boot connection-health scan never auto-disables the seeded anonymous row. The pre-existing skip is `if !repository.has_credential()`, which does NOT cover an anonymous row (`has_credential_for("none") => true`), so without the second skip the row would be health-checked against Hugging Face at every boot and disabled on a network failure — silently breaking INV-5 on exactly the offline first-run this feature targets. Asserts `enabled` stays true and `last_health_check_status` stays `untested` over a 30s window.
- **TEST-23** (tier: unit) [covers: ITEM-6] file: `.../defaultModelStep/install.store.test.ts` — asserts: the three install legs run in order, a re-entrant call while `installing` is a no-op (no second 5.68 GB transfer), the readiness leg's `problem` is propagated verbatim rather than replaced with a generic message, and `installing` is always cleared in `finally`.
- **TEST-24** (tier: unit) [covers: ITEM-7] file: `.../defaultModelStep/ensureRuntime.store.test.ts` — asserts: the runtime leg installs a version when none is present, matches an already-installed one on the FULL `{engine, version, platform, arch, backend}` tuple rather than version alone, and does not short-circuit on a list populated only after the download.
- **TEST-25** (tier: unit) [covers: ITEM-8] file: `.../defaultModelStep/reset.store.test.ts` — asserts: `reset()` restores every field to its initial value, so a user who leaves and re-enters Onboarding does not inherit a stale `error` / `stage` / `installing` from a previous visit.

| INV | additionally pinned by |
|---|---|
| INV-5 | TEST-21 (the row also stays enabled after boot, not merely at seed time) |
