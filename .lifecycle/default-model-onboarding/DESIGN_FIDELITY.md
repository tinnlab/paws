# DESIGN_FIDELITY — default-model-onboarding

One verdict per `INV-N` in PLAN.md's `## Invariants`, against
`docs/design/default-model-onboarding.md`.

> This file is the AUTHOR's own verdict, and the skill is explicit that an author's
> verdict on their own fidelity carries little information (84 UPHELD / 0 DROPPED across
> 22 features; one feature self-certified six UPHELD that a blind auditor found violated).
> The load-bearing checks are the `[acceptance]` tests (phase 3 / phase 8) and the BLIND
> `design-conformance` angle (phase 6). This is recorded for coherence, not as proof.

- **INV-1** — fidelity: UPHELD — ITEM-1 seeds `auth_type = 'none'` with an empty `auth_config`, and the download path passes NO credential for that auth_type (`llm_model/handlers/uploads.rs:1040-1054`: `"none" | _ => (None, None)`). Nothing in ITEM-5/6/7 asks for a token, and the engine leg reads a public GitHub release. Proven by TEST-5, whose fixture **rejects any request carrying an `Authorization` header**, so the test goes RED if a credential were ever required.
- **INV-2** — fidelity: UPHELD — ITEM-3 puts the install inside the wizard; ITEM-6 removes the disabled-local-provider blocker (G2) and ITEM-7 the missing-engine blocker (G3), which is what makes "a **working** model" true rather than merely "a downloaded file". No settings page is visited: the step drives the same endpoints those pages do. With exactly one installed model, `defaultModelId() = explicit ?? firstEnabledModelId()` resolves to it with no new field (`user-llm-providers/modelPicker/actions/_firstEnabledModelId.ts`).
- **INV-3** — fidelity: UPHELD — ITEM-8 makes `registerBeforeNext` always resolve and never throw, and ITEM-4 renders a Skip affordance in every state incl. `failed`. Nothing in the step calls `Onboarding.setReady(false)`. Proven by TEST-11 (skip without installing completes Onboarding) and TEST-12 (Next still advances after a failure).
- **INV-4** — fidelity: UPHELD — the `llm_models` row is created ONLY after a successful download (`uploads.rs:1322-1358`); cancel/failure paths set a terminal `DownloadInstance` status and pass `model_id: None`. ITEM-9's stable descriptor `name` plus `UNIQUE (provider_id, name)` means a retry after a cancel cannot produce a second, partial row either. Proven by TEST-6 rather than assumed.
- **INV-5** — fidelity: UPHELD — ITEM-1's row is `built_in = true`, `enabled = true` in the migration itself, so a fresh install has it with zero admin action. DEC-1's org-scoped URL changes the row's `url` value, NOT its built-in/enabled character. Proven by TEST-1/TEST-2.
- **INV-6** — fidelity: UPHELD — both transfers run SERVER-side. ITEM-5 forbids the step owning transfer state: it derives from `LlmModelDownload.downloads` (populated by the store's own `initializeDownloadTracking` + SSE) and `RuntimeDownloadProgress.activeByKey` (re-attached by `loadActive()`), and ITEM-9 forbids cancel-on-unmount. Progress stays visible elsewhere via the pre-existing `DownloadIndicatorWidget` / `DownloadsSection` / `ModelHubCard`. Proven by TEST-14, which navigates AWAY mid-download, asserts progress is visible on another surface, and returns to find the step still live.

**No `DROPPED` verdicts.** The one place the plan goes BEYOND the design rather than
narrowing it is DEC-6/ITEM-7 (runtime provisioning), which exists to make INV-2's "working
model" literally true; ITEM-14 amends the design doc so the doc and the code agree.
