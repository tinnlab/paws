# Design — a default local model, installable from Onboarding with no API key

**Status:** draft for review · **Scope:** ziee server + desktop

## Problem

A new user finishing Onboarding has **no working model** unless they bring an API
key. Both seeded repositories are credentialed. First-run value is conditional on
the user already having an account somewhere.

Goal: **finish Onboarding, have a model, talk to it.** No key, no settings page.

## Invariants

- **INV-1**: Installing the default model requires **no credential** — no API key,
  no token, no login — at any point.
- **INV-2**: The user reaches a working model **without leaving Onboarding** and
  without visiting a settings page.
- **INV-3**: Onboarding is **completable without installing the model**. The
  download is offerable, never mandatory; skipping leaves a valid state.
- **INV-4**: A failed, cancelled, or interrupted download **never leaves a
  half-installed model** the app will try to load.
- **INV-5**: The default-model repository row is **built-in and enabled by
  default**, so a fresh install has it with no admin action.
- **INV-6**: A download started from Onboarding **continues if the user navigates
  away**, and its progress stays visible elsewhere in the app. The user must be
  able to browse settings while a multi-GB download runs.

## The model

| | |
|---|---|
| repo | `unsloth/Qwen3.5-9B-GGUF` |
| file | `Qwen3.5-9B-Q4_K_M.gguf` |
| size | **5.68 GB** |
| engine | llama.cpp (GGUF — the verified path) |

Qwen publishes no official GGUF for this model. `unsloth` is the highest-usage
third-party build (1.35M downloads, not gated); `lmstudio-community/Qwen3.5-9B-GGUF`
(542k) is the fallback if unsloth is ever unavailable.

`Q4_K_M` is the standard quality/size default. The repo holds 25 quants from
`UD-IQ2_XXS` to `BF16` (17.92 GB), so the download **must select one file** — it
must not clone the repo wholesale.

> **Not the base repo.** `Qwen/Qwen3.5-9B` is safetensors, which routes to
> **mistral.rs**, whose subcommand flags CLAUDE.md records as *"not yet verified
> against a real `mistralrs-server` binary"*. Making an unverified engine path the
> default for every first-run user is the wrong risk. GGUF → llama.cpp is tested.

## No new infrastructure is required

Researched before designing; this is most of the work already done.

- **Hugging Face public repos are anonymously clonable.** Verified:
  `GIT_TERMINAL_PROMPT=0 git ls-remote https://huggingface.co/unsloth/Qwen3.5-9B-GGUF`
  → exit 0, no credential. So `auth_type: 'none'` against `huggingface.co` works
  and **no self-hosted git server is needed** (INV-1).
- `auth_type: "none"` is already first-class —
  `RepositoryAuthConfig::has_credential_for("none") => true`.
- The LFS client's `url_with_auth(url, access_token: Option<&str>)` accepts `None`.
- File selection already exists: `llm_model/handlers/repo_files.rs` does
  pre-download discovery (`classify`, `detect_weight_set`, `is_gguf`).
- The REST surface already exists: `POST /llm-models/download`,
  `GET /llm-models/downloads/subscribe` (**SSE progress**),
  `POST /llm-models/downloads/{id}/cancel`.
- **INV-6 is satisfied by construction**: the download runs **server-side**, so it
  is not bound to the step's lifetime. The `llmModelDownload` store
  (`subscribeToDownloadProgress`, with reconnect accounting) already tracks it and
  `ModelHubCard` already renders progress — so leaving Onboarding neither cancels
  the download nor hides it. Binding it to the step would have been *extra* work.

**Consequence: no new download, progress, LFS, or hosting code.** The work is a
seed row, an Onboarding step, and the default-model semantics below.

> A self-hosted Gitea instance was considered and is **not needed**. It would only
> matter if we wanted to be independent of HF's availability — a legitimate future
> concern, but it buys nothing for INV-1 and costs a server, TLS, and a multi-GB
> LFS store. Revisit only if HF becomes a problem.

## What gets built

**1. Seed migration** — mirrors `202607145040_llm_repository_seed.sql`: a
`built_in`, `enabled` row with `auth_type='none'` and empty `auth_config`,
deterministic UUID. Prefix must sort above the current **server** max
(`202607200600`) — not above the desktop `1e13` block; the sequences are
independent.

**2. Onboarding step** — a new entry in `guides/getting-started/module.tsx`'s
`steps` array, after `api-keys` (a user who added a key can skip) and before
`finish`. Uses the existing `OnboardingStepProps` / `registerBeforeNext` contract
and drives the existing download endpoints with SSE progress.

States needing gallery coverage: offer · downloading (live %, cancel) · success ·
failed (reason + retry + skip that still advances) · cancelled (no partial
artifact) · already-installed · offline.

A 5.68 GB download inside a wizard is the main UX risk. It must not block
completion (INV-3).

**3. No default-model work is needed.** A fresh install seeds **no models at
all** (no `INSERT INTO llm_models` in any migration), and the model picker
already resolves:

```
defaultModelId()      = explicit new-chat choice ?? firstEnabledModelId()
firstEnabledModelId() = first enabled model across providers, else null
```

So with zero models it is `null`; install exactly one and that one **is** the
default, with no new field, migration, or setting. An earlier draft proposed a
user-level `default_model_id` — unnecessary, and removed.

## Security

Anonymous means **no secret is stored** — this removes a risk class rather than
adding one. The row is `built_in` and inherits existing edit protections. The URL
is operator-seeded, not user-supplied; `validate_url` still governs admin edits.

## Test strategy (enumerated properly at lifecycle phase 3)

- **unit**: seed-row shape; the already-installed predicate; quant file selection.
- **integration**: the row exists, is `built_in` + `enabled`, `auth_type='none'`;
  download against a **local git+LFS fixture** with no credential; cancel leaves
  no partial artifact (INV-4).
- **e2e**: offer → download → success; the **skip** path completing Onboarding
  (INV-3); the failure path still advancing (INV-3).
- **acceptance** (one per invariant): INV-1 must be proven by a test that would
  FAIL if a credential were required — e.g. a fixture that rejects any request
  carrying an `Authorization` header.

Mock only the external boundary; do not hit the real HF in tests.

## Open questions

1. Re-install / second machine — re-download, or detect an existing copy?
2. **Hardware.** A 9B at Q4_K_M needs ~8 GB free RAM. Should the step detect
   available memory and warn, or offer a smaller quant (`Q3_K_M`, 4.67 GB)?

None of these block implementation.

## Out of scope

Bundling weights in the installer · a model catalogue UI · automatic model
updates · GPU selection · migrating existing users.
