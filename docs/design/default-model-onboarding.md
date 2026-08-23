# Design — a default local model, installable from Onboarding with no API key

**Status:** draft for review
**Author:** khoi
**Scope:** ziee desktop (and server; the mechanism is not desktop-specific)

## 1. Problem

A new user finishing Onboarding today has **no working model** unless they bring
their own API key or configure a provider by hand. The two seeded repositories
(`Hugging Face Hub`, GitHub) are both credentialed. That makes first-run value
conditional on the user already having an account somewhere.

We want the opposite: **finish Onboarding, have a model, talk to it.** No key, no
settings page, no account.

## 2. Goals

- A curated default model a user can install **from the Onboarding flow** in one
  action.
- **No credential of any kind** — not an API key, not a login, not a token.
- The model becomes the **default for new conversations** once installed.
- Serving it costs us bandwidth we control, not a third party's quota.

## 3. Non-goals

- Bundling model weights into the installer. A 9B GGUF is ~5-6 GB; the current
  `.dmg` is ~325 MB and must stay downloadable.
- Replacing Hugging Face. The HF row stays; this is an *additional* source.
- Curating a catalogue. Exactly one model to begin with.
- Offline/air-gapped first-run. Installing the model requires network.

## 4. Invariants

These are the non-negotiables. Any implementation that violates one is wrong,
regardless of whether tests pass.

- **INV-1**: Installing the default model requires **no credential** — no API
  key, no token, no login — at any point in the flow.
- **INV-2**: The user reaches a working model **without leaving Onboarding** and
  without visiting a settings page.
- **INV-3**: Onboarding is **completable without installing the model**. The
  download is offerable, never mandatory, and skipping leaves the app in a valid
  state.
- **INV-4**: A failed, cancelled, or interrupted download **never leaves a
  half-installed model** that the app will try to load.
- **INV-5**: The model is served from **infrastructure we operate**, so no
  third-party bandwidth quota can break first-run for every user at once.
- **INV-6**: The default-model row is **built-in and enabled by default**, so a
  fresh install has it without an admin action.

## 5. Key finding — the download machinery already exists

This was researched before designing, and it substantially shrinks the work.

`GitService::build_repository_url` already falls through to the plain-git
convention for any unrecognised host:

```rust
_ => format!("{}/{}.git", base_url, repository_path)
```

and `is_usable_repository_base(RepositoryKind::Unknown, _) => true`. The model
download path (`llm_model/handlers/uploads.rs`) performs a real
`GitService::clone_repository` with **Git LFS** support, and the LFS client's
`url_with_auth(url, access_token: Option<&str>)` accepts `None` — anonymous is a
supported path, not an accident.

`auth_type: "none"` is already a first-class value:
`RepositoryAuthConfig::has_credential_for("none") => true`.

The REST surface is likewise already there:

| endpoint | purpose |
|---|---|
| `POST /llm-models/download` | start a download |
| `GET /llm-models/downloads` | list in-flight downloads |
| `GET /llm-models/downloads/subscribe` | **SSE progress** |
| `POST /llm-models/downloads/{id}/cancel` | cancel |
| `DELETE /llm-models/downloads/{id}` | remove |

**Consequence: no new download, progress, or LFS code is required.** The work is
a seed row, an Onboarding step, and the default-model semantics in §5.6.

### 5.1 Hosting

A **self-hosted git server** with LFS, operated by us (INV-5). Gitea is the
lightest option that satisfies the three requirements; GitLab CE also works.

The server MUST:

1. serve `https://<host>/<org>/<repo>.git` over **HTTPS** (a valid cert — the
   clone path does not disable verification, and must not be made to),
2. support **Git LFS**, since GGUF blobs are LFS-tracked,
3. permit **anonymous, unauthenticated clone + LFS fetch** (INV-1).

> **Rejected: GitHub with Git LFS.** Free-tier LFS is 1 GB storage / 1 GB
> bandwidth per month against a ~5-6 GB artifact. The first user download
> exhausts the monthly quota and subsequent downloads simply fail. This breaks
> INV-5 outright.
>
> **Rejected for now: GitHub Releases.** No bandwidth cap on public repos, but
> release assets are not git-clonable, so the existing clone path cannot reach
> them without new code.
>
> **Noted alternative: `ziee-ai/hub`.** Already the curated-model mechanism,
> already keyless and cosign-verified. Rejected here only because the intent is
> for this to be *our* infrastructure, independent of `ziee-ai`.

### 5.2 The seeded repository row

A new migration mirrors `202607145040_llm_repository_seed.sql`:

- `name`: the operator-facing label
- `url`: the git server origin
- `auth_type`: `'none'`
- `auth_config`: `{}` — no secret fields
- `enabled`: `true`, `built_in`: `true` (INV-6)
- deterministic UUID, so re-running is idempotent

The migration prefix must sort above the current **server** max
(`202607200600`) — not above the desktop `1e13` block. The two sequences are
independent.

### 5.3 Repository kind and the health badge

`repository_kind()` matches only `huggingface.co` and `github.com`; our host
classifies as `Unknown`, which is probed for a Hugging-Face-compatible
`{origin}/api/models?limit=1`. Gitea/GitLab do not serve that, so the row will
report **`unverified`**.

That is **not** a failure: `unverified` means "reachable, capability not
confirmed", it renders as a warning rather than an error, and the code
deliberately never auto-disables on it. Downloads still work.

**Decision required (DEC).** Either:

- **(a)** accept the `unverified` badge for now, or
- **(b)** add a repository kind whose capability probe is
  `{origin}/info/refs?service=git-upload-pack` — the git protocol handshake,
  which *every* git host answers. This is the honest probe for a git-backed
  repository and would also improve the `Unknown` case generally.

(b) is a small, well-scoped change and is preferred, but it is a behavioural
change to health probing and should be its own reviewed item.

### 5.4 The Onboarding step

A new step in `guides/getting-started/module.tsx`'s `steps` array, placed
**after `api-keys`** (a user who already added a provider key can skip it) and
**before `finish`**.

The step uses the existing `OnboardingStepProps` / `registerBeforeNext`
contract, and drives the existing download endpoints with SSE progress.

States the step must render — each needs gallery coverage:

| state | behaviour |
|---|---|
| offer | model name, size, one-line explanation, Install and Skip |
| downloading | live % from the SSE stream, bytes, cancel affordance |
| success | confirmation; the model is now selectable |
| failed | the reason, a retry, and a skip that still advances (INV-3) |
| cancelled | back to offer; **no partial artifact left** (INV-4) |
| already installed | recognises the model is present; no re-download |
| offline / server unreachable | explains, offers skip (INV-3) |

**A ~5-6 GB download inside a wizard is the main UX risk.** The step must not
block Onboarding on completion: the user can advance while it continues, or skip
entirely. Whether the download survives leaving the step is an open question
(§7).

### 5.5 Security

- Anonymous clone means **no secret is stored**, which removes a class of risk
  rather than adding one.
- The row is `built_in`, so it inherits existing built-in-row edit protections.
- HTTPS with a valid certificate is required (§5.1); do not add a
  verification-skip path for a self-signed cert.
- SSRF: the URL is operator-seeded, not user-supplied, so the untrusted-URL path
  does not apply — but the row remains editable by an admin, and the existing
  `validate_url` guard still governs that.

### 5.6 "Default model" — the genuinely new part

**There is no global or per-user default model today.** `default_model_id`
exists **only on `projects`** (`project/types.rs:31`). A conversation created
outside a project has no default to inherit.

So INV's "becomes the default for new conversations" requires new semantics.
Options, in increasing order of cost:

- **(a) Onboarding-only**: after install, set it as the default on nothing —
  simply leave the user with an installed, selectable model. Cheapest; arguably
  fails the spirit of the goal.
- **(b) A user-level default**: a `default_model_id` on user settings, consulted
  when creating a conversation with no explicit model. Mirrors the existing
  project-level field and its `DEFAULT_MODEL_NOT_FOUND` validation.
- **(c) A deployment-level default**: an admin singleton setting, mirroring
  `session_settings` / `memory_admin_settings`.

**(b) is recommended** — it matches the existing project precedent closely, and
per the lifecycle's configurable-settings rule a new tunable should follow the
established settings pattern rather than becoming a hardcoded constant.

This is the largest unknown in the design and should be settled before
implementation begins.

## 6. Test strategy (sketch — enumerated properly at lifecycle phase 3)

- **unit**: seed-row shape; `repository_kind`/probe-URL for the new host (if
  §5.3(b) is taken); the "already installed" predicate.
- **integration**: the seeded row exists, is `built_in` + `enabled`, and has
  `auth_type='none'`; a download against a **local git+LFS fixture** succeeds
  with no credential; cancel leaves no partial artifact (INV-4).
- **e2e**: the Onboarding step's offer → download → success path; the **skip**
  path completing Onboarding (INV-3); the failure path advancing (INV-3).
- **acceptance** (one per invariant, per the lifecycle): notably INV-1 must be
  proven by a test that would FAIL if a credential were required — e.g. a
  fixture server that rejects any request carrying an `Authorization` header.

A local git+LFS fixture is strongly preferred over hitting the real server in
tests; mock only the external boundary.

## 7. Open questions

1. **Exact model id + quantisation.** "Qwen3.5-9B" needs a precise repo path and
   quant (`Q4_K_M`, `Q5_K_M`, …). The seed row hardcodes it, and the file size
   drives the §5.4 UX. **Unresolved — required before implementation.**
2. **Where does the git server run**, and who operates it? TLS, DNS, backups,
   and disk for a multi-GB LFS store.
3. **§5.3**: accept `unverified`, or add the git-handshake probe?
4. **§5.6**: which default-model semantics?
5. Does a download **survive** navigating away from the Onboarding step, or is
   it bound to it?
6. What happens on a **second** machine / re-install — is the model re-downloaded?
7. Hardware guidance: a 9B model is not viable on every machine. Should the step
   detect available RAM/VRAM and warn, or offer a smaller quant?

## 8. Out of scope

- Multiple curated models, or a catalogue UI.
- Automatic model updates.
- GPU/accelerator selection.
- Migrating existing users — this targets first-run.
