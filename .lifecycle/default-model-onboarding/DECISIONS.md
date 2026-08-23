# DECISIONS — default-model-onboarding

Every human/product input the implementation needs, resolved UP FRONT. Nothing is left open.

Only DEC-6 was escalated to the owner as a product choice (it changes WHAT gets built);
everything else is resolved by codebase convention or by the design doc, per rule B8/B5
(implementation approach is worked out and executed, never escalated).

---

### DEC-1: The seed row cannot use `https://huggingface.co` — `llm_repositories` has `UNIQUE (url)` and the credentialed built-in row already holds it. What URL does the anonymous row use?

**Resolution:** `https://huggingface.co/unsloth` — an ORG-SCOPED Hugging Face base. The
model's `repository_path` becomes `Qwen3.5-9B-GGUF` (not `unsloth/Qwen3.5-9B-GGUF`), which
`GitService::build_repository_url` composes back into
`https://huggingface.co/unsloth/Qwen3.5-9B-GGUF`. No schema change and no dropping of the
unique constraint.
**Basis:** codebase — `llm_repository/utils.rs:384-404` documents org-scoped HF bases as
legitimate *by name* ("a row at `https://huggingface.co/<org>` plus a repository_path of
`<model>` builds `huggingface.co/<org>/<model>`, which is a real model URL — and two
pre-existing tests rely on it") and returns `RepositoryKind::HuggingFace => true`
unconditionally from `is_usable_repository_base`. `utils/git/service.rs:691-706` trims the
trailing slash and takes the no-`.git` huggingface branch. TEST-3 proves the composition.

Rejected alternatives: (a) dropping `UNIQUE (url)` — a schema loosening with far wider
blast radius than the problem; (b) flipping the existing `Hugging Face Hub` row to
`auth_type='none'` — that would destroy every deployment's ability to store an HF token and
silently change hub-download behaviour; (c) a trailing-slash `https://huggingface.co/` twin
— satisfies the constraint only cosmetically and produces two identically-named-looking
rows in the admin list.

### DEC-2: Where in the wizard does the step go?

**Resolution:** immediately after `api-keys`, before `mcp-servers` / `memory-setup` /
`finish`. Step id `default-model`, title `Local Model`.
**Basis:** the design doc — "a new entry in `guides/getting-started/module.tsx`'s `steps`
array, after `api-keys` (a user who added a key can skip) and before `finish`". The
parenthetical fixes the intent: a user who has just supplied a key should meet the offer
immediately and be able to skip it, so it sits adjacent to `api-keys` rather than merely
somewhere before `finish`.

### DEC-3: Re-install / second machine — re-download, or detect an existing copy? (design doc open question 1)

**Resolution:** DETECT. The descriptor carries a STABLE model `name`; when a model with
that name already exists under the local provider the step renders **already-installed**
and offers no download. A second machine has its own database and therefore its own copy —
there is no cross-machine sharing, and none is introduced.
**Basis:** convention + codebase. `ModelHubCard` derives its "Downloaded" state from
`model.created_ids` rather than re-downloading, and the server already refuses a duplicate
in-flight transfer (`find_existing_in_progress`, `uploads.rs:963-976`) and enforces
`UNIQUE (provider_id, name)` on `llm_models` (`llm_model/migrations/202607140160…:73`). A
stable name makes the detection exact instead of heuristic, and makes an accidental
double-install impossible at the DB level rather than only in the UI. (Note this is a
deliberate departure from `AddLocalLlmModelDownloadDrawer`'s `generateModelId`, which
appends a timestamp — that surface wants a NEW model per submission; this one wants
exactly one.)

### DEC-4: Hardware — a 9B at Q4_K_M needs ~8 GB free RAM. Detect and warn, offer the smaller `Q3_K_M` (4.67 GB), or neither? (design doc open question 2)

**Resolution:** WARN, do not gate, and do NOT offer a second quant. When a host memory
figure is available and below the model's working set, the step renders a non-blocking
advisory alongside the offer; the Install button stays enabled and Next stays unblocked.
When no figure is available, nothing is rendered.
**Basis:** convention + INV-3. Gating is forbidden outright — INV-3 makes the download
offerable, never mandatory, and by the same logic the step must not decide on the user's
behalf that their machine is unsuitable (a swap-backed or about-to-be-freed machine is the
user's call). Warning matches how the codebase treats unconfirmable conditions elsewhere: a
repository whose capability cannot be confirmed is reported `unverified` with a warning
Alert and explicitly NEVER auto-disabled (`llm_repository/models.rs:159-167`, "an
unconfirmable host must never auto-disable a working self-hosted deployment"). Offering a
second quant was rejected on proportionality: it multiplies the state matrix (a quant
picker, a second descriptor, a second already-installed predicate, per-quant e2e) inside a
first-run wizard whose job is one confident default — and the design doc names exactly one
model. A user who wants `Q3_K_M` has the full LLM Providers download drawer.

### DEC-5: A fresh install's built-in `Local` provider is `enabled = false`, so there is nothing to download into. Enable it in the migration, or at install time?

**Resolution:** at INSTALL time, through the existing `PUT /llm-providers/{id}` path, and
only when a `provider_type = 'local'` provider is not already enabled. Not a migration flip.
**Basis:** least blast radius. `list_local_providers` filters `WHERE provider_type='local'
AND enabled = true` (`llm_provider/repositories/admin.rs:184-193`), so the provider must be
enabled for the download to have a target. A migration flip would enable it for every
EXISTING deployment on upgrade — surfacing an empty local provider in every user's model
picker for a feature they never asked for. Doing it at install time makes the change
user-initiated, reversible from the existing providers page, and invisible to anyone who
skips the step (INV-3).

### DEC-6: A fresh install has NO local runtime engine, so the downloaded GGUF cannot be served. Does the step stop at the model, or also provision a llama.cpp runtime?

**Resolution:** ALSO PROVISION THE RUNTIME. The step installs a llama.cpp runtime version
first (discovery → download → mark system default), then the model. Its progress is a
distinct visible stage, not merged into the model's bar.
**Basis:** **user** — escalated as an explicit option picker before implementation and
answered "Model + engine (fulfil 'talk to it')". The gap is real and was verified, not
assumed: no migration inserts into `llm_runtime_versions`, and
`BinaryManager::select_runtime_version` (`llm_local_runtime/binary_manager.rs:491-561`)
walks model → provider → system-default → latest and returns `None` with **no auto-fetch**,
so without this leg the design's own goal sentence — "finish Onboarding, have a model,
**talk to it**" — and INV-2's "a **working** model" would both be false while every gate
stayed green. This goes BEYOND the design doc's enumerated *What gets built*, so ITEM-14
amends that doc; the `## Invariants` section is untouched.

### DEC-7: Operational tunables — fixed constants or an admin-configurable settings row?

**Resolution:** FIXED CONSTANTS, in one descriptor module (ITEM-2). The tunables this
feature introduces are: which model (`unsloth/Qwen3.5-9B-GGUF`), which quant file
(`Qwen3.5-9B-Q4_K_M.gguf`), which engine (`llamacpp`), and the memory-advisory threshold.
None becomes a `*_settings` table, a REST GET/PUT, a permission, or a sync entity. They are
structured as named exported constants (not inline magic numbers) so any of them can be
promoted to a settings row later without a rewrite.
**Basis:** convention, with an explicit rationale as the configurable-settings rule
requires. These are not operational limits an operator tunes against their environment
(the class the rule exists for — memory/CPU/timeout caps, retention, quotas, concurrency);
they are the PRODUCT's identity choice of a default, versioned with the binary, exactly like
`SEED_HUB_VERSION` and `BIOMCP_VERSION`. And an admin who wants a different model already
has a complete, permission-gated surface for it — the LLM Repositories page plus the
"Download from Repository" drawer — so a settings row would duplicate an existing capability
rather than add one. The memory threshold is advisory-only (DEC-4) and changes no behaviour,
so making it configurable would expose a knob that does nothing.

### DEC-8: What does the step do when the runtime discovery endpoint is reachable but returns nothing (air-gapped / upstream down)?

**Resolution:** render the **offline** state — "a local runtime couldn't be reached" with
the model install still offered where possible, and Next still unblocked. Never surface an
empty list as "no versions exist", and never silently proceed to a model download that
cannot be served without saying so.
**Basis:** codebase — `list_available_versions` answers **200 even when upstream is
unreachable** and puts the truth in `source` / `unavailable_reason`
(`runtime_version/handlers.rs:676-728`), whose own doc-comment states the intent: "so an
empty list is never mistaken for 'no versions exist'". Honouring that contract is the
handler author's stated requirement, not a judgement call.

### DEC-9: Which surface owns transfer state?

**Resolution:** NEITHER the step nor its store. Both legs are derived at render time from
the live `LlmModelDownload.downloads` and `RuntimeDownloadProgress.activeByKey` stores. The
step registers no cleanup that cancels a transfer, and it re-derives on every mount.
**Basis:** INV-6 + codebase. The transfers already run server-side, `LlmModelDownload`'s
store `init` calls `initializeDownloadTracking()` and `RuntimeDownloadProgress.loadActive()`
re-subscribes to in-flight engine downloads — so a step that owned its own copy would be
strictly worse than doing nothing. This also pre-empts the stale-snapshot defect class the
lifecycle skill calls out (state captured at mount and consulted later).

### DEC-10: Does the step need its own gallery entry for its new conditional states?

**Resolution:** No bespoke gallery entry. Regenerate `stateMatrix.generated.ts` and map each
new required-state key in `stateCoverage.ts` with the same `skip: true` / "via surface —
rendered within its page; branch proven by Part 2 runtime coverage" reason its sibling
already uses.
**Basis:** codebase — `MemorySetupStep:{delayed,empty,error}` are mapped exactly that way
(`src/dev/gallery/stateCoverage.ts:340-342`), and the onboarding module declares
`gallery.tsx` as `{ crawlOnly: true }`, the documented ownership marker for a module whose
surfaces are proven by the crawl rather than by a seeded cassette
(`GALLERY_SEED_EXCEPTIONS.md`). Inventing a cassette for this one step would diverge from
its sibling for no gain.

### DEC-11: How do the tests stand in for Hugging Face without hitting it?

**Resolution:** ONE loopback git-over-HTTP fixture, serving a tiny bare repository whose
single weight file carries the descriptor's filename, and which **401s any request bearing
an `Authorization` header**. It is used by the RUST INTEGRATION legs only, which create
their own repository row pointing at it — no production code and no debug seam are needed
for that. The runtime leg reuses the EXISTING `MockReleaseServer`
(`tests/llm_local_runtime/mock_release.rs`) with the existing debug-only
`LLM_RUNTIME_RELEASE_MIRROR` / `LLM_RUNTIME_API_MIRROR` seams. The browser tier does not
download at all — see DEC-13.
**Basis:** the design doc's test strategy ("Mock only the external boundary; do not hit the
real HF in tests") plus the task brief's stronger requirement that INV-1 be proven by a test
that would FAIL if a credential were required. Because the integration tier supplies its own
repository row, **no new production seam is introduced** — a debug `cfg!(debug_assertions)`
override of the clone base was considered and rejected as release-compiled surface area
buying nothing. The fixture lives in this feature's own test module; `tests/common/*`, the
gallery cassette and the Playwright config/harness are NOT touched (rule B3).

### DEC-12: The step's controls are permission-gated. What does a user without the permission see?

**Resolution:** an informational panel explaining that an administrator installs the local
model, with no Install / Cancel / Retry controls — and the wizard remains fully navigable
for them.
**Basis:** codebase — `MemorySetupStep` does exactly this for `MemoryAdminManage`, rendering
a "Your administrator controls whether this is enabled" panel instead of the controls. No
NEW permission is introduced; the existing `llm_models::create` / `llm_providers::edit` /
runtime-version permissions are reused, so this is a rendering decision, not an authz change.

### DEC-13: At which tier is each invariant proven — can the browser tier drive the real install?

**Resolution:** NO — the browser tier does not drive the real install. Tiers are assigned by
what each can honestly prove:
- **integration (Rust)** proves the install legs for real — anonymous clone (INV-1), cancel
  leaving nothing behind (INV-4), the working-model sequence (INV-2's substance), and
  client-independent continuation (INV-6) — against a loopback fixture and the existing
  `MockReleaseServer`.
- **component (`*.test.tsx`, vitest + jsdom)** proves the step's hard-to-reach rendered
  states by MOUNTING it: `downloading` / `failed` / `already-installed` / unpermitted, and
  that unmount issues no cancel.
- **e2e** proves what only a browser can: the step is genuinely inside the wizard right
  after AI Providers (INV-2's location half), skipping completes Onboarding (INV-3), a
  restricted user sees no controls with a positive control, and 390px is clean.

**Basis:** convention + a hard constraint. Driving the real 5.68 GB install from Playwright
needs one of two things, and BOTH are ruled out. (a) A live Hugging Face fetch — forbidden
by the design's own test strategy ("Mock only the external boundary; do not hit the real HF
in tests") and non-deterministic besides. (b) Pointing the seeded row at a loopback fixture
— impossible from the UI, because `llm_repository/handlers.rs:225-251` makes a `built_in`
row's `url` / `auth_type` / `name` IMMUTABLE by design (a deliberate security fix: "any
holder of llm_repositories::edit could swap the Hugging Face URL to an attacker-controlled
domain"), and impossible from the harness, because the per-test server spawn in
`tests/fixtures/test-context.ts` takes no per-test env and editing it to add one is
precisely the shared-harness workaround rule B3 forbids. A new production debug seam was
considered and rejected: the integration tier can point its OWN repository row at the
fixture with no production code at all, so a seam would add release-compiled surface area to
buy nothing. The component harness is the established local answer for render states a
browser run can't reach cheaply — `llm-local-runtime/components/AvailableVersionsCard.test.tsx`
is the sibling precedent, and CLAUDE.md records that this harness replaced twenty rounds of
source-scanning guards in the activity-rail work.

### DEC-14: The clone path refuses loopback unconditionally. Relax it for tests, or prove INV-1 somewhere else?

**Resolution:** PROVE IT ELSEWHERE. `LlmRepository::git_credential` is extracted
(ITEM-15) and asserted directly: an anonymous repository yields `(None, None)`
over every input, including a row still carrying api_key / token / username /
password. The loopback git fixture written for the original plan was deleted.
`GitService::clone_repository` is left exactly as it was.
**Basis:** convention — and a refusal to weaken a security check for testability.
`clone_repository` validates against `PUBLIC_HTTP_OR_HTTPS` with **no**
`cfg(debug_assertions)` relaxation, unlike the five sibling paths that do have one
(`repo_files.rs`, `llm_provider/discover.rs`, `web_search/{fetch,brave}`,
`citations/resolve.rs`). That asymmetry is deliberate and documented in the code:
it is the defense-in-depth check at the git entry point, closing a Critical SSRF
finding, explicitly so that "any future caller path bypassing the repository
module is also covered". Adding a debug relaxation there would be defensible by
precedent, but it would hand every debug build the ability to clone from
loopback — a change to shared security posture, made to serve one feature's test.

The replacement is not a concession; it is stronger. A fixture proves only that
no credential went out on the paths one clone happened to take. Asserting at the
decision point covers every auth_type and every `auth_config` shape, and it goes
RED under mutation — verified by flipping the anonymous arm to leak `api_key` and
observing the failure, then reverting.

**Residual gap, stated plainly:** no automated test drives a real anonymous clone
end to end. Nothing can, without either weakening the SSRF check or contacting
Hugging Face for real, and the design forbids the latter ("do not hit the real HF
in tests"). What IS proven: the seeded row's shape (TEST-1), that an anonymous row
produces no credential (TEST-4), that the URL composition is right (TEST-3), and
that the download lifecycle behaves around failure (TEST-5/TEST-7). A human
smoke-test against real Hugging Face is the honest way to close the remainder,
and it is flagged for the reviewer rather than papered over.

### DEC-15: A 5.68 GB download against a 30-minute absolute LFS timeout requires ~3.2 MB/s. Raise the timeout, shrink the model, or accept it?

**Resolution:** ACCEPT IT for now, and escalate. Nothing in this branch changes
the timeout or the model. The arithmetic is recorded in the design doc and
surfaced to the owner in `HUMAN_FEEDBACK.md`.
**Basis:** the two fixes available to me are both worse than the report.
`utils/git/lfs/service.rs` builds its client with
`.timeout(Duration::from_secs(60 * 30))`, which reqwest applies to the WHOLE
request including the streamed body — so 5.68 GB needs a sustained
5.68 GiB / 1800 s ≈ **3.2 MB/s (~25 Mbps)** or the install always fails. Raising
it would weaken a bound in shared code that exists as a security fix (it closed
07-llm-model F-07, replacing reqwest's unbounded default), for every caller, to
serve one feature. Shrinking to `Q3_K_M` (4.67 GB) only moves the floor to
~2.6 MB/s — it does not solve the class. And "what connection speed does the
first-run default require?" is a product question about who the product is for,
which is the owner's call, not mine (B8/B5).

What this is NOT: a defect introduced by this branch. It is a pre-existing bound
that this feature is the first to depend on, which is exactly why it surfaced
here. The honest options for the owner are (a) accept a ~25 Mbps floor, (b) raise
the LFS timeout deliberately, as its own reviewed change, or (c) add resume /
chunking so the bound stops mattering.

### DEC-16: The design lists seven step states as "needing gallery coverage". The change proves them by mounting instead. Is that a deviation?

**Resolution:** YES, deliberately, and it is recorded rather than glossed. The
new required-state keys are mapped `skip: true` in `stateCoverage.ts` with the
sibling's reason, and the states are proven by mounting the real component in
`DefaultModelStep.test.tsx`.
**Basis:** codebase — the onboarding module declares `gallery.tsx` as
`{ crawlOnly: true }`, the documented marker for a module whose surfaces are
proven by the crawl rather than a seeded cassette, and every sibling step
(`ApiKeysStep`, `MemorySetupStep`) maps its states exactly this way. Building a
bespoke cassette for one step would diverge from every other Onboarding surface
for one feature's benefit.

The honest cost, stated: the `downloading` / `failed` / `already-installed` /
unpermitted renders are therefore NOT seen by `gate:ui`'s runtime-health,
AA-contrast or visual-regression pass — only the states the crawl reaches are.
The mount proves behaviour, not pixels. Flagged to the owner as the one place
the shipped approach differs from the design's wording; converting the module to
a seeded cassette is a coherent follow-up, but it is an Onboarding-wide change,
not this feature's to make unilaterally.
