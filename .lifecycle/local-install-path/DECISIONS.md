# DECISIONS — local-model / local-runtime install path

Every decision the implementation needs is resolved below, up front.

---

### DEC-1: Where does the discovery endpoint live, and does a literal segment survive next to `{version_id}`?
**Resolution:** `GET /api/local-runtime/versions/available`, with an optional `?engine=` filter. Registered in the same router list as the existing routes, alongside — not replacing — `/local-runtime/versions/{version_id}`.
**Basis:** codebase — `/local-runtime/versions/downloads` (`llm_local_runtime/routes.rs:92`) already coexists with `/local-runtime/versions/{version_id}` (`:80`) in this exact router, and its tests exercise it (`tests/llm_local_runtime/test_helpers.rs:127`), so axum/matchit's static-over-parameter precedence is proven in-tree rather than assumed. `available` is also the noun the reporting caller actually reached for; adopting it turns the observed `Cannot parse version_id with value 'available'` 400 into the answer.

---

### DEC-2: Caching — where, what shape, and what TTL?
**Resolution:** A process-lifetime `once_cell::sync::Lazy<RwLock<HashMap<EngineType, CachedCatalog>>>` in a new `llm_local_runtime/engine/release_cache.rs`, holding `{releases, fetched_at}` per engine. Reads inside TTL are served from memory with no upstream call. **A failed refresh never evicts** — the prior entry is retained and served, flagged stale, with the failure reason attached.
**Basis:** convention — `server_update/checker.rs:20` is the in-repo precedent for exactly this (a `Lazy<RwLock<…>>` process cache over a GitHub release check, with a `checked_at` surfaced to the UI and soft-fail semantics that leave the cache intact). Deliberately NOT `code_sandbox::version_manager::status()` (`:1131-1137`), which collapses a GitHub failure to `Vec::new()` — that is the "reads as no versions exist" behaviour INV-2 forbids, and it is the same flaw in a sibling module rather than a pattern to copy.

**Reasoning for the retain-on-failure rule specifically:** the reported symptom is a rig that installed nothing across days. A cache that evicts on failure would still show an empty list every time the GitHub budget is exhausted, so it would fix the request volume without fixing the observed outcome. Retention is the part that makes the surface usable on a rate-limited box.

---

### DEC-3: Is the cache TTL a fixed constant or an admin setting?
**Resolution:** Admin-configurable — `llm_runtime_settings.engine_release_cache_ttl_secs`, default `3600` (1 hour), bounded `60..=86400` by a CHECK constraint and re-validated in the handler.
**Basis:** convention — the lifecycle's configurable-settings rule defaults operational tunables to admin-configurable, and the singleton + bounded-CHECK pattern already exists on this very row (`idle_unload_secs`, `auto_start_timeout_secs`, `drain_timeout_secs` in `llm_local_runtime/migrations/202607140155_llm_local_runtime_schema.sql:25-36`). One hour is chosen because engine releases are cut rarely (three releases exist on `ziee-ai/llama.cpp` in total), so an hour of staleness costs nothing while reducing a page-load-per-call surface to at most 24 calls/day/engine — two orders of magnitude inside the unauthenticated budget even without a token.

---

### DEC-4: `GITHUB_TOKEN` — honour it at runtime?
**Resolution:** Yes. `github_get_with_retry` (`engine/download.rs:413`, the single chokepoint for both `list_releases` and `get_latest_version`) attaches `Authorization: Bearer <token>` when `GITHUB_TOKEN` is set in the process environment, and nothing otherwise. The value is never logged, never placed in an error string, and never serialized onto a response.
**Basis:** convention — `build_helper/hub_seed.rs` already honours `GITHUB_TOKEN` for precisely this rate-limit reason at build time, and CLAUDE.md documents it as the mechanism that lifts 60/hr to 5000/hr. The runtime path simply never adopted it. Combined with DEC-3's cache the token is a second-order defence, not the primary fix — which is the right ordering, because an operator who cannot set a token still gets a working surface.

---

### DEC-5: What happens when GitHub is unreachable or rate-limited?
**Resolution:** The endpoint returns **200** carrying an explicit vocabulary — `source` ∈ `live | cache | unavailable`, `checked_at`, and `unavailable_reason` — instead of the current 500. `unavailable` means "we have nothing to show and here is why"; `cache` with a non-null `unavailable_reason` means "this list is real but we could not refresh it just now".
**Basis:** user requirement, resolved against convention — the brief requires an air-gapped or rate-limited box to "degrade to something honest, not a blank list that reads as 'no versions exist'". A 500 fails that twice: it discards a perfectly good cached catalogue, and it renders in the UI as a generic error indistinguishable from a bug. A 200 with a stated reason is strictly more informative to both a human and an API caller, and it is what lets ITEM-8's card say *why* the list is short. Verified non-breaking: the only existing assertion on this endpoint (`tests/llm_local_runtime/engine_download_test.rs:130`) covers the success path.

**Rejected alternative:** 503 with a `Retry-After`. It is more RESTfully "correct" for a transient upstream failure, but it cannot carry the cached catalogue as a normal body, which is the whole point — the caller needs the versions, not the failure.

---

### DEC-6: Surface only host-matching variants, or every published variant?
**Resolution:** Every published variant, as an explicit `variants: [{platform, arch, backend, size_bytes}]` list per release — **plus** the existing host-scoped convenience fields (`binary_ready`, `available_backends`, `recommended_backend`, `size_bytes`) which keep their current host-only meaning.
**Basis:** the defect itself. `POST /versions/download` requires all five of `{engine, version, platform, arch, backend}`, so an API whose discovery response omits four of them has not actually closed the gap it exists to close — the caller would still be guessing `platform`/`arch`/`backend`. Host-filtering is a *presentation* default, not a data model: the UI keeps defaulting to the host-matching recommended backend (so the common path is unchanged and no extra choice is imposed on an operator), while the API states the full truth. It also serves the real cross-host case — an admin on one host administering a deployment on another, and the desktop/server split — without a second endpoint.

**Cost accepted:** the response is larger (the `ziee-ai/llama.cpp` fork publishes 9 assets across 3 releases, so tens of rows, not thousands). Bounded by the number of published releases, and cached.

---

### DEC-7: Does the existing `check-updates` endpoint stay?
**Resolution:** Yes, unchanged in path and in every field it already returns; it is re-implemented on the shared cached core so it gains `source`/`checked_at` and stops issuing an upstream call per page mount.
**Basis:** convention — the UI's `AvailableVersionsCard` and its store already depend on it, and breaking a working caller to make a point about naming would be gratuitous. The discoverability fix is *adding* the noun, not removing the verb.

---

### DEC-8: How is the download-path 404 made actionable?
**Resolution:** The "engine binary not published for `<tag>`" error gains a clause naming the discovery endpoint (`GET /api/local-runtime/versions/available`). The message stays accurate about what failed; it just stops being a dead end.
**Basis:** the reported experience — the caller's first attempt used an upstream `ggml-org/llama.cpp` tag and the resulting error was, in their words, "accurate but useless without a list of valid versions". Pointing at the list is the minimum that converts it into a recoverable error.

---

### DEC-9: On completion, what exactly does `progress_data` become — and is it fixed at the repository or the UI?
**Resolution:** At the **repository**, inside the existing terminal `Completed` UPDATE (`llm_model/repository.rs:896-924`), in the same statement — `phase: complete`, `current = total`, `total` preserved from the stored row (falling back to 100 when the stored total was 0 or absent), message set to a completion message.
**Basis:** convention — §15/"fix the cause, not the reachable layer". Four independent frontend sites compute `current/total` (`DownloadProgress.tsx:17`, `DownloadItem.tsx:212`, `ModelHubCard.tsx:582`, `AddLocalLlmModelDownloadDrawer.tsx:426`) and the SSE frame (`handlers/downloads.rs:64-86`) derives from the same stored row; patching them individually is four places to forget and does nothing for a fifth caller such as the hub download wrapper (`hub/handlers.rs:1681`). One write at the chokepoint fixes every surface at once. Doing it in the same UPDATE (rather than a read-modify-write) keeps it atomic and preserves `total` without a second round trip.

---

### DEC-10: What about a FAILED or CANCELLED download's progress?
**Resolution:** Left frozen where it stopped. Not fabricated to 100%, and its phase not rewritten.
**Basis:** honesty about what happened — a download that died during `committing` at 90% genuinely got to 90%, and that is the useful thing to show. The invariant being fixed (INV-3) is that progress must not CONTRADICT status; a failed download reading 90% does not contradict `failed`, whereas a completed one reading 90% contradicts `completed`. TEST-14 pins this explicitly so a later "make it consistent" refactor cannot quietly start reporting failures as complete.

---

### DEC-11: What is a meaningful repository health check?
**Resolution:** A **capability** assertion, not a reachability one. Derive the repository kind from its host (the same host-suffix predicate the download path already uses), request that kind's model-listing surface, and require the response to parse into the shape a model listing has. A bare `200` from an arbitrary web server never passes.
**Basis:** the brief's own criterion ("does it resolve as a model repository? can it list files?") plus the codebase's own answer to "what does a repository get used FOR": `llm_model/handlers/repo_files.rs:124-143` already derives `RepositorySource::{HuggingFace, Github, Unknown}` by host and calls `fetch_hf_files` / `fetch_github_files` against the kind's listing API. That is the capability a repository must have, and it is already implemented — the health check simply never asked about it.

**Partially-disproved sub-finding, recorded rather than forced:** the probe's shallowness is *documented*. `utils.rs:296-308` states that it validates REST-API reachability/credentials and NOT the git-clone path the real download uses. That stated reason genuinely justifies not exercising a git clone (which needs a model path the repository row does not have). It does **not** justify the word `healthy` for "a socket answered 200" — the defect is the outcome vocabulary, not the decision to skip the clone. So the clone is still not probed, and the check is still endpoint-based; what changes is that `healthy` now requires positive evidence.

---

### DEC-12: A host we cannot classify — `healthy`, `unhealthy`, or something else?
**Resolution:** A third outcome, `unverified`, added to `last_health_check_status` (migration widening the CHECK constraint from `untested|healthy|unhealthy`). An `unverified` result **does not** auto-disable the repository.
**Basis:** required by INV-4's second clause, and forced by an existing behaviour: `connection_health::record_test_outcome` (`:389-437`) auto-disables an enabled repository whose probe fails. Folding "we could not classify this host" into `unhealthy` would therefore **disable working self-hosted deployments** the moment this change shipped — converting a cosmetic-badge defect into an outage. Folding it into `healthy` would preserve exactly the lie the brief objects to ("converts unverified into verified"). Neither neighbour is safe, so the third state is not gold-plating; it is the only outcome that is both honest and non-destructive.

---

### DEC-13: Is `unverified` a new *permission* or otherwise gated?
**Resolution:** No new permission anywhere in this branch. Discovery reuses `RuntimeVersionRead`, the settings PUT reuses the existing runtime-settings permission, and the probe reuses `LlmRepositoriesEdit`.
**Basis:** convention — the surfaces already exist and are already gated; adding a permission for a response field would fragment an established gate. This is recorded explicitly because it determines that no `[negative-perm]` restricted-user e2e is required by the lifecycle's A10 rule; the existing 401/403 coverage is re-asserted instead (TEST-9, TEST-22).

---

### DEC-14: How do tests drive a "GitHub unreachable" and a "not a model repository" case without real network?
**Resolution:** Reuse the existing debug-only mirror seams. `LLM_RUNTIME_API_MIRROR` (already present, `cfg!(debug_assertions)`-gated) points release listing at the existing `MockReleaseServer`, which is taken down mid-test to produce the unreachable case. The capability probe gets a matching debug-only endpoint seam so a loopback fixture can stand in for `huggingface.co`.
**Basis:** convention — this is the established pattern in this repo (`CODE_SANDBOX_ROOTFS_MIRROR`, `WEB_SEARCH_BRAVE_ENDPOINT`, `LIT_SEARCH_*_ENDPOINT`), and `tests/llm_local_runtime/mock_release.rs:179` already serves `/repos/{repo}/releases` for exactly this endpoint. No new mock infrastructure, and no shared-harness edit (rule B3).

---

### DEC-15: Do the existing repository-health tests that will go RED get "fixed" or re-scoped?
**Resolution:** Re-scoped, and named as such. `connection_health_test.rs`'s `mock_ok` (`:30-38`) returns `200 "{}"` to any GET and the suite asserts `healthy`; that is the defect written down as an expectation. Those mocks are changed to serve a capability-shaped payload so they keep testing what they were written to test (auth handling, race safety, auto-disable), and a NEW test (TEST-17) asserts that the bare-200 shape is no longer `healthy`.
**Basis:** convention — a test that encodes the bug must be corrected together with the bug, and the correction must be visible rather than a silent mock tweak. `test_connection_user_agent.rs` exists to prove the User-Agent header is sent (GitHub 403s UA-less requests); its assertion is re-scoped to that header rather than to `success: true`.
