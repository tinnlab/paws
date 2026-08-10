# PLAN — local-model / local-runtime install path

## Design source

Realizes `.lifecycle/local-install-path/DESIGN.md` §1 (Discovery), §2 (Progress)
and §3 (Validation) in full. That design was written for this branch (no prior
design doc existed for the install path); it records the three defects as found
by hand against a live server, their shared root shape, and the four
non-negotiables lifted below.

## Invariants

- **INV-1**: A caller who has installed nothing can obtain, from the API alone, the exact set of installable `(version, platform, arch, backend)` combinations — without reading source, guessing a tag, or knowing an endpoint named for a different verb.
- **INV-2**: Discovery must not cost a GitHub API call per page load, and when the upstream release feed is unreachable or rate-limited the response must say so explicitly — never present an empty list that reads as "no versions exist".
- **INV-3**: A download's reported progress must never contradict its reported status — a download reported `completed` reports 100% complete.
- **INV-4**: A repository is reported `healthy` only when a model-serving capability was positively confirmed. Reachability alone is never `healthy`, and a repository whose capability could not be confirmed is never auto-disabled.

## Items

### §1 Discovery

- **ITEM-1**: Add a process-lifetime, TTL'd release-catalog cache in front of the engine GitHub release listing, keyed by engine, storing `{releases, fetched_at}`. A refresh failure must LEAVE the previous entry intact and serve it marked stale, never evict it.
- **ITEM-2**: Honour `GITHUB_TOKEN` at runtime on the `llm_local_runtime` GitHub API calls (`list_releases`, `get_latest_version`), lifting the unauthenticated 60-req/hr/IP limit to 5000/hr. The token value is never logged and never returned on any response.
- **ITEM-3**: New discovery endpoint `GET /api/local-runtime/versions/available` with an optional `?engine=` filter. Per release it reports **every published variant** as `(platform, arch, backend, size_bytes)` — not only the host-matching ones — so a caller can pick any valid five-tuple the download endpoint accepts.
- **ITEM-4**: Degradation vocabulary on the discovery response: `source` ∈ `live | cache | unavailable`, plus `checked_at` and `unavailable_reason`. The endpoint answers **200 with an explicit reason** instead of 500, so a rate-limited or air-gapped box degrades to stale-but-labelled data or a stated reason, never a bare empty list.
- **ITEM-5**: Re-implement the existing `GET /local-runtime/versions/{engine}/check-updates` on the same cached core so its response gains `source`/`checked_at`/`unavailable_reason` and stops issuing one GitHub call per page mount. Its existing fields keep their meaning (back-compat).
- **ITEM-6**: Admin-configurable cache TTL on the existing `llm_runtime_settings` singleton — `engine_release_cache_ttl_secs`, default 3600, bounded 60..=86400 — with the migration, model/repository/handler wiring and the settings-card field, mirroring the row's existing `idle_unload_secs` pattern.
- **ITEM-7**: Enrich the download-path "engine binary not published for `<tag>`" error so it names the discovery endpoint, turning an accurate-but-useless 404 into an actionable one.
- **ITEM-8**: UI — `AvailableVersionsCard` consumes the degradation vocabulary: it distinguishes "the feed said there are none" from "we could not reach the feed", shows when a listed catalogue was last refreshed when serving cached data, and never renders a bare empty list for an unreachable feed.

### §2 Progress

- **ITEM-9**: Reconcile `progress_data` inside the terminal `Completed` write of `llm_model::repository::update_download_status`, in the same UPDATE statement, preserving the row's existing `total`. Fixed at the repository chokepoint so every caller inherits it (model download, the hub download wrapper, and the SSE frame, which reads the same stored row).
- **ITEM-10**: Leave a failed/cancelled download's progress frozen where it stopped (never fabricated to 100%), and cover that explicitly so a later "make it consistent" change cannot silently start reporting a failed download as complete.

### §3 Validation

- **ITEM-11**: Replace the probe's `status == 200` assertion with a model-registry **capability** assertion: derive the repository kind from its host, request the kind's model-listing surface, and require the response to parse into the shape a model listing has.
- **ITEM-12**: Add a third health outcome `unverified` — "reachable, but model-serving capability not confirmed for this URL shape" — extending the `last_health_check_status` CHECK constraint, the Rust/TS vocabulary and the API. An `unverified` result must **not** auto-disable the repository (only a genuine `unhealthy` does).
- **ITEM-13**: Replace the auth-header selection's `url.contains("huggingface.co")` with a real host-suffix match, so a URL merely containing that string as a path segment no longer receives the Hugging Face bearer token.
- **ITEM-14**: UI — surface `unverified` distinctly from `healthy` and `unhealthy` on the repository list and drawer, so the word "healthy" keeps meaning "confirmed".

## Files to touch

**Backend — discovery (§1)**
- `src-app/server/src/modules/llm_local_runtime/engine/download.rs` (token header; release listing)
- `src-app/server/src/modules/llm_local_runtime/engine/release_cache.rs` (new)
- `src-app/server/src/modules/llm_local_runtime/engine/mod.rs`
- `src-app/server/src/modules/llm_local_runtime/binary_manager.rs`
- `src-app/server/src/modules/llm_local_runtime/runtime_version/{handlers,models}.rs`
- `src-app/server/src/modules/llm_local_runtime/routes.rs`
- `src-app/server/src/modules/llm_local_runtime/settings/*` (TTL wiring)
- `src-app/server/src/modules/llm_local_runtime/migrations/202607200500_llm_runtime_release_cache_ttl.sql` (new)

**Backend — progress (§2)**
- `src-app/server/src/modules/llm_model/repository.rs`

**Backend — validation (§3)**
- `src-app/server/src/modules/llm_repository/utils.rs`
- `src-app/server/src/modules/llm_repository/connection_health.rs`
- `src-app/server/src/modules/llm_repository/{models,types,repository,handlers}.rs`
- `src-app/server/src/modules/llm_repository/migrations/202607200600_llm_repository_unverified_status.sql` (new)

**Frontend**
- `src-app/ui/src/modules/llm-local-runtime/components/AvailableVersionsCard.tsx`
- `src-app/ui/src/modules/llm-local-runtime/components/RuntimeConfigCard.tsx`
- `src-app/ui/src/modules/llm-local-runtime/{types.ts,stores/runtimeUpdate/*}`
- `src-app/ui/src/modules/llm-repository/components/{LlmRepositorySettings,LlmRepositoryDrawer}.tsx`
- `src-app/ui/src/modules/llm-local-runtime/gallery.tsx`, `src-app/ui/src/modules/llm-repository/gallery.tsx` (new states)
- regenerated: `src-app/{ui,desktop/ui}/src/api-client/types.ts`, `src-app/{ui,desktop/ui}/openapi/openapi.json`

**Tests**
- `src-app/server/tests/llm_local_runtime/{available_versions_test.rs,release_cache_test.rs}` (new), `mock_release.rs`, `mod.rs`
- `src-app/server/tests/llm_model/download_progress_test.rs`
- `src-app/server/tests/llm_repository/connection_health_test.rs`, `capability_probe_test.rs` (new)
- `src-app/ui/tests/e2e/12-local-runtime/`, `src-app/ui/tests/e2e/llm/`

## Patterns to follow

- **Release-catalog cache** — mirror `src-app/server/src/modules/server_update/checker.rs`: a `once_cell::sync::Lazy<RwLock<…>>` process-lifetime cache, a `checked_at` timestamp surfaced to the UI, and soft-fail semantics that leave the cache intact on a failed refresh. It is the in-repo precedent for caching a GitHub release check. Deliberately do **not** copy `code_sandbox::version_manager::status()`'s degradation, which collapses a GitHub failure to an empty `Vec` — that is precisely the "reads as no versions exist" behaviour INV-2 forbids.
- **`GITHUB_TOKEN` handling** — mirror `src-app/server/build_helper/hub_seed.rs`, which already honours the token for exactly this rate-limit reason; carry it as an `Authorization` header and never log it.
- **Literal-vs-parameter route** — `/local-runtime/versions/downloads` already coexists with `/local-runtime/versions/{version_id}` in the same router (axum 0.8/matchit prioritises a static segment over a parameter), so `/local-runtime/versions/available` is the proven shape, not a gamble.
- **Bounded singleton setting** — mirror `llm_runtime_settings.idle_unload_secs`: a `CHECK`-constrained integer column with a default, validated again in the handler.
- **Host-kind derivation** — reuse the host-suffix predicate already used by the download path in `src-app/server/src/modules/llm_model/handlers/repo_files.rs` (`host == suffix || host.ends_with(".{suffix}")`), not the substring test currently in `llm_repository/utils.rs`.
- **Debug-only test seam** — mirror `LLM_RUNTIME_RELEASE_MIRROR` / `WEB_SEARCH_BRAVE_ENDPOINT`: any loopback/endpoint override for the capability probe is gated on `cfg!(debug_assertions)` so it cannot exist in a release build.
- **Test fixture** — extend `src-app/server/tests/llm_local_runtime/mock_release.rs` (which already serves `/repos/{repo}/releases`) rather than introducing a second mock; it is the established fixture for this path.

## Item verdicts (plan audit vs the codebase — Phase 2)

- **ITEM-1** — verdict: PASS — `BinaryDownloader::list_releases` (`engine/download.rs:466`) is the single read point; `server_update/checker.rs:20` is the precedent cache. No existing caller depends on an uncached read.
- **ITEM-2** — verdict: PASS — `github_get_with_retry` (`engine/download.rs:413`) is the single chokepoint for both API calls; adding one header there covers `list_releases` and `get_latest_version`.
- **ITEM-3** — verdict: CONCERN — new route + new response type ⇒ `just openapi-regen` for BOTH workspaces is mandatory. Route literal/param precedence verified against the existing `/versions/downloads` sibling; must be asserted by a test, not assumed.
- **ITEM-4** — verdict: CONCERN — changes `check-updates` failure behaviour from 500 to 200-with-reason. Verified against `tests/llm_local_runtime/engine_download_test.rs:130` (`check_updates_reports_diff_and_pending_builds`), which asserts 200 on the success path only, so no existing assertion breaks. The UI's `AvailableVersionsCard` error branch keys off store `error`, which must be re-pointed at the new vocabulary or the error state becomes unreachable.
- **ITEM-5** — verdict: PASS — `binary_manager::check_for_updates` (`binary_manager.rs:242`) already composes `list_releases` + installed diff; only its release source changes.
- **ITEM-6** — verdict: CONCERN — new migration. Highest server prefix in tree is `202607200400`; `202607200500` sorts above it and below the desktop `1e13` block. Must re-check against real main at merge (BASE.md).
- **ITEM-7** — verdict: PASS — the 404 message is produced in `engine/download.rs`'s download path; message-only change, no contract change.
- **ITEM-8** — verdict: PASS — `AvailableVersionsCard.tsx` already has distinct loading/error/empty branches (`:168-205`) to extend; `latest_version` is computed client-side in the store, so no server field is implied.
- **ITEM-9** — verdict: PASS — `repository.rs:896-924` `Completed` arm is the single terminal write; the SSE frame (`handlers/downloads.rs:64-86`) derives from the same stored row, so one fix covers both surfaces.
- **ITEM-10** — verdict: PASS — `Failed | Cancelled` arm (`repository.rs:925-951`) is deliberately left freezing progress; needs a test to pin the intent.
- **ITEM-11** — verdict: CONCERN — `test_repository_connectivity` (`utils.rs:309`) is shared by the by-id probe AND the from-form probe AND the boot health scan (`connection_health.rs`). All three change behaviour together; the boot scan's auto-disable path is the risk INV-4 constrains.
- **ITEM-12** — verdict: CONCERN — new migration extending a CHECK constraint on a live column; existing rows are `untested|healthy|unhealthy` so the widening is safe, but `record_test_outcome` (`connection_health.rs:389`) must branch so `unverified` does not take the auto-disable path.
- **ITEM-13** — verdict: PASS — `utils.rs:360` substring test; localized change, and the correct predicate already exists in `llm_model/handlers/repo_files.rs:124-143` to mirror.
- **ITEM-14** — verdict: PASS — the UI currently renders only an `unhealthy` alert (`LlmRepositorySettings.tsx:308-327`); adding a third state is additive.

## Breakage risk

- `check-updates` failure status changes 500 → 200-with-reason (ITEM-4). Verified no existing test asserts the 500.
- `test_repository_connectivity` becomes stricter (ITEM-11), so existing tests whose mock returns `200 "{}"` for any GET (`tests/llm_repository/connection_health_test.rs:30-38` `mock_ok`) will go RED — **by design**: those tests encode the defect. They must be updated to serve a real model-listing shape, and a new test must pin that a bare-200 host is no longer `healthy`.
- `tests/llm_repository/test_connection_user_agent.rs:47-83` asserts a loopback `/whoami` returning body `"ok"` yields `success: true`; it must be re-pointed at a capability-shaped response or its assertion re-scoped to the User-Agent header it actually exists to test.

## Pattern conformance

Each area mirrors the closest existing module, named per-item in *Patterns to
follow*. No new module is introduced; `engine/release_cache.rs` is a new file
inside an existing module, following `server_update/checker.rs`'s shape.

## Migration collisions

Two new migrations, both in the server sequence:
`202607200500_llm_runtime_release_cache_ttl.sql` and
`202607200600_llm_repository_unverified_status.sql`. Highest existing server
prefix at branch time is `202607200400`; `find … | cut -d_ -f1 | sort | uniq -d`
prints nothing. Re-checked against real main by the merge-gate's C2.

## OpenAPI regen

Required. New route (ITEM-3), new response fields (ITEM-4/ITEM-6), new health
status value (ITEM-12) all change the schema. `just openapi-regen` emits BOTH
`src-app/ui/` and `src-app/desktop/ui/` (`openapi.json` + `api-client/types.ts`).
