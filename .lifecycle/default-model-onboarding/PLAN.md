# PLAN — default-model-onboarding

## Design source

Realizes `docs/design/default-model-onboarding.md` (merged on `main` @ `25fbcdaa7`) —
§*Invariants*, §*The model*, §*What gets built* (1 seed migration, 2 Onboarding step,
3 no default-model work), §*Security*, §*Test strategy*, §*Open questions* (both resolved
as DEC-3 / DEC-4).

Task brief: `/data/khoi/home-workspace/paws-worker-tasks/default-model-onboarding.md`.

## Invariants

Lifted VERBATIM from the design's `## Invariants` section — not paraphrased.

- **INV-1**: Installing the default model requires **no credential** — no API key, no token, no login — at any point.
- **INV-2**: The user reaches a working model **without leaving Onboarding** and without visiting a settings page.
- **INV-3**: Onboarding is **completable without installing the model**. The download is offerable, never mandatory; skipping leaves a valid state.
- **INV-4**: A failed, cancelled, or interrupted download **never leaves a half-installed model** the app will try to load.
- **INV-5**: The default-model repository row is **built-in and enabled by default**, so a fresh install has it with no admin action.
- **INV-6**: A download started from Onboarding **continues if the user navigates away**, and its progress stays visible elsewhere in the app. The user must be able to browse settings while a multi-GB download runs.

## Gaps found against the design (resolved before implementation)

The design's "no new infrastructure is required" claim was re-verified against the codebase.
It holds for download/progress/LFS/hosting. Three things it did NOT anticipate:

- **G1 — `llm_repositories` has `UNIQUE (url)`** (`llm_repository/migrations/202607140175_llm_repository_schema.sql:29`)
  and the credentialed `Hugging Face Hub` row already holds `https://huggingface.co`
  (`…145040_llm_repository_seed.sql:4`). A second row at that exact URL is impossible.
  → DEC-1: seed the row **org-scoped** at `https://huggingface.co/unsloth`. Org-scoped HF
  bases are explicitly supported (`llm_repository/utils.rs:384-404`,
  `RepositoryKind::HuggingFace => true`), and `GitService::build_repository_url`
  (`utils/git/service.rs:691-706`) composes it with `repository_path` into the correct
  clone URL. No schema change, no constraint drop.
- **G2 — the built-in `Local` provider is `enabled = false`** (`llm_provider/migrations/202607145035…:10`)
  and `list_local_providers` filters `WHERE provider_type = 'local' AND enabled = true`
  (`llm_provider/repositories/admin.rs:184-193`), so a fresh install has **nothing to
  download into**. → DEC-5.
- **G3 — a fresh install has NO local runtime engine.** No migration inserts into
  `llm_runtime_versions`, and `BinaryManager::select_runtime_version`
  (`llm_local_runtime/binary_manager.rs:491-561`) returns `None` with no auto-fetch, so the
  downloaded GGUF could not be served — the design's stated goal is "finish Onboarding,
  have a model, **talk to it**". → DEC-6 (owner decision): the step provisions a llama.cpp
  runtime as well. ITEM-14 amends the design doc accordingly.

Verified as already-true (no work): `has_credential_for("none") => true`
(`llm_repository/models.rs:116-135`); the download path passes **no credential** for
`auth_type='none'` (`llm_model/handlers/uploads.rs:1040-1054`, `"none" | _ => (None, None)`);
the `llm_models` row is created **only on successful completion**
(`uploads.rs:1322-1358`), so a cancel/failure cannot leave a half-installed model (INV-4
holds by construction — the acceptance test proves it rather than assuming it); the
`LlmModelDownload` store runs server-side with `initializeDownloadTracking` on store init
and `RuntimeDownloadProgress.loadActive()` re-attaches to in-flight engine downloads
(INV-6 by construction for both legs).

## Items

- **ITEM-1**: Seed migration `src-app/server/src/modules/llm_repository/migrations/202607210100_llm_repository_default_model_seed.sql` — one `llm_repositories` row: deterministic UUID, `built_in = true`, `enabled = true`, `auth_type = 'none'`, empty `auth_config`, url `https://huggingface.co/unsloth`. Positional `INSERT INTO public.llm_repositories VALUES (…)` mirroring `202607145040_llm_repository_seed.sql`'s 13-column shape. Prefix sorts above the server max `202607200600` and is unrelated to the desktop `1e13` block.
- **ITEM-2**: A single frontend descriptor module holding the default-model constants (repository row UUID, `repository_path`, `main_filename`, stable model `name`, display name, size bytes, `file_format: 'gguf'`, `engine_type: 'llamacpp'`, engine `llamacpp`) so the step, its store, the gallery and the e2e specs read ONE definition. Fixed constants, not an admin settings row (DEC-7).
- **ITEM-3**: Register the step in `guides/getting-started/module.tsx`'s `steps` array as `{ id: 'default-model', title: 'Local Model' }`, immediately after `api-keys` and before `mcp-servers`.
- **ITEM-4**: `DefaultModelStep.tsx` — the step surface. Composes existing `@ziee/kit` components only. Renders every state: **offer · installing-runtime · downloading (live %, speed, ETA, Cancel) · success · failed (reason + Retry + Next still advances) · cancelled · already-installed · unpermitted**, plus the load state.
- **ITEM-5**: `components/stores/defaultModelStep/` — the step's store (store-kit `defineStore` + `actions/` + `actions.gen.ts`), mirroring `memorySetupStep/`. Owns the install orchestration and derives its view state from the LIVE `LlmModelDownload` / `RuntimeDownloadProgress` / `LlmProvider` stores; it keeps no private copy of transfer state.
- **ITEM-6**: Local-provider readiness (G2) — resolve the `provider_type === 'local'` provider and, if it is disabled, enable it via the existing `LlmProvider.updateLlmProvider` before starting the model download. Idempotent; skipped when an enabled local provider already exists.
- **ITEM-7**: Runtime-engine provisioning leg (G3) — `RuntimeVersion.listAvailable({ engine: 'llamacpp' })` → pick the newest non-prerelease version whose variants include a host match → `RuntimeDownloadProgress.startDownload({engine, version, platform, arch, backend})` using the host-matching variant's `recommended_backend` → on completion `RuntimeVersion.setDefaultVersion(id)`. Skipped when a llamacpp version is already installed. Its progress is a distinct step state, not merged into the model bar.
- **ITEM-8**: Non-blocking advance (INV-3) — `registerBeforeNext` registers an action that always resolves and never throws, and `Onboarding.setReady(true)` on mount, so Next advances in every state including mid-download and post-failure.
- **ITEM-9**: Already-installed detection + re-entry (DEC-3, INV-6) — the step is derived, not latched: on mount it reads the live stores and renders **already-installed** when a model with the stable descriptor `name` exists under the local provider, or **downloading** when a matching in-flight `DownloadInstance` exists. Leaving and returning re-attaches; unmount never cancels.
- **ITEM-10**: Hardware advisory (DEC-4) — a non-blocking warning when the host's reported memory is below the model's working set, read from the existing hardware surface. Advisory only; it never disables the install button and never gates Next.
- **ITEM-11**: Gallery coverage for every new conditional state introduced by ITEM-4, including a narrow-viewport (390px) cell, so `check:state-matrix` inside `npm run check` passes.
- **ITEM-12**: Desktop parity (R2-3) — diff `src-app/desktop/ui/` against the changed web surfaces and confirm no override drops logic; run `npm run check` in that workspace. No `just openapi-regen` is expected (no backend type or route changes); if the diff proves otherwise, regen BOTH workspaces.
- **ITEM-13**: Accessibility + responsive pass on the step per the UI-surface checklist — accessible names on every control, live-region progress, no horizontal scroll at 390px, tap targets, and no reactive store read inside a `.map()`/conditional (use the non-subscribing `.$`).
- **ITEM-15**: *(added at phase 6 — see DRIFT-2.1)* Extract the git-credential decision out of the download handler into `LlmRepository::git_credential`, so "an anonymous repository sends nothing" is assertable **at the point the credential is decided**, over every input, rather than inferred from a clone that happened to succeed. Pure refactor of an inline `match`; no behaviour change.
- **ITEM-14**: Amend `docs/design/default-model-onboarding.md` — record G1 and G2 under *What gets built*, and add the runtime-provisioning leg (DEC-6). The `## Invariants` section is NOT touched.

## Files to touch

**Backend (server)**
- `src-app/server/src/modules/llm_repository/migrations/202607210100_llm_repository_default_model_seed.sql` (new)
- `src-app/server/tests/llm_repository/default_model_seed_test.rs` (new)
- `src-app/server/tests/llm_repository/mod.rs` (edit — register the test module)
- `src-app/server/tests/llm_model/default_model_download_test.rs` (new — the anonymous-clone fixture + INV-1 / INV-4 proofs)
- `src-app/server/tests/llm_model/mod.rs` (edit — register the test module)

**Frontend (`src-app/ui`)**
- `src-app/ui/src/modules/onboarding/guides/getting-started/module.tsx` (edit)
- `src-app/ui/src/modules/onboarding/guides/getting-started/defaultModel.ts` (new — ITEM-2 descriptor)
- `src-app/ui/src/modules/onboarding/guides/getting-started/components/DefaultModelStep.tsx` (new)
- `src-app/ui/src/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/{index.ts,state.ts,actions.gen.ts,viewState.ts,selectRuntime.ts,memoryAdvisory.ts,actions/*.ts}` (new)
- `src-app/ui/tests/e2e/onboarding/default-model-step.spec.ts` (new)
- `src-app/ui/tests/e2e/onboarding/default-model-skip.spec.ts` (new)

*Amended at phase 5 (DRIFT-1.1) — the step insert is NOT additive to the e2e
suite.* Ten existing specs walk the wizard by counting Next clicks and assert
`onboarding-step-<id>` between hops, so each needs one pass-through hop:
`tests/e2e/onboarding/{onboarding-wizard,progress-api,onboarding-mcp-install,onboarding-api-key-save,guide-step-navigation,wizard-mcp-step,onboarding-to-first-chat,wizard-api-key-save}.spec.ts`
and `tests/e2e/memory/onboarding-{skip,enable}.spec.ts`.

*Amended at phase 5 (DRIFT-1.4) — generated + registry artifacts.* Adding a
surface and ten testids makes these stale, and `npm run check` refuses each:
`src-app/ui/src/dev/gallery/{stateMatrix.generated.ts,STATE_MATRIX.md,galleryCoverage.generated.ts,coverage.ts,stateCoverage.ts}`
(regenerated by their own scripts; the two hand-maintained maps follow the
sibling `MemorySetupStep` precedent), plus **`sdk/packages/kit/src/testIds.generated.ts`
in the `sdk` SUBMODULE**, committed there with the pointer bumped here.

**Frontend (`src-app/desktop/ui`)** — inspection + `npm run check` only; edits only if the drift check finds a dropped override.

**Docs**
- `docs/design/default-model-onboarding.md` (edit — ITEM-14)

No `modules/*/permissions.rs` is touched and no migration grants a permission: the feature
reuses the EXISTING `Permissions.LlmModelsCreate`, `Permissions.LlmProvidersEdit`,
`Permissions.RuntimeVersionRead` / `Permissions.RuntimeVersionCreate` and
`Permissions.LlmRepositoriesRead`. A restricted-user e2e is enumerated anyway
(TEST-13) because the step's controls are permission-gated and the informational
fallback is a real user-visible path worth proving.

## Patterns to follow

| Area | Mirror this |
|---|---|
| Seed migration | `src-app/server/src/modules/llm_repository/migrations/202607145040_llm_repository_seed.sql` — positional `INSERT`, hardcoded UUID + timestamps, one statement per row. |
| Seed integration test | `src-app/server/tests/seed/mod.rs` — spawn a `TestServer`, connect a `PgPoolOptions` pool to `server.database_url`, assert on rows. |
| Step component | `guides/getting-started/components/MemorySetupStep.tsx` — `OnboardingStepProps`, `Onboarding.setReady(true)` + `registerBeforeNext` in a mount effect, `usePermission` fallback branch, `Title`/`Paragraph`/`Alert` shell. |
| Progress rendering | `modules/hub/modules/llm-models/components/ModelHubCard.tsx:570-684` — `Progress` with `format` composing `%` + `formatSpeed` + `formatTime` from `@/utils/downloadUtils`, and the failed-bar + Retry treatment. |
| Model download call | `modules/llm-provider/components/llm-models/AddLocalLlmModelDownloadDrawer.tsx::onValid` — the canonical `LlmModelDownload.downloadLlmModelFromRepository({...})` argument shape and duplicate-in-flight guard. |
| Engine download call | `modules/llm-local-runtime/components/drawers/RuntimeDownloadDrawer.tsx` + `stores/runtimeVersion/actions/downloadVersion.ts` + `stores/runtimeDownloadProgress/actions/{startDownload,loadActive}.ts`. |
| Step store | `guides/getting-started/components/stores/memorySetupStep/` — `defineStore` + `import.meta.glob('./actions/*.ts')` + a generated `actions.gen.ts`. |
| Store read discipline | Render reads `Stores.X.field`; handlers/async read `Stores.X.$.field` (`useHubModelDownloadGate.tsx:158-177` documents exactly why). |
| e2e | `src-app/ui/tests/e2e/memory/onboarding-enable.spec.ts` + `…/onboarding-skip.spec.ts` — the closest twin (an optional admin-only Onboarding step with an enable path and a skip path). |
| Design tokens / kit | root `DESIGN_SYSTEM.md` — semantic tokens only, 4px rhythm, `Field`-not-raw-flex for form layout, no `antd`, no raw `<button>`. |

## Plan audit (phase 2 — verdicts recorded here per the skill; PLAN_AUDIT.md is no longer a separate file)

Dimensions below, then a verdict per ITEM.

### Breakage risk

- ITEM-1 adds a row; it does not modify the two existing seeded rows. `UNIQUE (name)` and
  `UNIQUE (url)` are both respected by the chosen name/url (DEC-1). Nothing reads
  `llm_repositories` expecting exactly two rows — checked: `hub/handlers.rs` resolves by URL
  (`derive_registry_url`), `llm_repository/handlers.rs` lists, and the drawer filters
  `enabled`. A third enabled row appears in the LLM Repositories admin list and in the
  download drawer's repository `Select`; that is intended and matches the design's INV-5.
- The hub pre-download gate resolves `repositories.find(r => r.url === 'https://huggingface.co')`
  (`useHubModelDownloadGate.tsx:186-202`), an EXACT match — the new org-scoped row cannot
  be picked up by it, so hub downloads are unaffected.
- ITEM-6 flips one built-in provider row's `enabled` at install time. It is user-initiated
  and reversible from the existing providers page; no migration changes existing installs.
- ITEM-7 writes a `llm_runtime_versions` row + `is_system_default` through existing
  endpoints. On a host that already has a llamacpp version installed the leg is skipped, so
  an existing default is never overwritten.

### Pattern conformance

Every new file has a named sibling in *Patterns to follow*. The step is registered through
the existing `onboarding` slot; no new slot, module, or route is introduced. The store uses
the store-kit `defineStore` authoring model that `memorySetupStep` already uses (not the
legacy `__init__.__store__` key).

### Migration collisions

Highest server prefix on `origin/main` today is **`202607200600`**
(`llm_repository/migrations/202607200600_llm_repository_unverified_status.sql`); the desktop
sequence's max is `10000000000005` and is independent. `202607210100` sorts above the server
max and below the desktop block. No duplicate prefixes exist across `src-app` today
(verified). Recorded in `BASE.md`; the merge-gate re-checks C2 against real main at merge.

### OpenAPI regen

**Not required.** No handler, request/response type, permission, or `SyncEntity` changes —
the feature drives existing endpoints only. `openapi.json` / `api-client/types.ts` are
generated and must never be hand-edited; if implementation proves a backend type changed,
`just openapi-regen` runs for BOTH `ui/` and `desktop/ui/` and this line is amended.

### Per-item verdicts

- **ITEM-1** — verdict: PASS — mirrors `202607145040_llm_repository_seed.sql`; 13-column positional shape matches the live schema incl. the `202607200600` status columns; prefix `202607210100` > server max `202607200600`; `UNIQUE(url)`/`UNIQUE(name)` satisfied by DEC-1.
- **ITEM-2** — verdict: PASS — a constants module has no runtime seam to break; `file_format: 'gguf'` and `engine_type: 'llamacpp'` are both in the DB CHECK vocabularies (`llm_models` `check_file_format` / `check_engine_type`).
- **ITEM-3** — verdict: PASS — `steps` is a plain array in the `onboarding` slot; `OnboardingStep` requires only `{id,title,component}`; `progress-persistence.spec.ts` and `onboarding-wizard.spec.ts` walk the guide generically, so an inserted step is additive.
- **ITEM-4** — verdict: CONCERN — the state matrix is the widest part of the feature and `check:state-matrix` will demand a gallery cell per new conditional state; the onboarding module is `crawlOnly: true`, so how its cells are declared must be confirmed against `src/dev/gallery/` before ITEM-11 is written rather than assumed.
- **ITEM-5** — verdict: PASS — `memorySetupStep/` is a direct template; the live stores expose everything needed (`LlmModelDownload.downloads`, `RuntimeDownloadProgress.activeByKey`, `LlmProvider.providers[].llm_models`).
- **ITEM-6** — verdict: CONCERN — `updateLlmProvider` early-returns `null as any` when `state.updating` is already true (`updateLlmProvider.ts:12-13`); the install action must not assume a truthy return, and must re-read the provider list afterwards rather than trusting the resolved value.
- **ITEM-7** — verdict: CONCERN — `list_available_versions` answers **200 even when upstream is unreachable**, carrying the truth in `source`/`unavailable_reason` (`runtime_version/handlers.rs:676-728`). An empty list must be surfaced as the **offline** state, never as "no versions exist"; and a version whose `variants` carry no `matches_host` entry must not be selected.
- **ITEM-8** — verdict: PASS — `registerBeforeNext` accepts an async fn or `null`; `MemorySetupStep` already registers a fn that can no-op, and the wizard advances on resolve.
- **ITEM-9** — verdict: PASS — `llm_models` has `UNIQUE (provider_id, name)` (`llm_model/migrations/202607140160…:73`), so a stable descriptor `name` makes the already-installed test exact and also makes a double-install impossible at the DB level. `find_existing_in_progress` (`uploads.rs:963-976`) already returns the in-flight instance instead of starting a second download.
- **ITEM-10** — verdict: CONCERN — the memory figure must come from an existing surface (the `hardware` module) and be treated as optional: when it is unavailable the advisory is simply not rendered. It must never disable install (INV-3).
- **ITEM-11** — verdict: CONCERN — same open question as ITEM-4; resolve the `crawlOnly` gallery mechanics first.
- **ITEM-12** — verdict: PASS — `src-app/desktop/ui` reuses `src-app/ui` through the `@/…` alias with a three-tier override resolver; a new file under `ui/src` is picked up with no desktop edit unless an override shadows it. `just desktop-drift-check` is the mechanical check.
- **ITEM-13** — verdict: PASS — enforced by `npm run check` (biome guardrails, `lint:colors`, kit manifest, testid registry) plus `gate:ui` (axe + AA contrast + runtime health).
- **ITEM-14** — verdict: PASS — a docs edit; the `## Invariants` section is untouched, so the phase-1 verbatim lift stays valid.
- **ITEM-15** — verdict: PASS — the extracted `match` is byte-equivalent to the inline one it replaces (the only change is `"none" | _` collapsing to `_`, which is the same arm); it lands next to `has_credential`, which already reasons about the same `auth_type` vocabulary; and the one caller is updated in the same commit.

No `BLOCKED` verdicts. The four `CONCERN`s are open questions to resolve during
implementation, not blockers; each is re-checked in the phase-5 drift loop.
